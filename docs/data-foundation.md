# Atlas data foundation: PostgreSQL, the data API and n8n

PostgreSQL is the source of truth for Khaneil's goals, projects, tasks, decisions, documents, agent
runs and approvals. Atlas, n8n and AI agents all read and write it through one server-side API on
the Atlas site. Nothing talks to the database from a browser, and no database password or agent key
is ever in the page, the Mac app, the repository or a log line. Google Sheets, if used, is a
read-only report built from PostgreSQL, never a second place to edit facts.

```
 Atlas web page ──(Cloudflare Access)──▶ /api/data/*        ┐
                                                             ├─▶ server/data/api.ts ──▶ Hyperdrive (ATLAS_DB) ──▶ PostgreSQL
 n8n workflow ───(Bearer agent key)────▶ /api/hooks/data/*  ┘        checks, policy,             pooled, TLS            atlas schema
      ▲                                                                idempotency
      └── Atlas starts an n8n workflow with a webhook (format below), n8n reports back through /api/hooks/data
 n8n (scheduled, optional) ──GET /api/hooks/data/context──▶ Google Sheets report (one existing sheet, updated in place)
```

## What is built and what still needs setting up

| Part | State |
| --- | --- |
| Schema `db/migrations/0001_atlas_core.sql` (+ `.down.sql`), role `db/roles.sql`, runner `scripts/db-migrate.mjs` | Built. Tested on PostgreSQL 16 and on PGlite in CI. |
| Data API `server/data/` behind `functions/api/data/[[path]].ts` (Access) and `functions/api/hooks/data/[[path]].ts` (agent keys) | Built and tested (`server/data/data.test.ts`, 20 tests). |
| Task Center "Atlas database" card (`src/views/tasks/DatabaseCard.tsx`) | Built. Web page only; the Mac app says so. |
| A PostgreSQL database, the Hyperdrive config, the `ATLAS_DB` binding, `nodejs_compat`, `ATLAS_DATA_KEYS` | **Not set up.** Until they are, the card says "Not set up" and the API answers 503. |
| The example n8n workflow (task writer) | **Not built in n8n.** The node sequence is below. |
| Atlas sending webhooks to n8n for record work | **Not built.** The format below is the contract for that step. Today Atlas only starts n8n steps through the existing step runner (`docs/workflow-execution.md`). |
| Google Sheets report | **Not built.** Optional; design below. |

No live connection has been made or verified. Treat the database as off until the card shows
"Connected".

## Data model

All tables live in the `atlas` schema. Every row has a UUID `id`, `created_at`, `updated_at` and a
`version` that a trigger bumps on each update (used for optimistic locking).

| Table | Holds | Key columns |
| --- | --- | --- |
| `goals` | What Khaneil is working towards | title, description, area, priority, status (proposed, active, paused, achieved, dropped), target_date |
| `projects` | Work that serves a goal | title, description, area, status (planned, active, paused, done, dropped), goal_id |
| `tasks` | Single pieces of work | title, description, area, status and priority and source (same values as the Task Center), due_date, project_id, goal_id |
| `decisions` | What was decided and why | decision, rationale, area, decided_on, project_id, goal_id |
| `documents` | Pointers to files, never contents | title, doc_type, storage_url (https only), summary (human), doc_date, area, access_category (shared, internal, private, restricted) |
| `agent_runs` | Each agent or n8n run | agent_id, workflow_id, external_run_id, idempotency_key (unique), input_ref, status (queued, running, succeeded, failed, cancelled), result_summary, error, goal/project/task links, model, tokens, cost_usd, started_at, finished_at |
| `approvals` | What waits for Khaneil | kind (external_message, financial, destructive, external_write, fact_change, other), proposed_action, context, area, status (pending, approved, rejected, cancelled, expired), requested_by, reviewer, decision_note, decided_at, expires_at, target_table/target_id/payload (fact_change only) |
| `ai_notes` | What models wrote about a record | subject_table, subject_id, kind (summary, recommendation, extraction, risk), body, agent_id, model, run_id |
| `idempotency_keys` | Answers to writes already done | actor, key, request_hash, status, response |

Areas are `business`, `projects`, `career`, `life` and `finance`. Fact rows also carry `origin`
(owner, agent, system), `created_by`, `updated_by` and `owner_confirmed_at`. Facts and AI output are
kept apart: an agent's summary or recommendation goes in `ai_notes` and is always returned marked
`ai_generated: true`. It is never written into a goal, project or task.

