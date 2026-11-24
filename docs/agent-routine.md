# Agent daily routine

The 17 named agents live a day in the city that follows their real work. Two things are kept apart
everywhere in Atlas:

- **Operational state**, from real run events only: scheduled, queued, running, waiting for
  approval, succeeded, failed, cancelled (`src/routine/operations.ts`).
- **City activity**, which only pictures it: walking, commuting, at desk, relaxing, riding,
  visiting, at home (`src/routine/routine.ts`).

Movement never starts, delays, repeats or judges a run. The work keeps running when the map is
closed, hidden or an agent is stuck; the picture catches up when it is drawn again.

## Where the data comes from

| Source | What Atlas reads | How |
| --- | --- | --- |
| n8n | Workflows, whether published, Schedule Trigger rules and time zone, whether successful runs are kept, recent executions | `server/n8n.ts` (read-only key, Pages secret `N8N_API_KEY`; the Mac app through website sync). One shared poll every 2 minutes while visible (`src/n8n/runs.ts`), never per agent. |
| GitHub Actions | Runs of workflows the catalog links | What Atlas already syncs (`repos`) |
| Task Center | Tasks assigned to an agent or an automation it owns | `src/tasks/store` |

Which workflows an agent owns comes from the catalog: the agent's own links and every automation
with `ownedBy: <agent>` (`ownedEntries`). Retired automations and archived agents get nothing, and an
archived agent has no character, so no routine.

Each workflow carries how far Atlas can vouch for it:

- **Verified by a real run**: a run of it was seen.
- **Connected, no run seen yet**: it is live and switched on.
- **Configured, not seen live**: the catalog links it but live data doesn't show it.
- **Draft (switched off)**: unpublished in n8n.

Nothing is ever labelled verified without a run.

## The day

Planned in the New York time zone unless the workflow's own n8n setting says otherwise, from 3 AM
(everyone at home), deterministically: the same runs and clock always give the same day, so a reload
or a hidden tab picks up where it was without replaying a completion.

1. Free time: mostly outside its own building (about two thirds of picks, so each building's agents
   are found there or at their desks), with outings now and then: the park, another district, the
   train, the yacht, the Ferris wheel, a ride on the Atlas Gold Jet, the arena or home. Choices are seeded per agent (no AI calls) and never start a long
   outing that would run into the next scheduled run.
