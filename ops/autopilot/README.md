# Autopilot

Three small automations that run on GitHub Actions with no model calls and no install step (Python standard library only). Each one reads a JSON config in this folder, keeps a tiny state file in the Actions cache between runs, and reports through whichever alert channels are set up.

| Automation | Workflow | Runs | Config | Catalog id |
|---|---|---|---|---|
| Uptime Watch | `autopilot-uptime.yml` | every 15 minutes | `uptime.json` | `autopilot-uptime` |
| Spend Guard | `autopilot-spend-guard.yml` | every 6 hours | `spend-guard.json` | `autopilot-spend-guard` |
| Weekly Digest | `autopilot-digest.yml` | Mondays 12:00 UTC | `digest.json` | `autopilot-weekly-digest` |

Pull requests that change this folder run each workflow as a dry run with no secrets, so a config mistake shows up before it merges.

## Uptime Watch

Requests each URL in `uptime.json` and checks the status code, optional page text and optional headers. A failed check is retried once after 5 seconds. A check must fail on two runs in a row (`failAfter`) before it alerts, then reminds every 12 hours while it stays down and sends a "recovered" note when it comes back. A run that raises a new alert fails, so GitHub's own failed-run email works as the alert even before any channel is set up.

The shipped checks: the Benjaire home page, the contact page (the form must be on it), the contact endpoint (a GET, which the Worker answers with 405, so the route is proven live without creating an inquiry), the portfolio site, and Atlas web still redirecting to Cloudflare Access. Checks never POST.

## Spend Guard

For each budget in `spend-guard.json` it reads the month's spend, works out the percentage of the cap and a month-end projection, and lists the budget's `pauses` agents in the repository variable `SPEND_GUARD_PAUSED` once spend reaches `pauseAtPercent` (80). Sources:

- `anthropic_cost_report`: Anthropic's cost report, for the whole organization or one `workspaceId`. Needs `ANTHROPIC_ADMIN_KEY`. Reading the report costs nothing.
- `ledger`: a spend record an agent keeps itself. Merge Flow's `{"spend": {"month", "usd"}}` is read from its cache.

"Paused" means the agent skips its paid step and keeps its free work. Merge Flow reads the variable and skips only the Claude brief; its triage still runs. The guard sets the variable to exactly the agents over budget on every run, so they come back on their own when a new month starts or a cap is raised. It alerts only when a budget crosses the line, not on every run.

Without `SPEND_GUARD_TOKEN` it only recommends: the summary and alert say which agents it would pause.

Agents that run inside the Mac app (Repository Intelligence, Engineering Review) keep their own in-app caps and are not paused by this.

## Weekly Digest

One GraphQL request covers merged and open pull requests across `digest.json`'s repositories, then one REST request per repository lists the week's workflow runs. Spend and uptime come from the other two automations' saved state. The message leads with **Needs you**: pull requests that are ready, failing, conflicting, behind or have changes requested (the same lanes as Merge Flow), quiet pull requests, workflows whose latest run failed, budgets over the line, paused agents and sites that are down.

ai-ops-atlas is public, so the job summary names public repositories only and counts private ones. The email has everything.

## Alert channels

All optional; set any mix at https://github.com/khaneilcampbell/ai-ops-atlas/settings/secrets/actions and https://github.com/khaneilcampbell/ai-ops-atlas/settings/variables/actions.

| Channel | Secrets | Variables |
|---|---|---|
| Email (Resend) | `RESEND_API_KEY` (sending access, benjaire.com domain) | `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM` (for example `Atlas <alerts@benjaire.com>`) |
| Chat webhook (Slack, Discord, other) | `NOTIFY_WEBHOOK_URL` | |
| Atlas live feed | `ATLAS_FEED_URL`, `ATLAS_FEED_TOKEN` (same as Merge Flow) | |

A `failed` report to the Atlas feed also triggers Atlas's own alert email once that is set up (docs/alerts.md).

## Setup

Nothing is needed for a first run: uptime alerts by failing its run, the digest writes its job summary with the workflow's own token, and the spend guard reads Merge Flow's ledger.

1. **Alerts by email.** Resend free tier, a new API key with sending access only, saved as `RESEND_API_KEY`, plus the two variables above.
2. **Pausing.** A fine-grained token at https://github.com/settings/personal-access-tokens/new, only ai-ops-atlas, permission **Variables: Read and write**, saved as `SPEND_GUARD_TOKEN`.
3. **Anthropic spend (optional).** An Admin API key from https://platform.claude.com/settings/admin-keys saved as `ANTHROPIC_ADMIN_KEY`. An Admin key can also manage the organization's keys and members, so keep it only in this secret; the guard uses it for one GET on the cost report. Skip this step and the guard still watches Merge Flow's ledger.
4. **Private repositories in the digest.** The digest reuses `MERGE_FLOW_TOKEN`. To count private workflow runs too, edit that token and add **Actions: Read**.

## Runbook

- **Stop one.** Disable its workflow from https://github.com/khaneilcampbell/ai-ops-atlas/actions, or set `"enabled": false` in its config.
- **Unpause everything now.** Set the variable `SPEND_GUARD_PAUSED` to `none`, or raise the cap in `spend-guard.json`. The guard rewrites it on its next run.
- **False uptime alarm.** Open the failed run: the summary shows each check's status and reason. A 403 from a site usually means bot protection is challenging GitHub's runners; allow the `atlas-autopilot` user agent or drop that check.
- **Start fresh.** Delete the `uptime-state-*` or `spend-guard-state-*` caches at https://github.com/khaneilcampbell/ai-ops-atlas/actions/caches.
- **Test locally.** `python3 -m unittest discover -s ops/autopilot -p 'test_*.py'`, or any script with `--dry-run`.

## Using it elsewhere

Nothing here is specific to KC's setup except the three config files: URLs, budgets and repository lists all live there, and every channel is an environment variable. Copying this folder and the three workflows into another repository and editing the configs is the whole install. The only tie to Atlas is the optional feed and the digest's reuse of Merge Flow's lanes (`ops/merge-flow/merge_flow.py`).
