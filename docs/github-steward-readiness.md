# GitHub Steward production readiness

Status: **not production ready.** Updated October 29, 2026.

This checklist tracks the GitHub Steward workflow (Intel → GitHub Steward) toward a reviewable release. Each item has acceptance criteria and evidence. `[x]` means verified by a test or a recorded check. `[~]` means implemented and unit-tested, but not yet verified in a running desktop build. `[ ]` means open. Nothing here is released. The work is uncommitted on the local `codex/finish-active-agents` working tree, mixed with other workstreams, and the installed desktop app does not contain it.

## Validation log

| Date | Check | Result |
| --- | --- | --- |
| Oct 29 baseline | Vitest / tsc / eslint / build / cargo test / npm audit | 216 pass / pass / pass / pass / 112 pass / 0 vulnerabilities |
| Oct 29 after milestone 2 | Vitest | 224 tests in 36 files pass |
| | `tsc -b --noEmit`, `eslint .` | pass |
| | `npm run build`, `VITE_ATLAS_WEB=1 npm run build` | pass (existing bundle-size and mixed-import warnings) |
| | `cargo test`, `cargo build`, `cargo clippy --all-targets` | 143 pass, builds, no warnings |

| Oct 29, 07:06 | `tauri dev` desktop run, real Keychain token, manual check | Ran in Rust: 7 requests, authenticated (4,871 of 5,000 GitHub requests left), status partial. Repository, commit, README and Dependabot config observed. CI not verified because CodeQL was still running (correct). Dependabot and code scanning alerts returned 403 (`http_403`): the read token lacks those permissions. `state.json` and one `audit.jsonl` line written; no active marker left after quitting; baseline notice raised. |

Not yet run in the desktop build: pause mid-run, quit mid-run, "Continue without keys" with a schedule, and a browser check of the hosted notice.

## Architecture (decided October 29, 2026)

The desktop app is the production target. The Steward runs in Atlas's Rust side (`src-tauri/src/steward/`): policy, check, scheduler, lock, storage and audit. The web view only displays it. It runs while Atlas is open, including with the window hidden, and never while Atlas is quit. There is no launch agent, cloud worker or paid service. The browser runner in `src/steward/store.ts` remains for `npm run dev` preview only. The hosted website never runs checks.

| Concern | Where it lives |
| --- | --- |
| Scope and endpoints | `policy.rs`, GET only, one repository, seven paths |
| Credentials | Existing Keychain vault; Steward reads only the shared read token, never the Actions or merge tokens; background runs require an unlocked vault |
| Scheduling | Tokio loop, once a minute; one claim per local day saved before network access |
| Locking | One run per process plus `run.lock` across processes sharing the data folder |
| History | `state.json` with atomic write, version field, crash marker |
| Audit | `audit.jsonl`, counts and fixed error labels only, rotated |
| Notifications | In-app notice only |

## Production blockers found at baseline, and status

1. **Security alert bodies persisted in local storage** through the shared ETag cache. *Fixed:* Steward reads never use that cache, and old alert entries are purged.
2. **Repository scope enforced only in web code.** *Fixed for the Steward:* the desktop check runs in Rust behind `policy::allowed`. The general `github_get` command still serves any repository read to the web view with the same read token. That is unchanged existing behavior.
3. **The hosted web build could run only two of seven checks** while the docs said it worked. *Fixed:* the hosted build shows a desktop-only notice and never runs.
4. **Scheduled checks ran anonymously after "Continue without keys".** (An earlier draft wrongly said Touch ID could pop up; `VaultGate` prevents that.) *Fixed:* scheduled runs wait without claiming the day until the vault is unlocked, and never prompt.
5. **The read token's GitHub permissions are unverified.** *Open, needs KC.*
6. **History lived only in web view storage.** *Fixed:* durable files in the app data folder.
7. **No release candidate.** *Open.*

## Checklist

### P0: trust boundaries and privacy