The schema stores no secrets, passwords, payment details or document contents. Keep it that way:
store a link to a file, not the file, and keep anything sensitive out of free-text fields.

## Setup (Khaneil, once)

1. **Create a PostgreSQL 13+ database** with TLS (Neon, Supabase, Railway, RDS or your own). Note
   its owner connection string.
2. **Create the tables** from your Mac, in the repository folder:
   `ATLAS_MIGRATE_DATABASE_URL='postgres://OWNER…' node scripts/db-migrate.mjs`
   (`--status` lists, `--down` undoes the newest; take a `pg_dump -n atlas` backup first).
3. **Create the site's role**: run `db/roles.sql` as the owner, then set its password with
   `\password atlas_app` in psql. The site only ever uses this role: it can read and write rows but
   can't change tables or delete facts.
4. **Create a Hyperdrive config** in Cloudflare (Workers & Pages > Hyperdrive > Create) with the
   `atlas_app` connection string.
5. **Bind it to the Pages project** as `ATLAS_DB` (Workers & Pages > ai-ops-atlas > Settings >
   Bindings > Add > Hyperdrive), for Production and Preview.
6. **Turn on `nodejs_compat`** (same project > Settings > Runtime > Compatibility flags), for
   Production and Preview. The PostgreSQL driver needs it. **Do this before merging**: without it
   the site's functions fail to build and the web page stops getting new deploys.
7. **Make an agent key**: `openssl rand -hex 32`. Add the encrypted variable
   `ATLAS_DATA_KEYS` = `task-writer:<key>` (Settings > Variables and Secrets). Put the same key in
   n8n as a Header Auth credential (name `Authorization`, value `Bearer <key>`).
8. Redeploy, open the Task Center, and check the card shows **Connected · schema v1 · 1 agent key**.

Local development: copy `.env.example` to `.dev.vars`, point `ATLAS_DATABASE_URL` at a local
database, and run `npx wrangler pages dev` after `npm run build:web`.

## The data API

Base paths: `/api/data/` (Khaneil, Access session) and `/api/hooks/data/` (agents, header
`Authorization: Bearer <key>`). All answers are JSON and never cached. Bodies are capped at 64 KB.

| Method and path | Who | What |
| --- | --- | --- |
| `GET status` | both | `{ state: "ok", schemaVersion, agentKeys }`, or `not-configured` / `error` with a reason |
| `GET overview` | Khaneil | Recent runs, pending approvals, active goals and projects, recent tasks, counts |
| `GET context?project=<id>` (or `goal=`, `task=`), `&q=`, `&limit=` (1–25, default 10) | both | A small, related set of records for one job (below) |
| `GET records/<table>/<id>` | both | One record |
| `POST records/<table>` | both | Create, or create-or-update by `id` |
| `POST runs` | both | Record a run's start, progress or finish |
| `POST notes` | both | Add an AI summary, recommendation, extraction or risk to a record |
| `POST approvals` | both | Ask Khaneil before something consequential |
| `GET approvals/<id>` | both (agents: their own) | Is it still pending, approved, rejected or expired |
| `POST approvals/<id>/decision` | Khaneil | `{ "decision": "approve" \| "reject", "note"? }` |

`<table>` is one of `goals`, `projects`, `tasks`, `decisions`, `documents`.

### Create or update a task (the example flow)

```http
POST /api/hooks/data/records/tasks
Authorization: Bearer <task-writer key>
Idempotency-Key: n8n-4711-task
Content-Type: application/json

{
  "id": "6f1d3c1e-9a43-4c1e-8f0e-2b7a1c9d0e11",
  "runId": "<agent_runs.id from the start call>",
  "fields": {
    "title": "Draft the Stripe product list",
    "area": "business",
    "priority": "high",
    "due_date": "2026-12-05",
    "project_id": "<project id>",
    "goal_id": "<goal id>"
  }
}
```

Answers:

- `201 { "result": "created", "record": { … "origin": "agent", "version": 1 } }`
- `200 { "result": "updated", "record": { … } }` for a task this agent created
- `202 { "result": "approval_required", "approval": { "id", "status": "pending" } }` when the task
  is Khaneil's (he created or edited it) or another agent's. Nothing changed; the change waits in
  his approvals.
- `400` bad input, `403` outside the key's areas or tables, `404` not visible, `409` the record
  moved past `expectedVersion`, `422` a linked id doesn't exist or the Idempotency-Key was reused
  for a different body, `503` database not set up or unreachable.
