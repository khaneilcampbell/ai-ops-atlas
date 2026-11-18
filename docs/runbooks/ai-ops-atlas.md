# Runbooks: Atlas

How to check, run, fix and stop each agent in this repository. Facts here come from the code and workflows; the catalog entry in `catalog/ai-ops-atlas.yaml` links to each section.

## Atlas CI

`.github/workflows/ci.yml`. Lint, tests, Rust checks and audits on every pull request and push to `main`. Validated pushes to `main` build the app, then require Khaneil to approve the protected signing job before a separate job publishes it to the rolling `main-build` release that installed copies update from.

- **Healthy:** the latest run on `main` is green in Actions, and the signing deployment has been approved before Atlas offers the new build.
- **Run it:** push or open a pull request. To build the Mac app from a branch, run the workflow by hand with **macos** ticked.
- **When it fails:** open the failed job. `Frontend (types, tests, build)` failures reproduce with `npm ci && npm run lint && npm test && npm run build`; `Desktop shell (Rust tests)` with `cargo test --manifest-path src-tauri/Cargo.toml`. A signing job waiting for approval is expected. A signing failure can mean a protected environment secret is missing or expired. See [CI signing security](../ci-signing-security.md).
- **Careful:** manual branch builds receive no signing keys. Re-runs still need environment approval, and older or equal rolling versions are rejected.
- **Stop it:** disable the workflow in Actions. Branch protection requires its checks, so merges block until it is back on.
- **Updating the app:** pressing **Update** hands the unlocked keys, the current view and the window position to the new copy in memory (`src-tauri/src/handoff.rs`), so a signed update needs no Touch ID or Keychain password. If a prompt appears anyway, the new build failed the same-certificate check (for example an ad-hoc branch build) or the handoff timed out. Atlas then falls back to an ordinary unlock.

## Repository Intelligence

`src-tauri/src/intel/`. Reads one repository read-only and asks Claude for a report. Details in [docs/repository-intelligence.md](../repository-intelligence.md).

- **Healthy:** Intel → Activity shows recent runs as succeeded or reused, and Intel → Costs is under the monthly budget.
- **Run it:** open a repository, **Repository intelligence → Analyze repository**, check the worst-case cost, **Send to Claude**.
- **When it fails:** read the run's trace in Intel → Activity. `401` means the Anthropic key is wrong or revoked (replace it in Settings → Repository intelligence). A run shown as **Blocked** would have gone over the per-run or monthly limit; raise it or wait for the new month. GitHub sections shown as *not assessed* need more token permissions (Settings → GitHub access).
- **Stop it:** cancel the job in Intel → Activity, turn the schedule off in Settings, or remove the Anthropic key. A request already in flight may still be billed.

## Senior Engineering Reviewer

`src-tauri/src/intel/review.rs`. Reviews every catalog repository and agent at once and recommends only. Details in [docs/engineering-review.md](../engineering-review.md).

- **Healthy:** Intel → Engineering review shows a recent review, and Intel → Activity shows the run as succeeded or reused.
- **Run it:** Intel → Engineering review → **Run review**, check the worst-case cost, confirm.
- **When it fails:** read the run's trace in Intel → Activity. It shares the Anthropic key, queue and monthly budget with Repository Intelligence, so a missing key or a used-up budget blocks both. A **Blocked** run would have gone over its own per-review limit ($0.60 default) or the monthly budget. Branch rules shown as *not assessed* usually need admin access the token doesn't have.
- **Stop it:** cancel the job in Intel → Activity, turn the schedule off in Settings → Repository intelligence → Engineering review, or remove the Anthropic key.

## Re-run Failed Jobs

`src-tauri/src/actions/rerun.rs`. Re-runs the failed jobs of one failed run after a native approval. Details in [docs/actions.md](../actions.md).

- **Healthy:** Activity Center shows each attempt with its GitHub answer. Off by default.
- **Turn it on:** Settings → Actions: save a fine-grained token with only **Actions: Read and write** on the chosen repositories, tick the switch and the repositories.
- **When it fails:** the GitHub answer is in the Activity Center. `401` token expired, `403` token lacks Actions write, `404` token can't see the repository. A refusal before sending (run too old, not failed, already re-run, rate limit) is shown with its reason and sends nothing.
- **Stop it:** untick the switch, remove the token, or revoke it on GitHub.

