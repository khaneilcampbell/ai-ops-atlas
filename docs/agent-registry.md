# Agent registry

The Agents page is a registry of every agent, automation and pipeline in the catalog: what each one is, why it exists, what it may do and whether Atlas has seen it work. It stays read-only.

## Decisions

**One source of truth.** Registry profiles live in the existing `catalog/*.yaml` manifests, in an optional per-agent `registry` block (`schema: atlas/v2`). There is no second registry file and no database. Tool permissions stay in the existing `permissions` list.

**Backward compatible.** `atlas/v1` manifests still parse. `toProfile` in `src/registry/profile.ts` migrates any agent, v1 or v2, to a complete profile in memory. Fields nobody documented are `null` or empty and the UI labels them *Not documented*; nothing is inferred from names or frameworks. A `registry` block in a v1 file is reported, not silently read.

**Manual fields and telemetry are separate.** Manifests hold what people maintain. `src/registry/telemetry.ts` derives execution data at runtime from the live sources an agent declares in `observe`: GitHub Actions runs (`github_workflow`) and the app's own run log (`atlas_intel`, for Repository Intelligence). Nothing observed is written back. Manifest `last_run` and `history` are shown as hand-written records, labelled not verified.

**Configured is not verified.** An agent is *Verified running* only when Atlas has seen a successful run from a live source; *Latest run failed* when the newest completed run failed; otherwise *Configured, not verified*. Planned agents (type F) are *Planned*.

**Targets are written, observations are measured.** KPI targets come from manifests. Observed values exist only when the KPI names a `measure` the agent's telemetry can supply (success rate, runs in 30 days, average duration, monthly spend). Trends need at least six completed runs.

**Titles are display only.** A registry `title` replaces the display name everywhere in the app. The agent `id`, manifest `name` (kept as *Manifest name*), source paths and workflow names never change, so discovery and live sources are unaffected.

**Autonomy is a label.** Levels 0 to 4 describe what each agent may do in its own environment. Atlas has no controls to start, approve or change agents at any level.

**Validation.** `src/catalog/parse.ts` and `src/registry/manifest.ts` validate manifests and report problems instead of throwing. `catalog/schema/atlas-v2.schema.json` gives editors the same rules; a test keeps its enums and fields in line with the parser.

## Code map

| Path | Role |
|---|---|
| `src/registry/types.ts` | Registry vocabulary: types A to F, categories, autonomy, risk, KPIs, telemetry |
| `src/registry/manifest.ts` | Parses a `registry` block |
| `src/registry/profile.ts` | v1/v2 to full profile migration, documentation completeness |
| `src/registry/telemetry.ts` | Executions, operational state, observed KPIs, trends |
| `src/registry/registry.ts` | Directory entries, filters, sorting, grouping, portfolio summary |
| `src/views/Agents.tsx` | Directory, Portfolio and Goals views |
| `src/views/agents/Inspector.tsx` | Six-tab agent inspector |

## Performance

Profiles and telemetry are built once per catalog or data change (`useMemo`), then filtered and grouped in memory. Each step is linear in the number of agents, which is fine for hundreds of entries.

## Agent profile template

Use this when documenting an agent, in its repository or in a review. Write *Not documented* rather than guessing; a gap is useful information.

```markdown
# <Agent title> (`<agent-id>`)

Type: <A to F and name> · Function: <category> · Project: <project> · Autonomy: <level>

## What it is
One or two sentences.

## Why it exists
The problem it solves and who benefits.

## How it works
Trigger, then the processing stages in order.

## What triggers it
Manual, schedule, event or continuous, with the exact schedule or event.

## What it can access
Tools, APIs, data and the permissions each needs. Who owns the credentials.

## What it produces
Outputs and where they go.

## How success is evaluated
Objective, KPIs with targets and the basis for each target, and how they are measured.

## What can go wrong
Known failure modes and limits.

## How to troubleshoot it
Where logs are, how to rerun safely, who to ask.

## Planned improvements
Next changes and open questions.

Last reviewed: <date>
```
