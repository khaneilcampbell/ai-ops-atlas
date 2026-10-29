# Runbooks: AI Ops Atlas

How to check, run, fix and stop each agent in this repository. Facts here come from the code and workflows; the catalog entry in `catalog/ai-ops-atlas.yaml` links to each section.

## Atlas CI

`.github/workflows/ci.yml`. Lint, tests, Rust checks and audits on every pull request and push to `main`. Validated pushes to `main` build the app, then require KC to approve the protected signing job before a separate job publishes it to the rolling `main-build` release that installed copies update from.

- **Healthy:** the latest run on `main` is green in Actions, and the signing deployment has been approved before Atlas offers the new build.
- **Run it:** push or open a pull request. To build the Mac app from a branch, run the workflow by hand with **macos** ticked.
- **When it fails:** open the failed job. `Frontend (types, tests, build)` failures reproduce with `npm ci && npm run lint && npm test && npm run build`; `Desktop shell (Rust tests)` with `cargo test --manifest-path src-tauri/Cargo.toml`. A signing job waiting for approval is expected. A signing failure can mean a protected environment secret is missing or expired. See [CI signing security](../ci-signing-security.md).
- **Careful:** manual branch builds receive no signing keys. Re-runs still need environment approval, and older or equal rolling versions are rejected.
- **Stop it:** disable the workflow in Actions. Branch protection requires its checks, so merges block until it is back on.

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