## Merge Pull Request

`src-tauri/src/actions/merge.rs`. Squash-merges a ready pull request after a native approval and Touch ID. Details in [docs/actions.md](../actions.md#merging-a-pull-request).

- **Healthy:** Activity Center shows each attempt with its GitHub answer. Off by default.
- **Turn it on:** Settings → Actions: tick **Merge pull requests**, then for each repository save its own fine-grained token (only that repository, **Pull requests** and **Contents** read and write, 90 days or less) and tick it.
- **When it fails:** `409` means the branch moved after approval and nothing merged; re-check and try again. `405` means GitHub refused (for example squash merges off). A pull request that isn't ready is refused before anything is sent, with the reason.
- **Stop it:** untick **Merge pull requests** or the repository, remove its token, or revoke it on GitHub.

## Production Coordinator

An owning agent with no model of its own. Its main step is Merge Flow (`ops/merge-flow/README.md`); on request Khaneil asks the Release Coordinator in n8n chat or Claude Code for a review. It never merges, deploys or bypasses a check.

- **Healthy:** Merge Flow's latest run is green and every open pull request has a lane.
- **When it fails:** follow [Merge Flow's runbook](../../ops/merge-flow/README.md#runbook).

## Release Coordinator

The n8n agent "Atlas Release Coordinator" (chat only, no tools, claude-sonnet-5-5 through n8n's AI gateway). Budget guardrail: $1 a month and $0.25 a session.

- **Healthy:** a chat answer leads with the priority and the next safe action, and never suggests skipping a check. Last production chat: 2026-11-05.
- **Run it:** open the agent's chat in n8n and paste the issues, pull requests or CI results to reason about. It works only from what you paste.
- **When it fails:** a budget stop means the cap was hit; wait for the new month or raise it in the agent's guardrails.
- **Stop it:** unpublish the agent in n8n.

## Building operators

Dataset Census is `ops/building-agents/agents.py`, run by `.github/workflows/building-agents.yml` every 3 hours at :10. No model calls.

- **Healthy:** the workflow's scheduled runs are green and the Data Intelligence Center shows a recent report in Atlas.
- **Run it:** Actions → Building agents → Run workflow, pick `census` or `all`.
- **When it fails:** a `401` or `403` from the feed means the `ATLAS_FEED_TOKEN` or `ATLAS_FEED_URL` repository secret is wrong. GitHub's schedule can run late by up to an hour; that is not a failure.
- **Stop it:** disable the workflow in Actions. The Data Intelligence Center then shows their last report as stale.

## Atlas Data Inventory

Two parts: `.github/workflows/map-inventory.yml` writes `atlas-inventory.json` to the `atlas-inventory` branch on each push to `main`, and the n8n workflow [Atlas · Data Inventory](https://khancam15.app.n8n.cloud/workflow/Hua0wdGB5WSDjSGB) (published 2026-11-13) rewrites four tabs of the Atlas Agent Registry sheet daily at 7:20am New York time (moved from 7:00 on 2026-11-17 so it no longer shares the minute with Business Structure). No model.

- **Healthy:** the morning run has no failed execution in n8n (successful runs are not saved) and the sheet's Inventory Summary tab shows today's date.
- **When it fails:** "Flow · 0 Error alerts" emails ops. The 2026-11-16 run failed at **Write Map Objects** with the Google Sheets "Write requests per minute" quota; since 2026-11-17 it pauses 30 seconds before that tab and retries each sheet write up to 5 times, so a repeat means the quota itself is too low; run it again by hand after a minute.
- **Stop it:** unpublish the workflow in n8n; the sheet keeps its last tabs.

## Release Manager

An owning agent with no model of its own. Its automations are Atlas CI, Re-run Failed Jobs and Merge Pull Request (sections above). Merges and re-runs only happen when Khaneil presses the button in Atlas and approves.

## Health Monitor

An owning agent with no model of its own. Its automations are Dataset Census ([Building operators](#building-operators)) and [Atlas Data Inventory](#atlas-data-inventory). Incident playbooks are off by default; see [docs/autonomous-operations.md](../autonomous-operations.md).
