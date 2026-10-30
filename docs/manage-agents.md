# Manage agents

Agents → **Manage agents** lists the agents Atlas can manage: the ones that run on GitHub Actions in this repository. Each row shows status, schedule (in words, UTC, with the next run), the last run, the monthly cap and the building the agent works in. The building opens the map with that building selected. **Details** shows the last 10 runs on main.

This first version is **read-only**. Enable/disable, Run now, and schedule or cap changes come next, in the Mac app only, each with a before/after diff, a native confirm, Touch ID and an audit line. Schedule and cap changes will open a pull request, never commit to main. The web app stays read-only.

## The allow-list: `src/manage/agents.json`

Only agents listed here appear, and later only these workflows and policy keys can be changed.

| Field | Meaning |
|---|---|
| `id` | Catalog agent id. Must exist in `catalog/` with `observe.github_workflow` set to `workflow`. |
| `workflow` | File under `.github/workflows/`. It must have exactly one `schedule` cron line and `workflow_dispatch`. |
| `schedule` | That cron line, exactly as on main. |
| `alsoRuns` | Other triggers in words. |
| `paid` | Calls a paid API. Paid agents run at most every 4 hours; others at most every 15 minutes. |
| `cap` | `file` (a JSON policy under `ops/`), `key` (dotted path to the monthly cap in dollars), `usd` (its value on main) and `maxUsd` (the most it can ever be set to, never above $5). |

`src/manage/manifest.test.ts` fails if an entry drifts from its workflow or policy file, breaks a limit, or names Atlas's own CI, release, CodeQL or visual workflows.

To add an agent (for example Spend Guard, Uptime Watch and Weekly Digest once PR #118 merges), add an entry and run `npm test`.

## Data use

The view reads GitHub only when it opens and when you press Refresh: one request for every workflow's state, plus one per agent for its runs on main. Requests send `If-None-Match`, so unchanged answers are 304s. Nothing polls. If GitHub can't be read or refuses the token, the view says so and still shows schedules and caps from Atlas itself, with unread fields marked Unknown.

The web build's GitHub proxy (`server/github.ts`) gained one read-only path, `/repos/{owner}/{repo}/actions/workflows`.
