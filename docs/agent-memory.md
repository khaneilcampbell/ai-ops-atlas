# Agent memory and task memory

Agents and n8n workflows can look up what happened before they run, avoid repeating work, reuse
methods Khaneil has verified, and learn from failures, all through the existing Atlas data API and
the same PostgreSQL database (Supabase, through the Hyperdrive binding). No new database, no vector
store, no model calls: every decision is a query and fixed rules.

Code: `db/migrations/0003_agent_memory.sql` (+ `.down.sql`), `server/memory/service.ts`,
`src/data/memory.ts` (checks and shapes shared with the page), routes in `server/data/api.ts`,
UI in `src/views/tasks/MemoryPanels.tsx`. Tests: `server/memory/memory.test.ts`.

## Architecture assessment (Nov 22, 2026)

What already existed and is reused, not copied:

| Need | Already in Atlas | Used for |
| --- | --- | --- |
| Task history, run ids | `atlas.agent_runs` (one row per run, unique `idempotency_key`, `external_run_id`, tokens, cost) | Prior executions, attempts, stale detection |
| Assignments | `atlas.tasks` | Duplicate prevention (`dedupe_key`) |
| Approved decisions, docs | `atlas.decisions`, `atlas.documents` | Shared knowledge stays there; memory points at it (`source_kind`) |
| Approval gate | `atlas.approvals` | Consequential actions still go through it |
| Model notes about records | `atlas.ai_notes` | Unchanged |
| Retry-safe writes | `atlas.idempotency_keys` | Every memory write takes an `Idempotency-Key` |
| Per-agent least privilege | `server/data/policy.ts` (areas, tables, document categories) | Memory read/write is one more line per key |
| Memory model | `src/intelligence/` (device-only: categories, verification, scope, retrieval) | Same categories and rules, now on the server |

Gaps found:

1. **Memory lived only in one browser.** The Agent Intelligence memory is localStorage, so n8n and
   agents could never read it.
2. **A run could stay "Running" for days.** Live check on Nov 22: run `#842` of the Task Writer
   (`aYk4xDGoE4HgAi2G`) was recorded as running on Nov 20 13:34 UTC and never finished in Atlas,
   although n8n shows execution 842 succeeded at 13:34:40. That draft posted its start but not its
   finish, and nothing in Atlas ever noticed.
3. **Two successful runs looked like one.** The database card labelled each run with the workflow
   id, so executions 878 and 879 (seven seconds apart, both succeeded, both from
   `aYk4xDGoE4HgAi2G`) appeared as the same run twice. They were two separate runs with their own
   keys (`task-desk-878`, `task-desk-879`); the second correctly found its task already filed. The
   card now shows `Run #879`, `Run #878`.
4. No stable name for a recurring job, no lock against two workers, no retry policy, no record of
   whether a run met its success criteria.

Not needed yet: semantic (vector) retrieval. Memory is small and keyed by job, workflow, project and
error class, which exact matching handles. Add `pgvector` only when a real use case misses with words.

## Schema changes (migration 0003, additive)

