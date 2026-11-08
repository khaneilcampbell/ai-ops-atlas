# Security hardening and rollout

These files improve Atlas's CI and provide a commerce migration template. They do
not establish that the VPS is secure or that remote GitHub settings are applied.
Existing October 28 evidence is historical; the screenshot is an assessment, not
proof of a credential leak. GitHub Actions secrets are encrypted settings, not
plaintext repository content. If any key was committed, treat it as compromised.

## Team configuration reference

The owner selected the solo configuration below; independent-review instructions
in this section are an optional stronger team policy, not the active configuration.

1. Create `macos-signing` with an independent required reviewer, prevent self-review,
   disable administrator bypass and allow deployment from the branch `main` only
   (a custom branch rule, not a wildcard). Version-tag releases use a separate artifact-only publishing job and no signing secrets. YAML alone cannot
   configure these protections; an environment name alone does not protect secrets.
2. Move `TAURI_SIGNING_PRIVATE_KEY`, its optional password, `MACOS_SIGNING_CERT`,
   and `MACOS_SIGNING_CERT_PASSWORD` to environment secrets. Confirm names and test
   the protected pipeline, then delete the repository-scoped copies. Repository
   secrets remain accessible to other workflows until deleted. The setup script
   verifies signing environment protections before uploading the certificate.
3. Enforce a main branch ruleset: PR required, one independent approval, dismiss
   stale approvals, approval after latest push, resolved conversations, no deletion,
   no force push and no bypass actors. Require these exact checks after they have
   first completed successfully: `Frontend (types, tests, build)`,
   `Desktop shell (Rust tests)`, `Dependency audit`, `Security policy`, and
   `Analyze (javascript-typescript)`, `Analyze (rust)`, `Analyze (actions)`.
   Require branches to be up to date. Do not require the publishing job, which
   only runs after merge. Protect release tags against creation/update by
   untrusted actors; tag publishing still builds code at the tagged commit.
4. Keep Actions tokens read-only by default. Use a short-lived, repository-scoped
   token or GitHub App for external automation, never a personal all-repo token.
   Pin third-party actions to reviewed full commit SHAs as a separate supply-chain
   update; current action version tags remain mutable.
5. Enable Dependabot alerts, secret scanning and push protection where available.
   Use a dedicated read-only audit token with repository metadata and Dependabot,
   code-scanning and secret-scanning alert read permissions. Unavailable/private
   features must remain unknown rather than being shown as zero alerts.

Run `python3 ops/security/audit.py --repo OWNER/REPO` with authenticated `gh`.
The report emits only counts and feature settings, never secret values or alert
bodies. Counts are bounded to 100 and mark possible truncation. API failures,
missing CLI/auth, unsupported features and permission failures report unavailable.
`--require-signing-environment` fails if protections cannot be verified.
`--local` checks workflow invariants without accessing GitHub. The verifier is a
regression guard, not a replacement for server-side rulesets or code review.

## Commerce VPS migration

The commerce source and live VPS are outside this checkout. Do not install the
example unit unchanged or disable root SSH until a separate administrative login
and recovery console have been tested.

1. Inventory running services and credential consumers without printing values.
   Back up service configuration and confirm pending orders can be reconciled.
   Rotate any exposed/overbroad keys at their providers; deleting a file or Git
   history does not revoke a key. Rotate an updater signing key only with a planned
   trusted-client migration: installed clients trust the old public key.
2. Create separate non-login service accounts for delivery, content/AI, and deploy.
   Keep executable code and virtual environments root-owned and non-writable by
   workers. Give each account only its own writable state directory. Use separate
   restricted Stripe keys; delivery needs read access only to the objects it
   actually uses. Keep storefront write/deploy credentials out of the worker.
3. Store per-service credentials in root-owned directories mode 0700, files mode
   0600. Adapt the application to read systemd credential files from
   `$CREDENTIALS_DIRECTORY`, then adapt `commerce-worker.service.example` to its
   real entry point. No shared `.env` holding every credential. Credential files
   remain readable by that worker: this is isolation, not protection against a
   compromised worker using its own permissions.
4. Stage the unit, run `systemd-analyze verify` and `systemd-analyze security`,
   test one canary order, retries, deduplication and restart recovery. Sandbox
   directives depend on host support. Verify negative tests: worker cannot write
   application code, read another service's keys, access `/root`, or deploy.
5. Stop the old worker before starting the replacement to avoid duplicate emails.
   Monitor failures and backlog. Rollback should restore the last tested unit with
   the restricted credentials; never restore revoked keys or root execution.
6. Add provider spend caps and per-day email/order caps with persistent counters,
   idempotency keys and an operator kill switch. Publish redacted heartbeats with
   last success, error counts and queue age to an authenticated private endpoint;
   alert externally after two hours of silence. Do not send keys, buyer email
   addresses or order payloads into telemetry. Check provider delivery failures.

References: [GitHub environment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[systemd isolation and credentials](https://freedesktop.org/software/systemd/man/latest/systemd.exec.html).

## Solo-owner configuration

For this owner's explicit solo setup, independent deployment review is omitted.
The environment must still allow only branch `main` and disable administrator
bypass. This protects branch access but does not provide two-person approval.
Verify it with `python3 ops/security/audit.py --signing-policy solo`.
The default verifier remains the stricter team policy; it never silently downgrades.
Certificate setup accepts `scripts/setup-macos-signing.sh --solo`.

`python3 ops/security/configure-signing.py` validates local signing files without
changing GitHub or emitting values. `--apply` sets the solo environment and uploads
the existing updater key, certificate and certificate password directly through
stdin. It validates an empty updater password and the configured public key before
uploading. Repository secrets remain until the migrated workflow is tested.
