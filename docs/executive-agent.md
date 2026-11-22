# Atlas Executive (Phase 1 control plane)

Atlas Executive (`atlas-executive`, Central AI Orchestrator, Atlas Headquarters, default autonomy
level 2) turns a goal into a checked plan, assigns registered agents, sends outside work to n8n and
completes the goal only when Atlas itself has verified the result. This page is the architecture
audit, the design and the setup steps.

What it is not: a free-running autonomous agent. It plans from fixed templates (one today), runs
only when Khaneil gives it a goal, and never publishes, spends, sends, merges or deletes on its own.

## Architecture audit

### A. Reused

| Need | Existing piece |
| --- | --- |
| Durable state | PostgreSQL data foundation (`server/data/db.ts`, Hyperdrive `ATLAS_DB`, `atlas.goals`, `atlas.tasks`, `atlas.agent_runs`, `atlas.approvals`, `atlas.ai_notes`) |
| Agent registry | Catalog on `main` (`catalog/*.yaml`, `buildCatalog`), capability grants (`src/intelligence/capabilities.ts`) |
| Approvals UI and decision route | Task Center database card, `/api/data/approvals/<id>/decision` (owner only, reviewer recorded) |
| Global pause | Phase 9 emergency stop (`server/opsControl.ts`, D1 `LIVE`) |
| n8n bridge keys and credentials | `N8N_BRIDGE_TOKEN`, `N8N_BRIDGE_CALLBACK_TOKEN`, n8n credentials "Atlas bridge (webhook)", "Atlas bridge (callback)", "Anthropic (Benjaire)" (same as Atlas · Step Runner) |
| Research worker | Product Lab Market Research (`benjaire-product-lab-research`), already granted web research |
| Access control | Cloudflare Access middleware on `/api/*`, bearer keys on `/api/hooks/*` |

### B. Gaps found

- Phase 8 Executive goals live in each device's local storage: no shared state, no restart
  recovery, no server-side execution.
- Nothing bound an approval to an exact action, so a changed action could reuse an old yes.
- No goal-to-run correlation: runs, costs and results were not tied back to a goal.
- No result verification: a workflow saying "done" was the only signal.
- Atlas · Step Runner has no tools, so it can't cite real web sources.

### C. Changes

- `db/migrations/0002_executive.sql` (additive): `atlas.exec_goals`, `exec_plans`, `exec_tasks`,
  `exec_artifacts`, `exec_events`. Each executive goal also writes an `atlas.goals` row, each task an
  `atlas.tasks` row, each dispatch an `atlas.agent_runs` row, so Task Center and the data overview
  show them.
- `src/executive/control/`: pure rules (lifecycle, plan schema and checks, agent selection, autonomy
  and approval binding, result contracts, report verification) with unit tests.
- `server/executive/`: the engine (state machine in Postgres transactions), the n8n adapter, the
  registry loader and the routes. A mock adapter exists for tests only.
- `functions/api/executive/[[path]].ts`, `functions/api/hooks/executive-result.ts`,
  `functions/api/hooks/executive-tick.ts`.
- Mission Control → **Atlas Executive** panel (`src/views/executive/ExecutiveControl.tsx`).
- n8n drafts: **Atlas · Executive Dispatch** (`uNF4qBQDwVb37ygb`) and **Atlas · Executive Schedule**
  (`J1bzNxcwUTPC9yw9`). SDK copies in `ops/n8n/` to recreate them.
- Catalog: `atlas-executive` in `catalog/ai-ops-atlas.yaml` (paused until n8n is published),
  `research.opportunity_report` and `executive.verify` capabilities.

### D. Security risks and how they are handled

