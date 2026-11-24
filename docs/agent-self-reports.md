# Agent self-reports

Every named agent reports data about itself to the **Data Intelligence Center**
(`service:financial:residence`) once a day, at a time picked from its own run history, so it can see
what to improve in its workflow. Khaneil asked for this on 2026-11-22.

- n8n workflow: [Data Intelligence · Agent Self-Reports](https://khancam15.app.n8n.cloud/workflow/SBtrX3tY3OKT8qzn)
  (published by Khaneil on 2026-11-24; reports run daily at each agent's time)
- Sheet: [Atlas Agent Self-Reports](https://docs.google.com/spreadsheets/d/1IJPNjdqPJ2OLhHZ_HI-pgai2dtPplq9oCx1Qw3DlR4s/edit)
  with Summary, Agents, Report Schedule, Recommendations and Run Log tabs
- Output Library: a PDF, an Excel workbook and a table, owned by Priya Raman (Atlas Health Monitor).
  Their output keys are fixed (see "Files each cycle makes"), so every run adds a version, never a new item.
- Report times: `catalog/workspace/self-reports.yaml`, parsed by `src/selfReports/selfReports.ts`
- Catalog entry: `agent-self-reports` in `catalog/ai-ops-atlas.yaml`

## What a report holds

No AI and no paid calls. The logic lives in `ops/self-reports/engine.cjs`, a pure file with no imports:
`ops/self-reports/build-n8n.mjs` pastes it into the workflow's Build Reports Code node
(followed by the small adapters in `ops/self-reports/n8n/`), and the tests and the synthetic preview load
the same file. Every figure is counted from:

| Source | Window | Retention | When it is missing |
| --- | --- | --- | --- |
| n8n executions and workflow settings (read-only key) | From the oldest execution n8n still keeps to now | About 7 days | "Not connected" for that workflow |
| GitHub Actions runs and cron lines (GET only) | Last 30 days | GitHub keeps longer; 30 days are read | "Not connected" for that file |
| The catalog on main | Current | Git history | The run stops |
| Atlas records, `GET /api/hooks/data/reports/agents` (counts only) | Last 30 days | Database | "Not connected yet" until the key is set up |

Windows differ by source and every figure is labelled with its own. Three states are never mixed up:
**No data** (no workflow linked, numbers left blank), **Not connected** (a source could not be read,
numbers left blank) and **0 runs** (read, nothing ran in the window). Missing data is never shown as 0,
and no failures seen is never called healthy, above all when a workflow does not keep its successful runs.

Per agent: catalog status, live state (scheduled, event-triggered, manual, quiet, draft, not connected,
no workflow linked), runs seen with their windows, succeeded and failed with the success rate of finished
runs, median and longest run, last run and last failure with time and source, scheduled / event / manual
counts, busiest hours (New York), GitHub workflows, published and draft n8n workflows, schedules, Atlas
runs and memory items, memory-service state, budget ("Not documented" when the catalog has none),
stale-data warnings and the suggestions below.

### Suggestions ("To improve its workflow")

Fixed rules in `RULES` (engine.cjs). Each suggestion shows the rule, the condition that fired and the
evidence, and its review status is "Not reviewed: suggestion only, nothing was changed". Nothing is ever
applied from them.

| Rule | Fires when | Priority |
| --- | --- | --- |
| failed-runs | At least one failed run in the window | High if under 80% or the latest run failed, else Medium |
| source-unavailable | A linked workflow could not be read | Medium |
| successes-not-kept | An n8n workflow does not save successful executions | Medium |
| active-but-quiet | Catalog says active, workflows read, no run in 7 days | Medium |
| drafts-as-operational | Catalog says active but some n8n workflows are drafts | Low |
| no-workflow | No n8n or GitHub workflow linked | Low |
| slow-run | Longest run over 60 s and over 3 times the median | Low |
| mostly-manual | 5 or more runs, over half started by hand | Low |
| memory-empty | Atlas memory connected and 0 memory items | Low |

### Files each cycle makes

A hand run and the last slot of the day read every agent and build, each on its own:

- `atlas-agent-self-reports.pdf`: executive summary with coverage, report schedule, one section per
  agent, sources and retention. Output key `atlas-health-monitor:agent-self-reports-pdf`.
- `atlas-agent-self-reports.xlsx`: sheets Overview, Agent Reports, Workflow Recommendations, Sources.
  Output key `atlas-health-monitor:agent-self-reports-workbook`.
- `atlas-agent-self-reports.csv`: the one-row-per-agent table. Output key
  `atlas-health-monitor:agent-self-reports-sheet`.

- Each agent's work report as both a PDF and an Excel workbook, filed under that agent's own id (output
  keys `<agent id>:work-report-pdf` and `<agent id>:work-report-xlsx`), so the Library's agent filter finds
  them. Both come from the same row. An agent with no runs gets "No data in window" in both, with the
  reason (no workflow linked, source unreadable, or no runs). Nothing is invented.
  Built by `agentFiles` in the engine.

Each file is uploaded to the Output Library in its own request, filed in the Knowledge & Research Center
(`service:financial:financial-planning`), where the Library lives. If one fails to build or upload, the others still go, and the Run Log
tab records what failed with a retry note (press Execute workflow in n8n).

### Try it without n8n

`node ops/self-reports/preview.mjs out` writes the PDF and the workbook from made-up agents in
`ops/self-reports/fixtures/synthetic.cjs`: no network, no keys. The tests are
`ops/self-reports/engine.test.mjs` and `ops/self-reports/n8n.test.mjs`.

## How report times are picked

1. Busy windows from its history: each run from 15 minutes before it starts to 15 minutes after it
   ends (weight 1), and each schedule time from 20 minutes before to 15 minutes after (weight 5,
   because the map walks an agent in about 15 minutes before a run).
2. Candidates every 30 minutes from 07:00 to 21:30 New York. A candidate inside a busy window scores
   3 × its weight, within an hour of one 1 × its weight.
3. The agent with the most history picks first; the lowest score wins; ties go to the slot nearest
   two hours after its typical start, then a stable hash. No two agents share a slot.
4. An agent with no history gets a quiet default slot, labelled as such.

Times picked on 2026-11-22 (n8n execution 902):

| Time | Agent |
| --- | --- |
| 08:30 | Jordan Reyes (GitHub Profile Manager) |
| 09:00 | Connor Walsh (Security Detection Lead) |
| 09:30 | Hana Kobayashi (Atlas Release Coordinator) |
| 10:00 | Mateo Rossi (Shop Order Manager) |
| 10:30 | Margaret Lindqvist (Senior Engineering Reviewer) |
| 11:00 | Priya Raman (Atlas Health Monitor) |
| 11:30 | Nina Petrova (Claude Site Assistant) |
| 12:00 | Daniel Okafor (Atlas Release Manager) |
| 12:30 | Eleanor Park (Documentation Lead) |
| 13:00 | Sofia Mendes (Commerce Operations Manager) |
| 13:30 | Tomás Herrera (Atlas Production Coordinator) |
| 14:00 | Yusuf Demir (Agent Operations Lead) |
| 14:30 | Samuel Asante (Repository Intelligence Agent) |
| 15:00 | Claire Dubois (Client Inquiry Manager) |
| 16:00 | Andre Thompson (Business Operations Monitor) |
| 16:30 | Leila Haddad (Benjaire Product Lab) |
| 20:30 | Elijah Brooks (Development Hub Lead) |

To change a time, edit the yaml (one agent per slot) and add or move the matching rule in the
workflow's "Agent Report Times" trigger.

## Schedule

One Schedule Trigger rule per slot (America/New_York) plus Run by Hand. A slot run reports only the
agents due then (within 14 minutes). The last slot of the day and every hand run read every agent and
rebuild the PDF and workbook. No loops or polling; GitHub and n8n are read only.

## On the map

While the workflow is a draft, nobody walks to the Data Intelligence Center and each agent's Workday
shows "Draft, not running yet". Once it is published and live n8n shows it switched on, an agent that
is in its free time at its slot walks up the building's approach, goes in for `stay_minutes` (6) and
carries on with its day. Work comes first: at its desk or heading in, it skips the walk. This is
`report` in `planRoutine` (`src/routine/routine.ts`) and `reportPlace` in
`src/views/map3d/routinePlaces.ts`. No building moves and no district changes size.

## Setup

The Atlas records part needs its own data key; until then the reports say "Not connected yet".

1. Add `self-reports:<random 32+ characters>` to the `ATLAS_DATA_KEYS` secret of the Pages project
   (Cloudflare → Workers & Pages → ai-ops-atlas → Settings → Variables and Secrets), comma-separated
   from the existing keys.
2. In n8n, create a Bearer Auth credential "Atlas self-reports key" with the same value and choose it
   on the workflow's "Read Atlas Records" node.

## Publish

Khaneil published the workflow in n8n on 2026-11-24, and the catalog entry is `active`. If it is
ever unpublished, set the catalog `status` back to `paused`, put "draft" in its trigger and record the
date in its history.

Daytime slots only update the Sheet. The Library files (combined and per agent) are made by the last
slot of the day (8:30 PM New York) and by every run by hand.
