# Event-driven agent runs

Agents start when something meaningful changes, not on a timer. The site already receives GitHub
webhooks and pipeline reports (`docs/live-updates.md`); `server/triggers.ts` decides, in plain code,
which ones wake an agent:

| Event | Wakes an agent when |
| --- | --- |
| Workflow run on the default branch | It **starts** failing (`failure`, `timed_out`, `startup_failure`). Deploy, release, Pages and publish workflows are labelled "deploy", the rest "ci". Repeats while it keeps failing do nothing; the next success clears it. Branch and PR runs never wake one. |
| New issue | Opened by an allowed author (default `khaneilcampbell`; the repo is public). Issues labelled `claude-fix` are left to Fix with Claude. Once per issue. |
| Pipeline report (`/api/hooks/agents`) | A phase reports `failed` after being fine. |

At most 5 wakes a day. Only repositories in `TRIGGER_REPOS` count (default `khaneilcampbell/ai-ops-atlas`).
Every wake shows in Atlas's live feed: **Agent started**, **Agent ready** (no routine set up yet: start
it with Fix with Claude) or **Agent couldn't start** (the next failure tries again).

## Setup (one step at a time)

1. GitHub App events: tick **Issues** (read-only permission, then the Issues event) at
   https://github.com/settings/apps/kc-atlas-live/permissions. Workflow runs already arrive.
2. Routine: at https://claude.ai/code/routines create "Atlas: Event trigger" on
   `khaneilcampbell/ai-ops-atlas`, no connectors, prompt = `ops/event-triggers/routine.md` below the line.
   Add an **API** trigger and generate its token (shown once).
3. Cloudflare Pages → ai-ops-atlas → Settings → Variables and secrets (production): add
   `TRIGGER_FIRE_URL` (the routine's /fire URL) and `TRIGGER_FIRE_TOKEN` (secret), then redeploy.
   https://dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f/pages/view/ai-ops-atlas/settings/production

Until step 3, triggers are recorded as "Agent ready" and nothing runs on its own. To turn waking off,
delete `TRIGGER_FIRE_TOKEN`.

Optional: `TRIGGER_REPOS` and `TRIGGER_ISSUE_AUTHORS`, comma separated.