2. Heading to the office so it arrives just before a known scheduled run (at most 15 minutes ahead).
3. Entering the building, going to its own desk (the desk the Inside view's office plan gives it).
4. At the desk. "Working", with a typing animation, only while a run is really running. Before the
   run it is "At desk"; after the scheduled time with no report yet it waits up to 12 minutes for
   n8n to report the run (3 for workflows that keep no successful runs), then goes back to its day.
5. Task completed, then leaving, then free time again.

Unexpected work (a webhook or a manual run) calls the agent in from wherever it is; the card says
the run already started. A ride finishes safely first (the wheel completes its turn, the yacht
returns, the train reaches its stop, the gold jet lands and its passengers walk off; an agent still
waiting in the terminal leaves at once). A run that finishes before
the agent arrives ends the walk with "finished before arrival": no pretend work session. Several
runs, retries and overlapping runs share one desk visit and are all listed on the one card.
Waiting for approval holds the agent at its desk for 5 minutes, then it goes on with its day while
the card keeps "Waiting for approval".

Rides are city simulation only. No booking, ticket, purchase or external action exists anywhere.

## On the map

- Click or tap an agent: its card shows what it's doing in the city and, separately, its work state,
  current task and workflow, run start and elapsed time, result, recent runs, next scheduled run, and
  **Follow agent**, **View office**, **Open task** (or **Open error** on a failure), **Full profile**.
- With **Inside** on, an agent at its desk is drawn seated at its own desk; the office's generic
  person for that desk is left out, so there is never a second figure. With Inside off, its badge
  waits above the door.
- The ring over an agent: cyan running, amber waiting for approval, red failed.
- Agents waiting at the same place stand in rows, never on one point.

### City agents panel

The **Agents** button in the map toolbar shows the number of active agents (one per identity: no
automations, n8n workflows, Product Lab skills, pedestrians or retired agents) and opens the
**City agents** panel beside the map (`src/views/map3d/CityAgentsPanel.tsx`, rules in
`cityRoster.ts`). The map stays visible and usable, and the camera doesn't move when it opens or closes.

- Search by name, role or assigned building; filters All, Working (a run is really running or
  queued), Free time (out between work, not at home), Attention (failed or waiting for approval);
  a district menu. Search, filters and the list's scroll stay put while you open agents.
- Picking a row selects the same agent on the map (a gold ring at its feet) without moving the
  camera; picking a character on the map selects its row. While the panel is open it is the agent's
  only profile on the map: the floating card stays closed.
- Each agent shows its city activity and place, its district, office, floor and desk, its work
  status and current task, its next run with the time zone, and how fresh the run data is. Without
  live n8n the work says "Status unavailable" and the schedule "Schedule unavailable", never idle.
- **Locate** glides to the agent (instant with reduced motion). Inside a building it names the
  building and floor and offers the interior; on the gold jet, yacht or train it finds the vehicle;
  at home or in the terminal it says why it can't be seen. **Follow** keeps it in view until you
  move the map or close the panel. **View office** opens its building and floor in the Inside view.
  **Assign task** opens the Task Center's own form with the agent chosen. **Full profile** opens it
  in the Agents tab.
- **Schedule** is read-only: Atlas's n8n key can only read, so each workflow links to the n8n
  editor ("Edit schedule in n8n"), where time zone, recurrence, approval and the single trigger are
  enforced. It explains that pausing a schedule (switching the workflow off) is not cancelling a
  running task (open the run or the Task Center), and keeps the city routine switch, which only
  changes the map.
- **Free time** (Nov 19) sends an agent that is in its free time off to the Ferris wheel, a yacht or
  train ride, a Gold Jet flight, a park bench, the arena or another district ("Surprise me" picks one
  it likes). "Free time for idle agents" above the list does that for everyone free now. It is a
  request to the routine planner (`src/routine/freeTime.ts`, `outing` in `planRoutine`): from that
  moment the agent leaves what it's doing (off a ride at its next safe exit) and goes; the day before
  it is unchanged and a reload draws the same outing. Agents at work, heading in, home for the night
  or with their routine paused can't be sent. It never starts, delays or cancels a run or touches a
  schedule, workflow or permission: a run that comes due still calls the agent in, and when the next
  scheduled run is too close it takes a short break nearby instead.
- **Daily self-report** (Nov 22): each named agent has a report time at the Data Intelligence Center
  (`catalog/workspace/self-reports.yaml`, see [agent-self-reports.md](agent-self-reports.md)). The
  walk is drawn only while the report workflow is published in live n8n (`report` in `planRoutine`),
  and only when the agent is free then; while it is a draft, Workday says "Draft, not running yet".
- Escape closes it and gives focus back to the Agents button; arrow keys move through the list.
  On a phone it is a bottom sheet over the lower map.

Settings for each agent are in Agents → the agent → **Workday** (and the map's agent sheet):
residence, office, desk, every owned workflow with its connection, schedule, time zone and next run,
approvals, missing setup, and a switch that pauses the city routine in Atlas. That switch only
changes the map; a real scheduled run is paused by switching the workflow off in n8n (linked).

## Audit, 18 Nov 2026 (read-only, nothing was run)

| Agent | Workflows it owns | Schedule (New York) | Seen live |
| --- | --- | --- | --- |
| Mateo Rossi, shop manager | Shop delivery (Stripe webhook), Shop follow ups | Follow ups every 4 hours at :48 | Follow ups run regularly; delivery on payments |
| Claire Dubois, inquiry manager | Intake, Status, Reply reminders, Monday digest | Reminders weekdays 9 AM, 1 PM, 5 PM; digest Mondays | Reminder and digest runs seen |
| Andre Thompson, ops monitor | Error alerts, Missed run check, site CI | Missed run check daily 11 AM | Daily runs seen |
| Sofia Mendes, commerce operations | Design product, Add idea, Approve product, Shop page/weekly sales, Sales feed, delivery, commerce tests | Design product Mon and Thu 10 AM (instance default zone) | Runs seen |
| Yusuf Demir, agent operations | Agent Registry sync, Top 10 ideas, Business Structure, Agent Factory, Step Runner | Registry every 4 hours; Business Structure daily 7 AM; Top 10 Sundays 9 AM; Factory Mondays 8 AM | Only failures visible for Registry and Business Structure (see below) |
| Priya Raman, health monitor | Data Inventory | Daily 7:20 AM | Only failures visible (see below) |
| GitHub-run agents (Tomás Herrera, Daniel Okafor, Nina Petrova, Elijah Brooks, Eleanor Park, Connor Walsh) | Their GitHub Actions workflows | GitHub schedules are not read yet | Runs Atlas syncs |
| Samuel Asante, Margaret Lindqvist, Hana Kobayashi, Leila Haddad, Jordan Reyes | No workflow linked | None | Not documented |

Product Lab hand-off and Career Execution Agent are drafts (unpublished).

## Limitations

- **Agent Registry sync, Business Structure and Data Inventory are set in n8n not to keep
  successful runs**, so Atlas only ever sees their failures. Their routine waits 3 minutes at the
  desk and then shows "result not confirmed". Fix: in n8n, Workflow settings → Save successful
  production executions → Save. Not changed without Khaneil's OK.
- **Pausing real scheduled work from Atlas** would need a write-scoped n8n key and a new write
  action; Atlas's n8n access is read-only. The switch pauses the city routine only and links to n8n.
- n8n's run list doesn't include the current step, so the card shows the run, not the node.
- GitHub Actions `schedule:` cron is not read yet: GitHub-run agents go in when a run is seen, not
  ahead of it.
- The Atlas Gold Jet: an agent waits in the terminal, steps on during the jet's own boarding at the
  gate, rides its loop over the city (its badge flies with the jet), and walks off when it lands
  (`goldJetTrip`, `airportClockAt` in `goldJetPlan.ts`). When the airport isn't animating (paused,
  reduced motion) it spends that time in the terminal instead. Riders aren't drawn inside the cabin
  when you ride the jet yourself. The train shows a badge only (the rider is inside the carriage).
- Some custom towers don't open as a cutaway yet, so a seated agent there is hidden by the shell;
  the badge still marks it. Atlas Command Center opens fully.
- Sounds: Atlas has no volume control on main yet (pull request #466), so the routine plays none.