- `agent_runs`: `task_key` (the job's stable name), `attempt`, `heartbeat_at`, `lease_until`, status
  `timed_out`, and a unique index allowing **one live run per agent and task key**.
- `tasks`: `dedupe_key`, unique among open tasks.
- `memory_items`: agent memory, procedures, lessons and shared facts with provenance
  (`source_kind/ref/url`, `run_id`), scope (`area`, `agent_id`, `project_id`, `workflow_id`,
  `task_key`, `error_class`), `sensitivity` (the document access categories), verification,
  revision (`supersedes`/`superseded_by`), retention (`expires_at`, `review_at`, `retired_at`) and
  usage (`use_count`). The database itself refuses agent rows that claim Khaneil-only categories.
- `run_feedback`: one validation result per run (checks, verdict, quality, error class, retryable,
  duration, memory used).
- `memory_events`: audit trail (ids and short notes, never content), including every pre-run check
  with its decision and estimated tokens saved.

Categories (same as Agent Intelligence): `working` (expires, 7 days default, 30 max),
`operational` (agents write it unverified), `project_knowledge` and `human_approved` (Khaneil only).
Kinds: `fact`, `procedure`, `lesson`, `context`.

## Trust rules

- Agents write `working` and `operational` memory only, and it is always **unverified**. Only
  Khaneil verifies, disputes, revises or retires (`POST memory/<id>/review`). A verified
  `procedure` is the only thing returned as a trusted method.
- "Passed" needs checks: feedback claiming `passed` with no checks is kept as `unverified`; with a
  failed check it is `partial`.
- Secrets are refused (same patterns as `src/intelligence/guard.ts`). Instruction-like text is held:
  stored, but never handed to an agent until Khaneil verifies it.
- An agent sees memory only in its areas and document categories, shared or its own, never
  `restricted`, never disputed. Read and write are separate grants (`memory: "read" | "write"` in
  `server/data/policy.ts`). The database password never reaches the page, the Mac app or agents.
- Revisions are new rows that supersede the old one, so what an agent was told stays on record.

## The pre-run check

Call it before every recurring job. One request, no model:

```
POST /api/hooks/data/memory/prepare          Authorization: Bearer <agent key>
{ "agentId": "task-writer", "taskKey": "task-desk:daily-scan:2026-11-22", "area": "business",
  "objective": "Daily scan: file new tasks from n8n failures", "workflowId": "aYk4xDGoE4HgAi2G",
  "budgetTokens": 1500 }
```

Answer `decision`:

| Decision | Meaning | Do |
| --- | --- | --- |
| `create` | Nothing recent for this job | Run it; record the run with `idempotencyKey: runKey`, `taskKey`, `attempt` |
| `update` | An open task already has this `dedupe_key` | Update that task instead of filing |
| `skip` | Done within `freshHours` (default 20) and its checks didn't fail | Stop. Nothing to record |
| `wait` | Another run holds the job | Stop |
| `resume` | Multi-step (`steps: [...]`): some steps done | Run `nextStep` only |
| `retry` | Last attempt failed and the backoff has passed | Run as `attempt`, read `failureLessons` and `procedures` first |
| `backoff` | Failed too recently | Try again after `retryAt` (2, 8, 32, 120 min) |
| `escalate` | 4 failures in a row, or marked not retryable | Stop and file an approval or task for Khaneil |

`context.items` is at most `budgetTokens` of memory, best first (verified procedures for this job,
then failure lessons when retrying, then Khaneil's standing policies, then the rest), each with
source, verification, confidence (0 to 1) and freshness. Skips and waits spend no context.
`tokensSavedEstimate` is the average tokens earlier successful runs of the job used (an estimate,
not a bill).

After the run:

```
POST runs       { idempotencyKey: runKey, agentId, status: "running", taskKey, attempt, leaseMinutes: 30 }
POST runs       { idempotencyKey: runKey, agentId, status: "succeeded" | "failed", error?, inputTokens?, outputTokens? }
POST feedback   { runId, verdict, checks: [{ name, passed }], errorClass?, retryable?, memoryIds?, lesson? }
```

A long run re-posts `running` (a heartbeat) or a fresh `leaseMinutes`. Without either for 2 hours,
or past its lease, Atlas marks it `timed_out` ("Stopped reporting"); a late finish still lands.

Other routes: `GET memory/search?taskKey=&workflow=&project=&agent=&q=`, `POST memory`,
`GET memory/agents/<id>` (an agent reads only its own; a catalog id like `atlas-task-writer` also
covers its data key via `catalogId` in the policy), `POST maintenance/sweep` (Khaneil).

## Operational procedures

**Apply the migration** (owner connection string, never the `atlas_app` role):

```
ATLAS_MIGRATE_DATABASE_URL='postgres://…' node scripts/db-migrate.mjs --status
ATLAS_MIGRATE_DATABASE_URL='postgres://…' node scripts/db-migrate.mjs
```

Then grant the app role the new tables (also in `db/roles.sql`):

```
GRANT SELECT, INSERT, UPDATE ON atlas.memory_items TO atlas_app;
GRANT SELECT, INSERT ON atlas.run_feedback, atlas.memory_events TO atlas_app;
```

The code works before and after: until 0003 is applied, memory routes answer 503 and the rest of
the data API behaves as schema v1. Migration 0002 (Executive Agent) is independent.

**Undo**: `node scripts/db-migrate.mjs --down` runs `0003_agent_memory.down.sql` (backup first:
`pg_dump -n atlas`). Timed-out runs go back to `failed`.

**Review memory**: Task Center → Atlas database → Agent memory. Verify, Wrong or Retire each lesson
or procedure an agent proposed. Nothing an agent writes is trusted until you verify it.

**Stale runs**: swept on every overview read and pre-run check, no schedule needed. To force it:
`POST /api/data/maintenance/sweep`.

**Retention**: working memory retires itself at `expires_at`; operational memory shows as due for
review after 90 days, project knowledge after 180; idempotency keys older than 7 days are pruned.

## Validation (server/memory/memory.test.ts)

All run on PGlite in CI and passed on PostgreSQL 16 through the site's own driver
(`ATLAS_TEST_DATABASE_URL`).

1. **Repeated task**: the second run of the same daily job seven seconds later (the real 878/879
   pair) gets `skip`, spends 0 context tokens, saves an estimated 3,600 tokens; a worker that
   ignores the check gets the existing task back (`duplicate`); a second live worker gets 409.
   Result: 1 task, 1 run for the job.
2. **Failed workflow retried**: a Sheets timeout fails attempt 1. Straight away the check says
   `backoff` and offers no trusted procedure, because the agent's proposed fix is unverified. After
   Khaneil verifies it, the check says `retry` as attempt 2 with that procedure first in context
   (precision 1.0, within a 600-token budget); the unverified guess stays marked unverified. The
   retry passes its checks and the next check says `skip`.
3. **Executive resume**: a four-step objective; the worker dies during step 3. The check says
   `wait` while it may be alive, then after it times out `retry` at step 3 only, estimating 5,000
   tokens saved by not redoing steps 1 and 2. Final run counts: research 1, draft 1, review 2,
   publish 1.

Also tested: concurrent starts (one wins, the loser leaves nothing), partial failure rollback,
honest verdicts, bounded backoff and escalation, access isolation (areas, categories, private,
restricted, disputed, held text), revision and retirement, the down migration, and v1 behaviour
before the migration.

## Risks and limits

- The Task Writer and other n8n workflows don't call the pre-run check yet. Until they do, the
  memory tables fill only through Khaneil and tests; the stale-run sweep and the execution numbers
  in the card help straight away.
- Token savings are estimates from recorded token counts. Runs that don't send `inputTokens` /
  `outputTokens` count as 0.
- `relevance` is word matching. Synonyms miss; that is the signal to consider `pgvector`.
- The Mac app reads the overview only; agent pages show database memory on the web page.
