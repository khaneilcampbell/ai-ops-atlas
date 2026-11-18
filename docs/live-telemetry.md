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
| signal-watch | Observability Center | 2026-11-17 09:12 UTC, ok |
| dataset-census | Data Intelligence Center | 2026-11-17 03:48 UTC, ok |
| Flow missed-run check (5 agents) | Benjaire HQ | 2026-11-16 16:00 UTC, ok |
| commerce-loop | Commerce Pipeline | 2026-11-16 15:00 UTC, failed |

## Not connected yet

| Source | Gap | Next step |
| --- | --- | --- |
| Production receiver `/api/hooks/production` | Configuration and deployment: no production event has ever been stored. | Set the `PRODUCTION_AGENT_KEYS` Pages secret and run `scripts/report-production.py` on each host (`docs/production-observability.md`). |
| Agents with no `observe` source | Code/catalog: nothing reports. | Set `observe.agent_feed: true` and an `alerts.report_within` window, and post each run result to `/api/hooks/agents`. |
| Landmarks without operating agents | Catalog: no agent reports for them. | Give the building an operating agent that reports to the feed. |

A heartbeat only proves the process is alive; Idle after a success needs a real run result.