| Risk | Handling |
| --- | --- |
| Browser reaching n8n | Only the site's server code calls n8n. The page calls `/api/executive/*` behind Access. |
| Forged or replayed results | Bearer key, plus task id, attempt, correlation id, idempotency key and a one-time nonce (stored hashed). Each event id is stored once. Late results from an earlier attempt are logged and ignored. |
| Duplicate dispatch | Atomic `UPDATE … WHERE state = 'ready' AND attempts = n` claim; unique idempotency key per attempt; one `agent_runs` row per key. |
| Prompt injection from web pages | The n8n prompt marks the goal and pages as data; output must match a strict JSON schema; sources must come from the run's own search results. |
| Runaway cost | Per-goal budget (default $1, max $5) reserved before dispatch, $0.60 cap per research task, 5 searches per run, 10 dispatches a day, one task per agent at a time, 3 attempts, 5 open goals. |
| Self-approval | An approval only counts if its reviewer exists and differs from the requester, and its stored hash matches the exact action, target, parameters and agent. 48-hour expiry. |
| Secrets | None in code. Keys are Pages secrets and n8n credentials. |

### E. Sequence

1. Khaneil submits a goal (`POST /api/executive/goals`): `GOAL_RECEIVED`.
2. The engine validates it (`GOAL_VALIDATED`), drafts a plan from a template (`PLAN_GENERATED`),
   checks it (`PLAN_CHECKED`), writes tasks (`TASKS_CREATED`) and assigns agents
   (`AGENTS_ASSIGNED`).
3. Authorization: allowed within the goal's autonomy and the $1 auto-spend ceiling
   (`EXECUTION_AUTHORIZED`), otherwise an approval request (`AWAITING_APPROVAL`).
4. Dispatch to n8n with a signed envelope (`EXECUTION_STARTED`, `EXECUTION_MONITORED`).
5. n8n posts the result; Atlas verifies it. Failed checks retry up to 3 attempts.
6. The verify task summarises the verified report (`RESULTS_VERIFIED`) and the goal completes
   (`GOAL_COMPLETED`).
7. Every 30 minutes the schedule asks Atlas to reconcile: stalled attempts (lease ran out) retry or
   fail, approvals expire. It never creates goals or tasks.

Side states: `PAUSED`, `BLOCKED` (with the reason), `FAILED`, `CANCELLED`.

## Autonomy levels

| Level | Meaning | Examples |
| --- | --- | --- |
| 1 Observe | Read-only work runs; anything else needs approval | status reads |
| 2 Safe Execution (default) | Work inside Atlas and budgeted research run | opportunity report |
| 3 Conditional execution | Allowlisted outside changes (none are allowlisted today) | – |
| 4 Owner Approval | Always waits for Khaneil | publish, spend, send, merge, delete |

## The opportunity report slice

Goal: "Research one potential Benjaire AI automation product and prepare a structured opportunity
report." Plan: research (Product Lab Market Research through Executive Dispatch, claude-sonnet-5-5 with
at most 5 web searches) → verify and summarise (inside Atlas, no model).

The report must have all seven sections (target customer problem, proposed solution, competitor
overview, market evidence, technical feasibility, business risks, recommended next step), at least
3 https sources that appeared in the run's own web search results, valid citations, and citations
on competitors and market evidence. Otherwise it is not accepted.

## Setup (Khaneil)

Nothing is live until these are done, in order:

1. Merge the pull request.
2. Apply the migration from your Mac: `ATLAS_MIGRATE_DATABASE_URL='postgres://…' node scripts/db-migrate.mjs` (the owner
   connection string, never on the site).
3. Check the site has `N8N_BRIDGE_TOKEN` and `N8N_BRIDGE_CALLBACK_TOKEN` (already set for the Step
   Runner). Optional: `GITHUB_TOKEN` for reading the catalog (public repository, so not needed).
4. Publish **Atlas · Executive Dispatch** and **Atlas · Executive Schedule** in n8n.
5. Set `atlas-executive` to `status: active` in `catalog/ai-ops-atlas.yaml` (a small pull request).

## Rollback

Unpublish the two n8n workflows (stops all outside work at once), or turn on the emergency stop.
Reverting the pull request removes the panel and routes; `db/migrations/0002_executive.down.sql`
drops the tables if ever needed.
