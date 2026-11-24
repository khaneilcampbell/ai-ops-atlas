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

## Atlas Executive

`server/executive/engine.ts`, state in the `atlas.exec_*` tables. Turns a goal from Mission Control into a checked plan, assigns registered agents, sends outside work to n8n **Atlas · Executive Dispatch** and completes a goal only after Atlas verifies the result. Details in [docs/executive-agent.md](../executive-agent.md).

- **Healthy:** Mission Control → Atlas Executive shows each goal's state, and n8n **Atlas · Executive Schedule** runs every 30 minutes with a 200 answer.
- **Turn it on:** apply `db/migrations/0002_executive.sql`, publish both n8n workflows, then set the catalog entry to `active`.
- **When it fails:** a goal says why in its state reason and history. `BLOCKED` with "No eligible agent" means the agent it needs is paused or missing in the catalog; `FAILED` after 3 attempts means n8n or the checks kept failing; a `503` from the panel means migration 0002 isn't applied.
- **Stop it:** the emergency stop holds every dispatch; pausing or cancelling a goal stops new work for it; unpublishing the dispatch workflow stops all outside work.

## Atlas Engineering Division

**Atlas Engineering** (`atlas-engineer`) and **Atlas Quality Assurance** (`atlas-qa`), both reporting to Atlas Executive. A failed CI run on `main` becomes an engineering goal; n8n **Atlas · Engineering Dispatch** starts `.github/workflows/atlas-engineer.yml`, Claude Code edits with no shell, a job with no secrets runs the checks, Atlas QA reads the real results from GitHub, and n8n **Atlas · GitHub PR Delivery** opens the pull request. Nothing merges. Details in [docs/engineering-division.md](../engineering-division.md).

- **Healthy:** Mission Control → Engineering Operations lists incidents and executions with their phase, QA outcome and pull request; the runner's last run on the [Atlas Engineer workflow page](https://github.com/khaneilcampbell/ai-ops-atlas/actions/workflows/atlas-engineer.yml) ended in `report` posting a 202.
- **Turn it on:** follow the setup list in [docs/engineering-division.md](../engineering-division.md#switching-it-on), last step `ATLAS_ENGINEERING_ENABLED=true`.
- **When it fails:** each failure becomes a Task Center task for Khaneil with the reason. `QA FAIL` twice means the fix didn't hold; `BLOCKED` means GitHub couldn't be read and QA retries; a runner run with no report means `ATLAS_ENGINEERING_RESULT_URL` or the callback key is missing, and Atlas times the attempt out.
- **Stop it:** the emergency stop holds every dispatch; set `ATLAS_ENGINEERING_ENABLED` to anything but `true` to stop new repairs; disable the Atlas Engineer workflow on GitHub to stop the runner itself. Delete stale `atlas-eng/` branches by hand.

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

An owning agent with no model of its own. Its automations are Dataset Census ([Building operators](#building-operators)), [Atlas Data Inventory](#atlas-data-inventory) and [Investment Operations](#investment-operations). Incident playbooks are off by default; see [docs/autonomous-operations.md](../autonomous-operations.md).

## Investment Operations

Paused. Fixed rules in `src/finance/investments.ts`, shown in the Investment Operations Center panel. No model, no data source, no credential and nothing stored: the panel shows only an invented preview, labelled as such. Details and why nothing is connected: [docs/benjaire-finance.md](../benjaire-finance.md#investment-operations-center).

- **Healthy:** the panel reads "Not connected" and "Last sync: Never" until a supported read-only source exists. It must never show Synced for the synthetic preview.
- **When it fails:** a refused snapshot lists field names only; never copy a payload into an issue, log or chat.
- **Stop it:** nothing runs on its own. Remove the section from `DetailPanel.tsx` or revert the pull request.

## Trading desk

Trade Desk and Market Research (AI agents, desks in Atlas HQ) and Risk and Limits, Trade Journal and
Trading Reporting (automations at Robin Exchange, owned by Atlas Health Monitor). All paused while trading is off. Details: [docs/benjaire-finance.md](../benjaire-finance.md#trading-desk).

- **Healthy:** the Trading desk tab reads "Trading is off in Atlas", the weekly limit shows $80, and
  the log is empty or lists only entries that passed the limits.
- **When it fails:** a refused journal lists field names only; never copy a journal into an issue,
  log or chat. A "Weekly limit reached" or "rejected by Robinhood" alert means stop and look.
- **Stop it:** keep (or put back) the Robinhood order tools in the deny list in
  `~/.claude/settings.json` on the Mac; with Robinhood trade approvals on, every order also waits for
  Khaneil in the Robinhood app. Disconnect in the panel deletes the snapshot and journal.
