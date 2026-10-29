# GitHub Steward

Open **Intel → GitHub Steward → Check now** in the desktop app. It uses Atlas's read-only GitHub connection. The hosted web build shows a desktop-only notice and never runs checks, because its read-only proxy deliberately does not serve security alerts or repository files.

The workflow is registered in the agent directory as a deterministic automation, not an AI agent. No model prompt is executed at this stage. It checks only `khaneilcampbell/ai-ops-atlas`, using at most seven sequential GET requests with no retries: repository metadata, branch head, thirty default-branch workflow runs, twenty open Dependabot alerts, twenty open code scanning alerts, README presence and `.github/dependabot.yml` presence. The newest run per sampled workflow determines the CI observation. Old failures do not override a later recovery. Cancelled, missing and unfinished runs remain inconclusive. A check with unavailable evidence is partial, never a clean security assessment.

Security reports retain counts, numeric alert identifiers for change detection, and GitHub links, not advisory content or raw logs. Steward reads bypass Atlas's shared response cache, and any alert responses cached by earlier builds are purged before a check, so alert bodies are not written to local storage. Empty alert results do not prove scanners are enabled. File presence does not prove configuration correctness. Each observation explains its coverage. The recorded commit links to the observed branch head; workflow and alert reads are live snapshots, not an atomic audit of that commit.

## Where it runs

**Desktop app (the production path).** The Steward runs in Atlas's Rust side (`src-tauri/src/steward/`). The panel only displays its state and sends Check now, Pause, schedule and Dismiss. The repository and the seven endpoint shapes are enforced in Rust (`policy.rs`), GET only, without the response cache. Checks continue while the window is hidden or minimized. They do not run while Atlas is quit or the Mac is asleep. There is no launch agent or cloud worker.

**Browser preview (`npm run dev`).** The original web-view runner (`src/steward/store.ts`) remains for local preview only, with anonymous GitHub access, a Web Lock and local storage.

**Hosted website.** The panel shows a desktop-only notice and never runs.

## Controls

**Pause checks** is saved immediately and stops the running check before its next request. An in-flight request can take up to its twenty-second timeout, and a whole check stops after three minutes. **Resume checks** permits manual and daily checks again.

Daily monitoring is off in a new installation. Turn on **Daily monitoring while Atlas is open** and choose a device-local time (default 09:00). The desktop runner looks once a minute, starting 30 seconds after launch. It runs once per local calendar day at or after that time, and catches up once if Atlas opens later the same day. Missed days are not replayed. The day is claimed and saved before the first request, so a crash, quit or failure never causes a same-day retry. Changing the time never grants a second attempt on a claimed day.

While the saved keys are locked (after "Continue without keys"), a scheduled check waits without claiming the day, says why in the panel, and runs once the keys are unlocked. The background runner never raises Touch ID and never runs a scheduled check anonymously. Manual checks use whatever access Atlas currently has.

## Storage, audit and recovery (desktop)

Files live in Atlas's app data folder under `steward/`. On macOS that is `~/Library/Application Support/com.khaneilcampbell.ai-ops-atlas/steward/`.

- `state.json`: pause, schedule, the last 30 runs, the open notice, and an "active run" marker. It is written to a temporary file, flushed, then renamed into place.
- `audit.jsonl`: one line per finished run, with run id, trigger, start and end, status, request count, GitHub's remaining hourly budget, a fixed error label (such as `timeout`, `network`, `http_403` or `policy_blocked`), and counts of findings. It never holds tokens, alert content or raw error text. It rotates to `audit.1.jsonl` at 512 KB.
- `run.lock`: present only while a check runs. It stops two Atlas processes that share the folder (for example a dev build beside the installed app) from checking at once. A lock older than ten minutes is treated as left by a dead process and taken over.

If Atlas quits or crashes mid-check, the active-run marker is found at the next launch. The run is then recorded once as **interrupted**, with a notice. If `state.json` is unreadable, it is kept as `state.unreadable-<time>.json`, a new history starts, and the panel says so. If it was written by a newer Atlas, it is left untouched and checks are blocked until that version returns. If the file can't be saved, checks are blocked and the panel shows the error. No run happens without a saved claim.

