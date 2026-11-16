# Production readiness (Phase 5)

What was checked on 2026-11-16 against `main` at `cc630d3`, what changed, how to back up and recover,
and what is still open. This is evidence from code, tests and local runs, not a security
certification or an availability guarantee. Earlier audits are not repeated here: see the
2026-10-28 hardening (PR #50, #52), signing (`docs/ci-signing-security.md`) and production
reporting (`docs/production-observability.md`).

## 1. How Atlas is put together (what was audited)

| Part | Where | Who can reach it |
| --- | --- | --- |
| Web page + API | Cloudflare Pages, `functions/` → `server/` | Cloudflare Access on every `/api/*` route, re-verified in code (`server/access.ts`: RS256 signature, audience, issuer, expiry, optional `ALLOWED_EMAILS`) |
| Hooks | `/api/hooks/*`, `/api/usage/push` | No Access session; each checks its own secret: GitHub HMAC, `USAGE_SYNC_TOKEN` (Mac app), add-only `AGENT_FEED_TOKEN`, `N8N_BRIDGE_CALLBACK_TOKEN`, per-agent `PRODUCTION_AGENT_KEYS`. All compared in constant time, minimum 32 characters |
| Mac app | Tauri, `src-tauri/` | Secrets in one Keychain item behind Touch ID; GitHub GETs only to an allowlist; writes (re-run, merge) off by default, per repository, Touch ID each time |
| Device records | `localStorage` `atlas:*` | Tasks, workflow runs + execution ledger, settings (agent memory and business records once PRs #432/#434 merge). Never credentials |
| Live database | D1 `atlas-live` (`LIVE` binding) | Events 3 days, inquiries 180 days, n8n sends/reports 30 days, agent reports and usage capped by row count |
| Release | `.github/workflows/ci.yml` | Lint, types, tests, builds, `npm audit`, `cargo audit`, security policy; signing only on `main` in the `macos-signing` environment; publish rejects older versions |

## 2. Findings

Severity is for this single-owner product as deployed. Nothing Critical was found.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | High | Access routes that change something (`POST /api/n8n/steps`, `/api/inquiries/reply`, `/api/registry/refresh`) accepted any request carrying the Access session, with no check that it came from the Atlas page. Access signs the browser in with a cookie, so whether a page on another site could trigger these depended only on the cookie's SameSite setting in Cloudflare | **Fixed**: `server/origin.ts` refuses non-GET Access requests that a browser marks as cross-site (`Sec-Fetch-Site`) or that carry a foreign `Origin`. Tested |
| 2 | Medium | Refused sign-ins, refused hook keys and server errors left no record, so a key-guessing attempt or a broken integration was invisible | **Fixed**: `server/middleware.ts` logs one redacted JSON line per refusal or 5xx (event, severity, service, request id, path, status, duration) to the Pages Workers logs, and every API answer carries `x-request-id`. Unhandled errors become a generic 500 without internals |
| 3 | Medium | No single place said whether the site's database and integrations were working; "not configured" and "broken" looked the same as "fine" | **Fixed**: `GET /api/health` (Access) and `GET /api/hooks/health` (sync key) with healthy / degraded / unavailable / unknown per check; Production health panel in Mission Control |
| 4 | Medium | Device-only records (Task Center, run ledger, settings; agent memory and business records after #432/#434) had no backup. Clearing site data or a new Mac lost them | **Fixed**: Settings → Data → Save backup / Restore, with a preview of what changes, an undo copy and rollback on a failed write. Tested in an isolated in-memory store |
| 5 | Medium | `ALLOWED_EMAILS` is optional. Without it, only the Access policy decides who can call write routes | **Shown, not enforced**: health reports Sign-in as Degraded when it is unset. Enforcing it in code could lock the web page if it isn't set, so it is a manual step (section 7) |
| 6 | Medium | One `USAGE_SYNC_TOKEN` lets the Mac app read the feed and also send a reviewed inquiry reply, send an n8n step and refresh the registry | Open, already raised on 2026-10-28 ("split sync token"). Each of those actions is capped or idempotent server-side (reply idempotency key, 20 n8n sends a day, registry cooldown) |
| 7 | Medium | Cloudflare Pages deploys the web page from `main` on its own, not from CI, so a red CI run on `main` still redeploys the site (the Mac update is gated correctly) | Open. Required checks before merge keep `main` green in practice. Section 7 has the optional setting |
| 8 | Low | No rate limit on hooks. Every hook rejects a wrong key before writing to D1 (bodies are size-capped), so a flood costs requests, not database writes | Open; one free Cloudflare rate-limiting rule covers it (section 7) |
| 9 | Low | No automated check for committed credentials before merge (GitHub secret scanning only reports after push) | **Fixed**: `scripts/secret-scan.mjs` runs in CI's Security policy job, prints file and line only |
| 10 | Info | `npm audit` (all and production-only): 0 vulnerabilities. Tracked-file credential scan: only test fixtures in `src-tauri/src/secrets.rs` | Checked 2026-11-16 |

Confirmed already sound, no change: Access JWT verification fails closed (503 when Cloudflare's keys
can't be fetched); hook secrets compared in constant time; GitHub webhook HMAC; bodies size-capped
before parsing; CSP, `X-Frame-Options: DENY`, `no-store` on `/api/*`; tokens never in
`localStorage`; signing secrets only in a `main`-only environment; updater rejects older versions.

## 3. Execution reliability (verified, not rebuilt)

The orchestrator from PR #430 already covers what Phase 5 asks for; nothing was duplicated:

- **Idempotent dispatch**: every n8n send has an idempotency key; the site records it before sending (`n8n_dispatch`) and answers repeats from the record. Reports are deduplicated by event id.
- **No blind retries**: a send with no clear answer is held as *unknown* and listed under "Sends to check" until a person records whether it ran. Only sends that provably failed are retried, with 1, 2, 4… minute backoff capped at 30 minutes, at most 3 at a time.
- **Stale detection**: stale attempts are reconciled against the outside system before anything is resent.
- **Approval enforcement**: only a person can start or authorise a run, decide, waive, cancel or resolve an unknown attempt. Agents have no path to change their own policies or approval rules: policy is code and changes only by pull request.
- **New in Phase 5**: health flags sends stuck in "sending" for over 2 minutes and the n8n daily cap.

## 4. Observability

- **Logs**: one JSON line per refusal, server error and degraded health check, via `server/log.ts`. Keys that name a secret are replaced and token-shaped strings masked (GitHub, Anthropic, OpenAI, Resend, Slack, AWS, JWT, PEM, `Bearer …`). No prompts or customer content are logged. View them in Cloudflare: Workers & Pages → ai-ops-atlas → the deployment → Functions logs (real-time).
- **Health checks** (`server/health.ts`, thresholds in `src/observability/health.ts`):

| Check | Healthy | Degraded | Unavailable | Unknown |
| --- | --- | --- | --- | --- |
| Sign-in (Access) | Configured + owner allowlist | No `ALLOWED_EMAILS` | Access not configured | — |
| Live database | `SELECT 1` under 1 s | Over 1 s | No binding, error or no answer in 3 s | — |
| GitHub API | Token valid, ≥10% of hourly limit left | Under 10% left, or non-401 error | Token refused, or no answer in 5 s | No site token |
| GitHub webhooks | A delivery stored in the last 3 days | — | — | Secret unset, or no deliveries to judge by |
| n8n workflows | Published workflows mostly succeed | ≥3 failures in 24 h or <80% success | API error or timeout | No API key |
| n8n step runner | Sends answered | Daily cap hit, or a send with no answer | — | Not set up, or nothing sent yet |
| Production agents | Report in the last 15 min | Older than 15 min | — | No keys or no reports |

  The overall state is Unavailable if a critical check (sign-in, database) is down, Degraded if anything is degraded or down, Healthy only when every critical check is healthy, and otherwise Unknown. Unknown is never shown as healthy.
- **Notifications**: agent failure and silence emails already exist (`server/alerts.ts`, one email per agent with cooldown). Health is checked when someone opens Mission Control; there is no unattended health alert because Pages has no scheduler. Adding one would mean a small cron Worker; not done to avoid new infrastructure.
- **No automatic repair**: health checks only report.

## 5. Backup and disaster recovery

| Data | Where | Backup | Retention | Encryption | RPO | RTO (proposed) |
| --- | --- | --- | --- | --- | --- | --- |
| Catalog, agent registry config, workflow definitions in repo, policies | GitHub `main` | Git history; every merge is a commit | Forever | GitHub at rest | 0 (each merge) | Minutes: revert the PR |
| Live feed, inquiries, n8n sends/reports | D1 `atlas-live` | Cloudflare D1 Time Travel (automatic, point-in-time) | 30 days on Workers Paid, 7 days on Free | Cloudflare at rest | Minutes | Under 30 minutes |
| Task Center, run ledger, settings, agent memory, business records | This device's storage | Settings → Data → Save backup (manual JSON file) | As long as the file is kept | None in the file; store it in an encrypted place (FileVault, iCloud Drive) | Time since the last saved backup | Under 5 minutes |
| n8n workflows and credentials | n8n cloud | n8n's own version history per workflow | n8n plan | n8n | Last save | Restore a version in n8n |
| Secrets | Keychain, Cloudflare and GitHub secrets | Not backed up by design; re-issue instead | — | Keychain / provider | — | Re-issue from the provider (runbook `docs/runbooks/key-scope.md`) |

**Restore the device records**: Settings → Data → Restore from a backup → choose the file → check
the counts → Restore. Atlas keeps the records you had under Undo last restore until the next
restore. Tested in `src/lib/backup.test.ts` (round trip, preview, undo, failed-write rollback,
rejection of bad, newer, cache-only or credential-bearing files) against an isolated store.

**Restore D1** (only Khaneil, only after deciding production data must be rolled back):

1. Find the time to go back to. In a terminal: `npx wrangler d1 time-travel info atlas-live`
2. Rehearse first in an isolated copy: `npx wrangler d1 export atlas-live --remote --output atlas-live.sql`, then `npx wrangler d1 execute atlas-live-drill --local --file atlas-live.sql` and open Atlas against the local copy. This reads production but changes nothing.
3. Restore: `npx wrangler d1 time-travel restore atlas-live --timestamp=<ISO time>`. This overwrites production data since that time.

The D1 drill has not been run from this cloud session (it needs Khaneil's Cloudflare login); the
targets above are proposed, not measured.

## 6. Release safety

- Checks before merge: lint, typecheck, unit tests, both builds, Rust fmt/clippy/tests, `npm audit --omit=dev --audit-level=high`, `cargo audit`, security policy tests and now the secret scan. Visual checks run in their own workflow.
- Release: only a green `main` run signs (environment `macos-signing`) and publishes; the publish step rejects a version that isn't newer. A failed run publishes nothing, and the Release card in Mission Control shows the last runs.
- Rollback: revert the pull request. The revert ships as a newer build and every Mac moves back. Never edit `latest.json` by hand. Sending agents: `docs/runbooks/stop-and-rollback.md`.

## 7. Manual configuration (Khaneil)

None of these are required for this change to work; each closes an open finding.

1. **Owner allowlist (finding 5).** Cloudflare → Workers & Pages → ai-ops-atlas → Settings → Variables and secrets → add `ALLOWED_EMAILS` = your Access email, for Production. https://dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f/pages/view/ai-ops-atlas/settings/production
2. **Access cookie (finding 1, belt and braces).** Zero Trust → Access → Applications → the Atlas app → Settings → Cookie settings → SameSite = Lax (or Strict). https://one.dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f/access/apps
3. **Rate limit hooks (finding 8).** Security → WAF → Rate limiting rules → one rule: URI path starts with `/api/hooks/`, 120 requests per minute per IP, action Block for 10 minutes. Pick the domain the site uses from https://dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f
4. **D1 restore drill (section 5).** Run steps 1 and 2 of "Restore D1" once and note how long it took.
5. **Optional, finding 7.** To stop the web page deploying when CI is red: Workers & Pages → ai-ops-atlas → Settings → Builds → Branch control → turn off automatic production deployments, and deploy from CI instead (needs a deploy step and a Cloudflare token in GitHub; ask for it as its own change).

## 8. Commercial readiness: extension points, not a SaaS

Atlas today is single-owner: one Access identity, one device's records, one Cloudflare account. It is
not multi-tenant and has no billing. What is in place and where a second user would plug in:

| Need | Today | Extension point when there are external users |
| --- | --- | --- |
| User identity | Cloudflare Access email, verified in `server/access.ts`, returned as `email` | Pass the verified email into handlers; key every stored row by it |
| Organization ownership | Implicit: one owner | Add `org_id` to D1 tables; map Access groups to orgs |
| Project access boundaries | Catalog lists projects; GitHub proxy allowlists paths | Per-org project allowlist checked in the proxy and every hook |
| Roles and permissions | Owner-only; agents can never approve; write actions per repository with Touch ID | Roles (owner, operator, viewer) checked server-side on each write route, next to the cross-site check |
| Usage metering | Model usage per agent (`/api/hooks/usage`, Usage tab), n8n daily send cap | Same records with `org_id`; caps per plan read from config |
| Plan limits | Spend caps (`src/finance/caps.ts`), provider caps set in Anthropic | Per-org caps enforced where sends happen (n8n bridge, actions) |
| Data retention | Fixed per table (section 1) | Per-org retention setting used by the existing prune queries |
| Export and deletion | Device backup file; D1 rows expire | Per-org export (same backup format) and delete-by-org query |
| Audit history | Write actions audit log (`docs/actions.md`), task events, decision records, request logs | Same, with actor email and org on each entry |
| Customer onboarding | Not applicable | Access invite → org row → empty catalog |

Not built on purpose: billing, subscriptions, multi-tenant storage, a second auth system.

## 9. Remaining risks

- Device records are only as safe as the last backup the owner saves; there is no automatic or off-device sync (D1 sync for tasks is a later step).
- One sync key covers several Mac app actions (finding 6).
- Health has no unattended alerting (section 4); an outage is noticed when Mission Control is opened or an agent alert email fires.
- The web page can deploy from a red `main` (finding 7).
- Rate limiting depends on the manual WAF rule (finding 8).
- D1 restore is documented but not rehearsed (section 5).
- Logs live in Cloudflare's Workers logs with its default retention; there is no long-term log store.
- The Rust changes (health command, backup save dialog) are validated by CI's Rust job and the macOS build, not in the cloud session.
