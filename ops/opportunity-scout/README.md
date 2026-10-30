# Opportunity Scout

Opportunity Scout is the second agent in the GitHub building (project `github-profile`, agent `github-opportunity-scout`), next to Merge Flow. It reads Atlas's own agent registry and asks one question: which of the agents and repositories KC already runs could make money, and what small agent would turn the best idea into revenue? It only recommends. Building, spending, contacting anyone and publishing stay with KC.

## How it runs

`.github/workflows/opportunity-scout.yml` runs when catalog files change on main, on Monday and Thursday at 13:41 UTC, and on demand (Actions, Opportunity scout, Run workflow). Each run:

1. Restores the last fingerprint, spend and previous idea titles from the Actions cache.
2. Reads every `catalog/*.yaml` from the checkout and keeps only identity, status, type, category, framework and a 240-character purpose for each project and agent (about 16 KB for 11 projects and 43 agents). **No API reads**: the registry is already in the repository.
3. Hashes that digest together with `prompt.md`. **If the hash matches the last run, it stops**: no Claude call, no summary, no feed report. Run history, links and `last_run` fields are not in the digest, so they never trigger a run.
4. When the registry changed (or `fresh` was ticked), it asks Claude (`prompt.md`, model and caps in `policy.json`) for up to 3 ideas and one agent spec, as JSON that must match a closed schema. The SDK is installed only for that step. Caps are checked before the call: 4 runs a day and $1 a month, reserving the worst case first. A failed call still counts toward the daily cap.
5. Ranks the ideas with a fixed formula, `(2 x revenue + effort + cost + risk) / 5`, where every scale runs 1 to 5 and 5 is best, so the ranking never depends on the model's arithmetic. Then it checks each claim against the registry: agents that don't exist are dropped, agents that are paused or planned are flagged, the spec's building must be a real project, its cap is lowered to $5 a month at most, and a spec without a human approval point is marked as not ready to build.
6. Sends the whole report (ranked ideas, reuse and risks, the spec, and the checks) to Atlas, which keeps the newest 20 behind Cloudflare Access, and one line to Atlas's live feed. Writes the job summary, then saves the new fingerprint and the idea titles, so the next run doesn't repeat itself.

At least one report goes out every 7 days (`heartbeatDays`) even when nothing changed, so a quiet agent is distinguishable from a dead one. A skipped call (no key, cap reached, failure) keeps the change pending, so the next run with room retries it.

## Privacy

ai-ops-atlas is public, so its job summaries are public. Once Atlas has stored a report (`POST /api/hooks/reports`, 202), the summary only says how many ideas there are and where to find them: GitHub Profile building, Opportunity Scout, Reports. Atlas shows each report in full there, with its history and a Download PDF button; the PDF is built on the device, nothing else sees it. If Atlas isn't set up or refuses the report, the summary falls back to the full report, or to titles and scores with `"publishDetails": false` in `policy.json`. The cached state holds a fingerprint, timestamps, spend and the last idea titles, nothing else. Pull request runs are dry runs with no secrets.

## Setup

Nothing is required for the first run: without a key it reads the registry and reports that it changed.

1. **Ideas.** Add `ANTHROPIC_API_KEY` at https://github.com/khaneilcampbell/ai-ops-atlas/settings/secrets/actions/new. It is shared with Merge Flow; a key from a workspace with its own small spend limit is safest.
2. **Reports in Atlas.** Add `ATLAS_FEED_URL` (`https://ai-ops-atlas.pages.dev/api/hooks/agents`) and `ATLAS_FEED_TOKEN` (the site's `AGENT_FEED_TOKEN`). The scout sends the headline to that URL and the full report to the same site's `/api/hooks/reports` (or `ATLAS_REPORTS_URL` if set). See `docs/live-updates.md`.
3. **First ideas.** Run the workflow by hand at https://github.com/khaneilcampbell/ai-ops-atlas/actions/workflows/opportunity-scout.yml with `fresh` ticked.

## Limits

- Never spends money, messages anyone, publishes, merges, pushes, comments or changes settings. The workflow's token is read-only.
- Ideas come only from the registry. There is no market data, so revenue, time to first dollar and running cost are the model's estimates and say so in the report.
- At most 3 ideas and one spec per run; at most 4 runs a day and $1 a month.

## Runbook

- **Stop it.** Disable the workflow at https://github.com/khaneilcampbell/ai-ops-atlas/actions/workflows/opportunity-scout.yml (the "..." menu, Disable workflow), or set `"enabled": false` in `policy.json`.
- **Stop only the Claude call.** Set `model.maxPerDay` to 0, or delete `ANTHROPIC_API_KEY` (this also stops Merge Flow's briefs).
- **Get new ideas now.** Run the workflow with `fresh` ticked. Caps still apply.
- **A run failed.** `Ideas failed` leaves the scan intact and retries on the next run. A `Checks` section in the summary lists anything the scout dropped or lowered.
- **Start over.** Delete the `opportunity-scout-state-*` caches at https://github.com/khaneilcampbell/ai-ops-atlas/actions/caches. This also resets the month's spend record, so the next run may spend up to one more call.
- **Test locally.** `python3 -m unittest discover -s ops/opportunity-scout -p 'test_*.py'`, or `python3 ops/opportunity-scout/scout.py scan --dry-run`.
