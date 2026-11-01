# Agent workdays: roles, homes, shifts and commutes

KC, 2026-11-01: give each AI agent a home and a work building, a schedule, a budget and an owner,
so it has a real workday with a clear output, and after the workday it travels back to its
apartment.

This page is the design and the plan. The first slice (phase 1) ships with it. The prompt for
later phases is in [`ops/agent-workdays/prompt.md`](../ops/agent-workdays/prompt.md).

## Principles

1. **One source of truth.** A job is read from the agent's existing manifest (`catalog/*.yaml`):
   tier, trigger, schedule, `cost.budget`, `governance.credential_owner`, `responsibilities.outputs`.
   No second registry, no database.
2. **Declared beats inferred, and says which.** Every job field is a `Decided<T>` (the same type
   the districts and tiers use): `declared` when the manifest writes it, `inferred` with the rule
   that produced it otherwise. The Workday tab prints the basis under each value.
3. **Simulated is not verified.** The walk on the map is the job as written, played out on a
   12-minute map day. It never claims a run happened. Real runs stay on the Operations tab and
   still come only from live sources (GitHub Actions, the Atlas run log, the pipeline feed).
4. **No new cost.** No model calls, no timers, no network. Plain deterministic code: the same
   clock always draws the same picture.
5. **Inside the map budget.** Agents are extra instances in the existing crowd mesh (no new draw
   call, geometry, material or texture). The street graph is built once per layout.

## Data model

`src/catalog/agentJobs.ts`, one `AgentJob` per AI agent (types A, B and F; automations have none):

| Field | Source today (phase 1) | Declared later (phase 2, `job:` block) |
|---|---|---|
| `role` | Tier label from `tierOf` (Central Operations, Department Coordinator, Specialized Agent) | `job.role` |
| `owner` | Name before the brackets in `governance.credential_owner`; else KC (every catalog project is KC's) | `job.owner` |
| `home` | Circa apartment, assigned in agent-id order: West tower, floors 12 to 31, units A to D | `job.home: {building, unit}` |
| `work` | Declared `workplace` (for example OpenAI suite 401), else its project's headquarters | unchanged |
| `shift` | Default hours by trigger type (scheduled 8 to 16, manual 9 to 17, event 10 to 18, continuous 7 to 19), staggered up to an hour by a stable hash of the id | `job.shift: "09:00-17:00"` |
| `budget` | `cost.budget` text | `job.budget_usd_month` (a number the spend caps can check) |
| `output` | First of `responsibilities.outputs` | `job.daily_output` |
| `offDuty` | `planned` (type F), `paused` or `retired`: stays home | unchanged |

## Day cycle

One map day is 720 seconds (30 seconds a simulated hour). The map opens at 7:30 so the morning
commute is under way.

1. **Home.** Inside its Circa apartment, not drawn.
2. **Commute out.** Leaves home so it reaches its workplace door as its shift starts (a few
   minutes early when several agents share a street). The walk follows the city's streets.
3. **Work block.** Inside the workplace for the length of its shift, not drawn.
4. **Output.** The output it owes is the job's `output`. Phase 3 links it to the newest real
   output Atlas has seen (report, pull request, run summary).
5. **Commute home.** Leaves at shift end and walks the same streets back to Circa.

`agentAt(commute, seconds)` in `src/views/map3d/agentCommutes.ts` answers where an agent is at any
moment: `home`, `to-work`, `work` or `to-home`, with a position and heading while walking.

## Routing

`src/views/map3d/streetGraph.ts` turns the roads the scene already draws into one graph: the
Financial District street and Circa's street, the neighbourhood links, each road bridge with its
deck, and the lane round each headquarters plaza. Roads that meet in a T or stop within 0.35 of
each other are joined. A route is the residence's own approach to its sidewalk, the shortest walk
along the streets, then the last step to the workplace door. Agents walk by the curb on their
right, the same `along` maths as the rail commuters, at 0.45 units a second or faster so no
commute is longer than three simulated hours.

A workplace with no street within 3 units gets no walk, and the Workday tab says so. Today that is
the two OpenAI suite agents: the Skyline park has promenades but no street yet.

## Phased plan to the end of November

| Phase | Dates | What ships | Done when |
|---|---|---|---|
| 1. Slice | Nov 1 to 3 | Job card from manifests, Workday tab, street graph, agents walk Circa to work and home | This pull request merged |
| 2. Declared jobs | Nov 4 to 10 | Optional `job:` manifest block (role, owner, home, shift, budget number, daily output), parser, schema, migration of the 23 AI agents, a test that every AI agent declares one | No `inferred` shift or home left in the catalog |
| 3. Honest output | Nov 11 to 17 | End-of-day output linked to the newest real output from telemetry; a "day report" row per agent in Mission Control; agent glows at its desk only when a run is observed (existing office rules) | Every output line cites a real source or says *No output observed* |
| 4. Places | Nov 18 to 24 | Sidewalks instead of curbs where they exist; a street to the Skyline promenade so OpenAI suite agents walk; a few Hills houses as second homes; click an agent on the map to open its Workday tab | Every non-planned agent drawn; tap target works on iPhone |
| 5. Budget and owner in the loop | Nov 25 to 30 | Monthly spend observed against `budget_usd_month` (existing `month_spend_usd` KPI); over-budget agents stay home and raise the existing alert to their owner | Spend cap breaches visible on the map and in alerts |

Each phase is one small pull request, with screenshots at desktop and iPhone width and the
`measure:perf` before and after lines.

## Risks

- **Map budget.** The map sits near its draw and triangle budget. Agents add no draw calls; keep
  it that way (no per-agent labels or meshes; reuse instancing).
- **Misreading the simulation.** A walking agent is not a working agent. Copy on the Workday tab
  and this page say so; phase 3 only lights an agent from observed runs.
- **Catalog churn.** Homes are assigned in id order, so a new agent can shift others' units until
  phase 2 makes homes declared.
- **Street changes.** The graph is built from the scene, so new roads join it for free; a test
  fails if any headquarters becomes unreachable from Circa.
