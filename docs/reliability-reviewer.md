# Manual Reliability Reviewer

The existing `atlas-reliability-reviewer` on Atlas HQ Floor 3 now has a deterministic Python runner and a manual-only GitHub Actions workflow. Its project, stable ID, desk, and ownership are preserved. There is no schedule and no AI provider code or credential.

## First-batch choices

| Rank | Existing agent | Business value | Effort / reliability / ongoing cost | Decision |
| --- | --- | --- | --- | --- |
| 1 | Atlas Reliability Reviewer | Evidence-linked production CI failures | Small; fixed read-only API calls; zero model cost, bounded GitHub runner/storage use | Implemented in this PR |
| 2 | Commerce Quality Engineer (`commerce-tests`) | Validate Benjaire product preparation | Existing tests should be reused; product inputs and acceptance rules must be confirmed | Existing workflow preserved; no duplicate runner |
| 3 | Benjaire Inquiry Assistant (`skyline-inquiry-assistant`) | Inquiry triage and response drafts | Existing n8n export is a synthetic sandbox; live engine, storage, and intake access unverified | No activation; requires sandbox engine verification |

## Run locally

From the Atlas repository, use your existing GitHub CLI login:

```sh
python3 ops/system-improvements/reliability.py --sha <40-character-main-commit> --output /tmp/atlas-reliability --state /tmp/atlas-reliability-state.json --transport gh
```

The default HTTPS transport is intended for the GitHub runner's ephemeral token. The optional `gh` transport uses existing CLI authentication without printing or storing credentials. Never paste a token into a command, report, or export.

## GitHub and Atlas Output

After this PR is merged, manually dispatch **Atlas reliability review** on main. The workflow reads at most two API pages, publishes a Markdown job summary and JSON/Markdown artifact for 14 days, and caches only complete evidence fingerprints. It never reruns checks, changes code, opens issues, or calls paid AI.

In Atlas, select **Atlas Reliability Reviewer → Output**. Existing workflow observation links its real GitHub run, result, check time, logs, summary, and artifacts. Atlas does not ingest full report files or a live task transcript. A local report does not manufacture GitHub telemetry. The first remote run remains an explicit activation step after merge; the workflow must exist on default main before GitHub permits dispatch.

A succeeded workflow means the report completed, even if the report finds failed CI. Pending/missing evidence yields `incomplete`, a nonzero exit, and an artifact containing the gap. It does not imply production is healthy. An unchanged report retains previous findings and refresh time but generates no new recommendations. No manual `last_run` is fabricated in the manifest.

## Limits and stop control

- At most 10 main-branch push runs and 30 checks on the exact requested commit; at most three recommendations. Older failures may fall outside this sample.
- Ten-second timeout per request; zero retries; two-minute job deadline; one serialized workflow at a time.
- Set repository variable `ATLAS_RELIABILITY_STOP=true` to prevent evidence reads on the next manual run. Locally use the same environment variable. Invalid values fail closed. A stopped report is explicitly marked in its summary, not represented as completed analysis.
- Stop does not cancel a run already underway; use GitHub's cancel action for that. No customer workflow is affected.
- Missing API evidence never advances the deduplication cache. Corrupt state is treated as a cache miss. Fresh complete evidence is compared before generating new recommendations. GitHub cache eviction can cause a repeat report, but there are no external business side effects.
- Model cost is zero. No $1 budget implementation is necessary because no paid AI call is enabled. This does not claim GitHub runner/storage usage is free under every account plan.

## Validation evidence

Unit checks exercise linked failures, complete success, unchanged inputs, changed inputs, corrupt cache, stop-before-read, invalid SHA, timeout/recovery, missing/pending evidence, and bounded CLI transport. Catalog/registry tests preserve Floor 3 and bind this role to its own workflow.

One manual run used actual GitHub evidence for main commit `e0ec4911d3266a99a2037353c85bc5bc22233e88`. It produced a real report with zero model calls. The result was **incomplete**, correctly identifying CI runs `41769552744` and `41769552739` as unfinished. Direct HTTPS was unavailable on this Mac; the existing authenticated CLI transport successfully fetched the evidence. The local run is verified; completed CI health and a hosted workflow run are not claimed.

Revert this PR to remove the runner and its observation binding. No credentials, access settings, schedules, or business services require rollback.