On first launch of this version, history saved by the browser runner (`atlas:steward:v1` in local storage) is imported once into an empty desktop history. Rust validates every run and drops any link that isn't on github.com. The old copy is left in place, so an earlier build still finds its history after a rollback. Alert responses cached by earlier builds are purged from local storage.

## Notices and change detection

Change notices appear inside Atlas, with Review and Dismiss. A first baseline with missing coverage or findings needs review. After that, a notice needs a changed finding, loss or recovery of coverage, an execution failure or interruption, or recovery from one. Commit churn and changes to a healthy sample size stay quiet. Alert numbers detect replaced alerts even at an unchanged count. A dismissed notice does not return on the next identical run. No OS notifications, external messages or model calls are made. The panel shows the last observation, and marks it stale when daily monitoring is on and it is more than 26 hours old.

## Scope and autonomy

The workflow is a deterministic automation, not an AI agent. It has no write path and no model calls. `ops/github-steward/policy.json` controls only the separate Python collector, not the app. The prompt in `ops/github-steward/prompt.md` describes a possible future agent whose reasoning, remediation and closed-app execution are not implemented. Existing Atlas approvals for merges, re-runs and other write actions are unchanged, and the Steward cannot reach the Actions or merge tokens. Only the shared read token is read.

## Runbook

- **A check shows "Not verified".** Open the run, read the error label, and follow the check's link. `http_403` or `http_404` on alerts usually means the read token lacks Dependabot alerts or code scanning alerts read permission for this repository. `timeout` or `network` means GitHub or the connection. For `http_403` with zero requests left, wait for the hourly reset.
- **Stop all activity.** Press **Pause checks**. To stop at once, quit Atlas: the run is recorded as interrupted.
- **Recover storage.** Quit Atlas, then move `steward/state.json` aside. Atlas starts a fresh history and keeps the audit log. To restore a backup, put it back as `state.json` while Atlas is quit.
- **Roll back a release.** Install the previous signed build. That build uses the browser runner and its own local-storage history, which was left in place, and it ignores `steward/`. Reinstalling this version picks the desktop history up again. The two histories are separate after the first import, so runs made in one don't appear in the other. Note that an earlier build's browser runner keeps its own daily schedule while it is installed.

## Verify access

If a check is not verified, inspect the existing Atlas GitHub connection and its repository-specific read permissions. Do not add a token to browser local storage or grant write/admin access. Scope any permission change separately; the panel never changes credentials or protections. No authenticated GitHub token was added during this integration.

## Validation on October 28, 2026 (browser runner)

The local preview completed seven reads against live GitHub. Metadata, observed commit, three sampled workflows and maintenance file presence were returned. Dependency and code scanning alerts were unavailable under anonymous browser access and correctly marked not verified. Pause disabled Check now; reloading preserved both Pause and the saved run; Resume re-enabled manual checks. The preview was left resumed, with no automatic execution.

Automated checks cover current versus historical CI failures, inconclusive CI, inaccessible/malformed security data, scope and request bounds, pause, elapsed budget and advisory-content minimization. The full test suite, type checking, targeted lint and production build passed. Existing build warnings concern bundle sizes and mixed static/dynamic Tauri imports.

## Daily monitoring validation (browser runner)

Schedule tests cover local calendar boundaries, catch-up, one durable claim per day, shared-lock contention across stores, storage failure, cross-window pause, reloads, failed-run suppression, coverage recovery and quiet unchanged findings. UI verification covered the time control, schedule persistence and one scheduled run without duplicate execution after the preview reloaded. Daily monitoring was enabled in the local preview at 09:00 device time. The first scheduled run used seven reads, remained partial because anonymous access cannot retrieve security alerts, and found no new actionable changes. The next due time displayed October 29, 2026 at 09:00. All 206 tests, type checking, targeted lint and production build passed. This local preview preference does not enable the schedule in an installed desktop app or deploy the code.

## Next stage

Running with Atlas closed would need a separate macOS launch agent with its own credential access. Add one only if daily checks are being missed. Keep writes and paid reasoning disabled until their separate policy gateway, budget reservation, validation and approval boundaries are implemented. Preserve existing Atlas action approvals.