- Repeating the same request with the same `Idempotency-Key` returns the first answer with
  `"replayed": true` and writes nothing.

Sending your own `id` (a UUID n8n makes once, for example from the execution id) makes "create"
safe to retry even without the key. `expectedVersion` refuses an update if someone changed the row
since you read it.

### Record a run

```http
POST /api/hooks/data/runs
{ "idempotencyKey": "n8n-4711", "agentId": "task-writer", "status": "running",
  "workflowId": "<n8n workflow id>", "externalRunId": "4711", "inputRef": "project:<id>", "projectId": "<id>" }
```

Then, with the same `idempotencyKey`, finish it:

```json
{ "idempotencyKey": "n8n-4711", "agentId": "task-writer", "status": "succeeded",
  "resultSummary": "Filed 1 task.", "taskId": "<id>", "model": "<model id>",
  "inputTokens": 1200, "outputTokens": 300, "costUsd": 0.0081 }
```

or, on failure, `"status": "failed", "error": "<short reason>"` (an error is required; long errors
are cut to 2,000 characters). A run that already finished can't change to a different end state
(`409`); repeating the same end state answers `"unchanged"`. An agent key can only record runs
under its own id.

### Context

`GET /api/hooks/data/context?project=<id>` returns:

```json
{ "limit": 10,
  "project": { … }, "goal": { … },
  "tasks": [ open tasks, most urgent first ],
  "decisions": [ newest first ], "documents": [ only categories this key may see ],
  "aiNotes": [ { "body", "kind", "agent_id", "ai_generated": true } ],
  "recentRuns": [ this agent's runs on this record ] }
```

With `task=` it also returns the task's project and goal; with `goal=` the goal's open projects.
`q=` adds a plain text search over titles and descriptions of what the key may read. Every list is
capped by `limit` (at most 25). Start here before reaching for embeddings.

## n8n

### Atlas to n8n: webhook format

When Atlas starts an n8n workflow for record work, it sends:

```http
POST https://<n8n>/webhook/<workflow path>
Authorization: Bearer <that workflow's webhook key>        (n8n Header Auth credential)
Idempotency-Key: atlas-task-upsert-6f1d3c1e
Content-Type: application/json

{
  "version": 1,
  "action": "task.upsert",
  "requestId": "<uuid>",
  "idempotencyKey": "atlas-task-upsert-6f1d3c1e",
  "requestedBy": "owner",
  "subject": { "table": "tasks", "id": "6f1d3c1e-9a43-4c1e-8f0e-2b7a1c9d0e11", "projectId": "<uuid>" },
  "input": { "instruction": "Break the commerce pipeline brief into tasks for this week." },
  "callback": { "base": "https://<atlas site>/api/hooks/data", "runKey": "atlas-task-upsert-6f1d3c1e" }
}
```

n8n answers at once (Respond to Webhook node, within 15 seconds):

```json
{ "accepted": true, "runKey": "atlas-task-upsert-6f1d3c1e", "executionId": "4711" }
```

or `{ "accepted": false, "error": "<reason>" }` with a 4xx. The outcome never comes back in this
answer: the workflow records it through `POST runs` with `idempotencyKey` = `runKey`. Atlas treats
no answer, a 5xx or a timeout as "may have started" and checks `agent_runs` before trying again.
This matches the existing step runner bridge. Atlas does not send these yet.

### Example workflow: task writer (node sequence)

| # | Node | Does |
| --- | --- | --- |
| 1 | Webhook (Header Auth) or Schedule Trigger | Receives the payload above, or runs on a schedule with a fixed project id |
| 2 | Respond to Webhook | `{ accepted: true, runKey, executionId: {{$execution.id}} }` |
| 3 | HTTP Request: `POST …/runs` | `status: "running"`, `idempotencyKey: runKey`, `externalRunId: {{$execution.id}}` |
| 4 | HTTP Request: `GET …/context?project=<id>&limit=10` | The context; nothing else is passed to the model |
| 5 | AI node (Anthropic) | Asked for JSON only: `{ title, description, priority, due_date }` |
| 6 | Code node: validate | Parse JSON; drop unknown keys; check title 1–200 chars, priority in low/medium/high/critical, due_date YYYY-MM-DD; on failure go to 9 |
| 7 | HTTP Request: `POST …/records/tasks` | `Idempotency-Key: <runKey>:task`, a stable `id`, `runId`, `fields` (area and project from the context, not the model) |
| 8 | HTTP Request: `POST …/runs` | `status: "succeeded"`, `resultSummary`, `taskId`, model, tokens, cost |
| 9 | Error path (and an Error Trigger workflow) | `POST …/runs` with `status: "failed"` and a short `error`; never the full model answer or any personal data |

