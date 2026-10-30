# Merge Flow

Merge Flow is the agent in the GitHub building (project `github-profile`, agent `github-merge-flow`). It looks at every open pull request across the repositories in `policy.json`, puts each one in a single lane, and names the next move that gets it merged to production sooner. It only recommends. KC still merges, by saying "merge" or with the Merge button in Atlas (`atlas-merge-pr`), and failed runs are still re-run through Re-run Failed Jobs (`atlas-rerun-failed`).

## How it runs

`.github/workflows/merge-flow.yml` runs every 4 hours, whenever a pull request's CI finishes in ai-ops-atlas, and on demand (Actions, Merge flow, Run workflow). Each run:

1. Restores the last triage fingerprint from the Actions cache.
2. Sends **one** GraphQL request covering all repositories: the first 20 open pull requests each (number, title, draft, merge state, review decision, check rollup, failing check names) and the last 10 merged (for time to merge). The first live run (8 public repositories, 45 open pull requests) took about 50 KB and 5 points of the 5,000-point hourly budget. REST ETags don't apply to GraphQL, so one query replaces the 100 or more REST calls the same facts would need.
3. Sorts each pull request into a lane, first match wins: draft, conflicts, failing, changes requested, checks running, behind base, ready to merge, needs review, blocked by a rule, still computing. A pull request with no activity for 7 days is also marked stale.
4. Hashes repository, number, head commit, lane, stale flag and failing check names. **If the hash matches the last run, it stops**: no Claude call, no summary, no feed report. Comments, label changes and other churn don't change the hash.
5. When the triage changed and at least one pull request is ready, failing, behind, conflicting, has changes requested or is stale, it asks Claude (`prompt.md`, model and caps in `policy.json`) for at most five lines of next moves. The SDK is installed only for that step. Caps are checked before the call: 4 briefs a day and $1 a month, reserving the worst case first.
6. Writes the job summary and, if configured, one line to Atlas's live feed, then saves the new fingerprint.

At least one report goes out every 24 hours (`heartbeatHours`) even when nothing changed, so a quiet agent is distinguishable from a dead one.

## Privacy

ai-ops-atlas is public, so its Actions logs and job summaries are public. The log prints counts only. The job summary lists public pull requests in full but private repositories only as a count, and a brief that mentions a private repository is left out of the summary and goes only to Atlas's feed, which sits behind Cloudflare Access. The cached state holds a fingerprint, timestamps and spend, nothing else. Pull request runs of this workflow are dry runs with no secrets.

## Setup

Nothing is required for the first run: with only the workflow's own token it reads the public repositories. To cover everything:

1. **Private repositories.** Create a fine-grained token at https://github.com/settings/personal-access-tokens/new: resource owner khaneilcampbell, only the repositories in `policy.json`, read-only **Pull requests**, **Contents**, **Commit statuses** and **Metadata**. Save it as the repository secret `MERGE_FLOW_TOKEN` at https://github.com/khaneilcampbell/ai-ops-atlas/settings/secrets/actions/new.
2. **Brief.** Add `ANTHROPIC_API_KEY` at the same page. Without it the triage still runs and reports; only the brief is skipped.
3. **Atlas feed (optional).** Add `ATLAS_FEED_URL` (`https://ai-ops-atlas.pages.dev/api/hooks/agents`) and `ATLAS_FEED_TOKEN` (the site's `AGENT_FEED_TOKEN`) to see each report in Atlas, private pull requests included. See `docs/live-updates.md`.

## Limits

- Never merges, approves, pushes, comments, closes, re-runs or changes settings. The workflow's token is read-only, and so is `MERGE_FLOW_TOKEN`.
- First 20 open pull requests per repository and 25 check results per pull request.
- Lanes come from GitHub's merge state, so a repository without branch protection reports `CLEAN` as soon as there are no conflicts. Atlas's Merge button still re-checks every rule before merging.

## Runbook

- **Stop it.** Disable the workflow at https://github.com/khaneilcampbell/ai-ops-atlas/actions/workflows/merge-flow.yml (the "..." menu, Disable workflow), or set `"enabled": false` in `policy.json`.
- **Stop only the Claude call.** Delete the `ANTHROPIC_API_KEY` secret, or set `brief.maxPerDay` to 0.
- **A run failed.** Open it from Atlas or the Actions page. `GitHub returned no data` means the token can't read any listed repository; check `MERGE_FLOW_TOKEN`. `Brief failed` leaves the triage intact.
- **Force a fresh report.** Delete the `merge-flow-state-*` caches at https://github.com/khaneilcampbell/ai-ops-atlas/actions/caches and run the workflow.
- **Test locally.** `python3 -m unittest discover -s ops/merge-flow -p 'test_*.py'`, or `GITHUB_TOKEN=$(gh auth token) python3 ops/merge-flow/merge_flow.py triage --dry-run`.