- [x] **No advisory content at rest.** *Evidence:* `src/steward/privacy.test.ts` (legacy cache purged, nothing for the Steward or its advisory text on disk); Rust `alert_content_is_not_kept`; audit lines hold counts only (`audit_lines_are_structured_and_rotate`).
- [x] **Scope enforced outside the web view.** *Evidence:* `policy.rs` tests reject other repositories, forks, other endpoints, changed page sizes, traversal and absolute URLs. The Rust check test asserts every path it issues passes the policy, and a TypeScript test pins the browser runner to the same seven paths. The desktop run on Oct 29 issued exactly seven allowed reads.
- [x] **Hosted web is honest.** The hosted build does not start a scheduler, the runner refuses, and the panel says desktop-only. The proxy was not widened. *Evidence:* store refusal test; hosted build compiles. A browser view of the notice is still to do.
- [~] **No anonymous or prompted background runs.** *Evidence:* Rust `locked_keys_hold_the_scheduled_run_without_claiming_the_day`; `secrets::unlocked()` reads state without prompting. Pending a desktop run.
- [ ] **Least-privilege read token.** Required read permissions for `khaneilcampbell/ai-ops-atlas`: Metadata, Contents, Actions, Dependabot alerts, Code scanning alerts. *Observed Oct 29:* the saved token reads metadata, contents and Actions, but gets 403 on Dependabot and code scanning alerts, which the panel correctly reports as not verified. *Needs KC:* add read-only Dependabot alerts and Code scanning alerts permissions, and confirm the token has no write permissions.
- [x] **Secrets and raw errors never recorded.** *Evidence:* Rust `network_errors_are_classified_without_their_text`, `denied_and_malformed_alerts_are_unknown_not_zero`; runs carry only fixed `errorClass` labels.

### P1: dependable execution

- [x] Architecture recorded (above).
- [x] **One run at a time** in a process and across processes. *Evidence:* `overlapping_runs_in_one_process_or_two_do_one_check`, `one_lock_holder_and_release_on_drop`, `a_stale_lock_from_a_dead_process_is_taken_over`.
- [x] **Pause/Resume** persisted; stops an in-flight run before its next request. *Evidence:* `pause_stops_the_in_flight_run_and_blocks_new_ones`, `pause_mid_run_issues_no_further_request`.
- [x] **Bounded network use.** Seven requests, no retries, 20 s per request, 180 s budget, remaining rate budget recorded. *Evidence:* `bounded_reads_recognize_ci_recovery`, `a_hung_request_times_out_as_unknown`.
- [x] **Schedule boundaries.** Off by default, one claim per local day, catch-up once, no backlog, midnight, survives restart. *Evidence:* `one_attempt_per_local_day_after_the_time`, `schedule_is_off_by_default_and_claims_one_run_per_day_across_restarts`.
- [x] **Durable storage, migration and recovery.** Atomic write, unreadable file set aside, newer format left untouched and runs blocked, unwritable store blocks network work, browser history imported once and validated. *Evidence:* `store.rs` tests, `an_unwritable_store_blocks_network_work`, `imports_browser_history_once_without_foreign_links`, `desktop.test.ts`.
- [x] **Crash/reload recovery.** *Evidence:* `a_run_cut_off_by_a_crash_is_recorded_once_as_interrupted`.
- [x] **Accurate change detection.** Quiet on unchanged and healthy churn; replaced alerts, coverage loss and recovery are reported; dismissed notices stay dismissed. *Evidence:* `schedule.rs` tests, `unchanged_runs_stay_quiet_after_a_dismissed_notice`.

### P2: observability

- [~] Run status, last complete check, last observation, request count, remaining GitHub budget and error label shown in the panel. Pending a visual check.
- [x] **Stale indicator** after 26 hours with daily monitoring on. *Evidence:* `stale_when_the_last_observation_is_older_than_a_day`.
- [x] **Structured audit records** with bounded retention. *Evidence:* `audit_lines_are_structured_and_rotate`.
- [x] **Runbook** for failures, pausing, storage recovery and rollback in `docs/github-steward.md`.

### P3: autonomy boundary

- [x] No model calls and no write path. Rust `Source` exposes GET only, behind the policy.
- [x] Steward cannot read the Actions or merge credentials. It calls only `github::get`, which reads `read_token`.
- [x] Described as a deterministic automation. The panel button now reads "Pause checks", and the catalog entry says no AI calls.

### P4: release

- [ ] Steward changes isolated on their own branch, separate from unrelated workstreams. Shared files `src/App.tsx`, `src/views/Intelligence.tsx`, `catalog/ai-ops-atlas.yaml` also carry other work and need hunk-level separation.
- [ ] Desktop verification with the real token: unlock, manual check, pause mid-run, quit mid-run then relaunch (expects "interrupted"), "Continue without keys" with daily monitoring on (expects waiting), history import from the preview.
- [ ] Signing and update: confirm the release workflow builds and signs with the new Rust module. No changes were made to signing, updater or workflows.
- [ ] Release notes with residual risks; KC approval before push, merge, tag or install.

## Residual risks and unsupported scenarios

- Checks do not run while Atlas is quit or the Mac is asleep. A missed day is not replayed.
- Each Mac and each browser profile keeps its own history. Nothing is shared across devices.
- Live reads are snapshots, not a commit-bound audit. Alerts beyond the first 20 and runs beyond 30 are not compared.
- `state.json` and `audit.jsonl` are ordinary user files: tamper-evident logging is out of scope.
- A run interrupted by a power loss between the claim and the first request is recorded as interrupted, and that day is not retried.
- The browser preview runner is a second implementation of the same rules, kept for development only.