All HTTP Request nodes use the same Header Auth credential, a 10-second timeout, and "Retry on
fail" (3 tries). Retries are safe because every write carries an idempotency key. If step 7 answers
`202`, the workflow stops there and records `succeeded` with `resultSummary: "Waiting for
Khaneil's approval"`. Before an action listed under approvals below, the workflow files
`POST approvals` and stops; a later run checks `GET approvals/<id>` and only acts on `approved`.

The API checks everything again (step 6 is a courtesy, not the guard): model output is untrusted.

## Approval flow

1. An agent wants to do something consequential (send an external message, spend or move money,
   delete or overwrite something, write to another system) and files `POST approvals` with a kind,
   the proposed action, short context and an optional expiry. It does not act yet.
2. An agent's change to a record Khaneil owns (he created it, edited it or approved it) or to another
   agent's record is filed automatically as a `fact_change` approval with the proposed fields and
   the record's version at the time.
3. The Task Center card lists pending approvals with Approve and Reject. Only Khaneil's Access
   session can decide; agent keys get `403`.
4. Approving a `fact_change` applies the change in the same transaction, unless the record changed
   since it was proposed (`409`: reject it and let the agent propose again). For other kinds,
   approving only records the yes; the workflow sees `approved` on `GET approvals/<id>` and acts.
5. Expired requests become `expired` and can't be approved.

## Security and reliability

- **Server-side only.** The connection string lives in the Hyperdrive config; agent keys live in an
  encrypted Pages variable and in n8n credentials. `.env.example` has placeholders only.
- **Least privilege.** The site connects as `atlas_app` (rows only, no DDL, no deletes of facts).
  Each agent key is listed in `server/data/policy.ts` with its areas, readable tables, writable
  tables and document categories. The example `task-writer` key gets business, projects and career;
  read access to goals, projects, tasks, decisions and documents (shared and internal only); and
  write access to tasks. `restricted` documents are never served to any agent key. Life and finance
  records are only visible to Khaneil until a key is given them in a reviewed pull request.
- **Validation.** Every write is checked against `src/data/records.ts`: required fields, allowed
  values, lengths, dates, https links, UUIDs, linked records that exist and are visible, and no
  unknown fields. The database's own CHECK constraints and foreign keys back this up.
- **Idempotency.** Writes take an `Idempotency-Key` (required for agents); runs use their own key;
  records accept a caller-made UUID.
- **Time limits.** 5 seconds per statement, 8 seconds per request, 5 seconds to connect; the page
  waits at most 15 seconds and says when it gave up.
- **Logging.** One redacted line per request (route, caller id, status, duration). Bodies, field
  values and keys are never logged.
- **Approvals** before external messages, money, destructive changes and other outside writes, as
  above.

## Google Sheets (optional)

If a sheet helps for reporting, a scheduled n8n workflow reads `GET overview`-style data through an
agent key with read-only policy and **updates one existing sheet in place** (never a new file). The
sheet is a copy for reading. Edits made in the sheet are not read back; changes go through Atlas or
the API.

## Later: document search with pgvector

When plain search is not enough, add a migration with `CREATE EXTENSION vector` and a
`document_chunks (id, document_id → documents.id, chunk_index, content_ref, embedding vector(N),
access_category, area)` table, and filter by the same areas and categories before ranking. Nothing
in the current tables needs to change.

## Deployment notes and limits

- Merging deploys the functions to the live site. **Turn on `nodejs_compat` first** (setup step 6).
  The rest can come later: without `ATLAS_DB` the API answers 503 and the card says "Not set up".
- Hyperdrive is required for good latency from Workers; `ATLAS_DATABASE_URL` works but opens a new
  TLS connection per request.
- The Mac app does not read the database yet. It would need a route through website sync, like
  `/api/hooks/n8n-steps`.
- Task Center tasks are still kept on each device. Moving them to the `tasks` table is a separate
  step.
- Rollback: revert the pull request. The tables stay, unused; `node scripts/db-migrate.mjs --down`
  removes them (after a backup).
