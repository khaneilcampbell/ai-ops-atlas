# Agent self-reports

Every named agent reports data about itself to the **Data Intelligence Center**
(`service:financial:residence`) once a day, at a time picked from its own run history, so it can see
what to improve in its workflow. Khaneil asked for this on 2026-11-22.

- n8n workflow: [Data Intelligence · Agent Self-Reports](https://khancam15.app.n8n.cloud/workflow/SBtrX3tY3OKT8qzn)
  (unpublished draft until Khaneil says "publish")
- Sheet: [Atlas Agent Self-Reports](https://docs.google.com/spreadsheets/d/1IJPNjdqPJ2OLhHZ_HI-pgai2dtPplq9oCx1Qw3DlR4s/edit)
  with Summary, Agents, Report Schedule, Recommendations and Run Log tabs
- Output Library: one PDF and one spreadsheet item, owned by Priya Raman (Atlas Health Monitor). Their
  output keys are fixed (`atlas-health-monitor:agent-self-reports-pdf`,
  `atlas-health-monitor:agent-self-reports-sheet`), so every run adds a version, never a new item.
- Report times: `catalog/workspace/self-reports.yaml`, parsed by `src/selfReports/selfReports.ts`
- Catalog entry: `agent-self-reports` in `catalog/ai-ops-atlas.yaml`

## What a report holds

No AI. Every figure is counted from:

- **n8n executions** of every workflow the agent and its owned automations link. n8n keeps about
  7 days, so its figures cover only that window.
- **GitHub Actions runs** of their workflow files for the last 30 days.
- **The catalog on main**: status, trigger, budget, history.
- **Atlas records** through `GET /api/hooks/data/reports/agents`: per agent, runs, failures, tokens,
  cost, memory items and feedback counts for 30 days. It returns counts only, never summaries or
  memory text, and needs a key with the `agentReports` right (see Setup).

Per agent: runs, succeeded, failed, success rate, median and longest run time, last run and last
failure, scheduled vs event vs manual runs, busiest hours (New York), published vs draft n8n
workflows, schedule times, stale states (catalog vs live), budget, and up to three recommendations from
fixed rules: look into failures, save successful runs in n8n, publish or retire drafts, check a run that
took over three times its usual time, link the automation it runs.

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
agents due then (within 14 minutes). The last slot of the day and every hand run also rebuild the PDF
and add new Library versions. No loops or polling; GitHub and n8n are read only.

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

When Khaneil says "publish": publish the workflow in n8n, then set the catalog entry's `status` to
`active`, drop "draft" from its trigger, and record the date in its history.
