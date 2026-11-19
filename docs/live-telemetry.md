# Live telemetry: what is connected

Checked 2026-11-17 against the live feed database (`atlas-live`, read only). Atlas shows five states
for an agent, the same on its desk, in the inspector, in the building's module and on the map:
**Running**, **Idle**, **Failed**, **Stale** (no report inside its `alerts.report_within` window, so an
old success no longer counts) and **Not connected** (no live source, or this device isn't reading the
feed). CI, catalog labels and simulated activity never set these states.

## Connected end to end

The agent feed (`/api/hooks/agents` → D1 `events` → `/api/events` → `src/live/feed.ts`, polled every
5 s only while the window is visible). Reporting in the last day:

| Agent | Building | Last report seen |
| --- | --- | --- |
| dataset-census | Data Intelligence Center | 2026-11-17 03:48 UTC, ok |
| Flow missed-run check (5 agents) | Benjaire HQ | 2026-11-16 16:00 UTC, ok |
| commerce-loop | Commerce Pipeline | 2026-11-16 15:00 UTC, failed |

## n8n runs and owning agents (2026-11-19)

- **n8n workflows.** An agent that links an n8n workflow (a link labelled "n8n") and declares no other
  source takes its state from that workflow's recent runs, read with the read-only key through
  `/api/n8n` (site) or website sync (Mac). Code: `n8nExecutions` in `src/registry/telemetry.ts`.
- **Owning agents.** An AI agent with no source of its own runs through the automations that name it in
  `owned_by`. Its state is their runs together, each labelled with the automation that ran it
  (`withOwnedRuns`, used by `telemetryById` in `src/registry/registry.ts`). Example: Agent Operations
  Lead shows the runs of Agent Registry Sync, Agent Factory and Step Runner. It never borrows runs
  when it has a source of its own.
- The Automation Plaza and the Workflow Automation Plant name the owning agent for each workflow.
- Still not connected: agents built as first-class n8n Agents (Release Coordinator, GitHub Profile
  Manager, Product Lab and its skills). Their chats are n8n agent sessions, which `/api/n8n` does not
  read, and they own no automations with a live source.

## Not connected yet

| Source | Gap | Next step |
| --- | --- | --- |
| Production receiver `/api/hooks/production` | Configuration and deployment: no production event has ever been stored. | Set the `PRODUCTION_AGENT_KEYS` Pages secret and run `scripts/report-production.py` on each host (`docs/production-observability.md`). |
| Agents with no `observe` source | Code/catalog: nothing reports. | Set `observe.agent_feed: true` and an `alerts.report_within` window, and post each run result to `/api/hooks/agents`. |
| Landmarks without operating agents | Catalog: no agent reports for them. | Give the building an operating agent that reports to the feed. |

A heartbeat only proves the process is alive; Idle after a success needs a real run result.
