# Autonomous operations (Phase 9)

Mission Control > **Autonomous operations** turns verified events into incidents, tasks and, when
Khaneil allows it, small read-only recovery steps. It is supervised autonomy, not self-healing:
nothing here deploys, deletes, rotates credentials, changes firewalls or cloud infrastructure,
spends money, publishes products or sends customer messages. No model is called for monitoring.

## How it works
1. **Events** (`src/operations/derive.ts`) are built from data Atlas already has: n8n and GitHub
   failures (intake), alert watches (Signal Watch), evaluations, Task Center tasks (failed, stalled
   past their step timeout, over budget, invalid output), integration signal rows, and Executive goals
   (deadlines Khaneil set, blocked, stale, missing deliverables). No second event bus or scheduler:
   it runs every 5 minutes in the open app (`src/operations/app.ts`).
2. **Validation** (`events.ts`): strict schema, trusted source identity per system, https links only,
   flat payload, secrets redacted, text capped. Event text is data and never sets permissions.
3. **Incidents** (`incidents.ts`): deduplicated, grouped by correlation id (`agent:<id>`), cooldown
   before reopening, transient integration errors need two reports.
4. **Policy** (`policy.ts`): the Phase 8 autonomy level (default 1) plus a per-playbook policy that
   is off by default. Atlas runs a playbook on its own only at level 3 with that policy on, inside its
   hours, retry limit, backoff, hourly cap and $0 model budget. Only Khaneil can change policies;
   an agent attempt is refused and audited.
5. **Playbooks** (`playbooks.ts`, `recovery.ts`): refresh status, reconcile an uncertain execution,
   retry a read-only task (refuses today: no read-only executor exists), rebuild the local repository
   cache, recheck an integration. Each claims an idempotency key, has a timeout (a timeout is
   "unknown", never "stopped"), and must pass verification before an incident shows as fixed.
6. **Emergency stop**: in the app it holds all playbooks, retries and new orchestrator steps. On the
   hosted site it also sets `ops_control` in D1, and `/api/n8n/dispatch` refuses with 423 while it is on.
   Audit logging, security monitoring and owner access keep working.
7. **Workflow Intelligence** shows each incident as a workflow with Output Studio cards (summary,
   diagnostics, recovery log, verification, recommendations, escalation).

## Status
| Capability | State |
| --- | --- |
| Events from n8n, GitHub, tasks, agents, goals, integrations | Operational (existing sources) |
| Cloudflare service health events | Unconfigured: no Cloudflare health source exists |
| Incidents, tasks, policies, audit, emergency stop (app) | Operational, device-local |
| Site emergency stop (`/api/ops/control`) | Operational once the D1 table is created on first call |
| Retry read-only task playbook | Missing: no idempotent read-only executor |
| Cancelling n8n or GitHub runs | Missing: n8n key is read-only; Atlas says so instead |
