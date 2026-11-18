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

1. Free time: the park, another district, the train, the yacht, the Ferris wheel, a simulated
   flight, a trip on the Atlas Gold Jet, the arena or home. Choices are seeded per agent (no AI calls) and never start a long
   outing that would run into the next scheduled run.
2. Heading to the office so it arrives just before a known scheduled run (at most 15 minutes ahead).
3. Entering the building, going to its own desk (the desk the Inside view's office plan gives it).
4. At the desk. "Working", with a typing animation, only while a run is really running. Before the
   run it is "At desk"; after the scheduled time with no report yet it waits up to 12 minutes for
   n8n to report the run (3 for workflows that keep no successful runs), then goes back to its day.
5. Task completed, then leaving, then free time again.

Unexpected work (a webhook or a manual run) calls the agent in from wherever it is; the card says
the run already started. A ride finishes safely first (the wheel completes its turn, the yacht
returns, the train reaches its stop; a flight lands within 20 seconds). A run that finishes before
the agent arrives ends the walk with "finished before arrival": no pretend work session. Several
runs, retries and overlapping runs share one desk visit and are all listed on the one card.
Waiting for approval holds the agent at its desk for 5 minutes, then it goes on with its day while
the card keeps "Waiting for approval".

On the gold jet an agent walks through the terminal, boards while the jet boards at its gate, stays aboard
through pushback, takeoff and the circuit (its badge rides on the jet) and steps off when it deplanes. With reduced
motion the jet stands still, so nobody boards it. Rides are city simulation only. No booking, ticket, purchase or external action exists anywhere.

## On the map

- Click or tap an agent: its card shows what it's doing in the city and, separately, its work state,
  current task and workflow, run start and elapsed time, result, recent runs, next scheduled run, and
  **Follow agent**, **View office**, **Open task** (or **Open error** on a failure), **Full profile**.
- **One building, two views** (`src/views/map3d/buildingModel.ts`). Each headquarters has one
  definition that the exterior, the cutaway and the walk all read: its footprint, the street door
  the map draws, storey height, a lobby behind the door, a lift core in the back corner of every
  floor, and the office floors from each agent's catalog `office_floor` (floor 4 when it isn't set,
  six desks a floor, as "Enter building" uses: `floorLayout`). The inside is drawn at people's
  scale, so an agent keeps its size from the sidewalk to its chair, and every plate fits inside the
  footprint.
- **The walk in** is one continuous path: its place outside, the door, the lobby, the lift up to its
  floor, the aisle behind the chairs, its own chair; and back out the same way. The figure is never
  switched off: with the building closed the walls hide it and its badge sits on the street façade
  at its floor, with a subtle band round that floor (cyan running, amber waiting for approval, red
  failed, warm white at a desk with nothing running).
- **View inside** (a building's panel) or **View office** (the agent's card, which locates it) opens that building as
  a cutaway at one floor, whatever the toolbar's Inside switch says; the floors above step aside
  and the ones below keep their walls. The summary beside it lists the floors (with who is on each
  now), every agent assigned there with where it is and its real work state, the runs in
  progress, and **Back to city**. It is kept across a reload. The open desks' monitors show only a
  real state (running, waiting for approval, failed) and a neutral screen otherwise.
- The office's generic person for a named agent's desk is left out, so there is never a second
  figure. Opening, closing, changing floors and locating never touch a run.
- The open floor is drawn like the office inside "Enter building": walls with windows, trim and the
  wall display, the rug, server rack, plants, the lift doors and the building's accent colour.
- The toolbar's **Agents at work** button (I) opens every building in view with someone seated at a
  desk, at that floor, then the nearest others.
- The ring over an agent: cyan running, amber waiting for approval, red failed.
- Agents waiting at the same place stand in rows, never on one point.

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
- A flight is time in the terminal (no badge on a plane). The train shows a badge only (the rider is
  inside the carriage).
- Custom towers keep their own shapes (round, ribbon, podium): the floor plate is the square
  inside the footprint, so on a curved façade the plate's corners sit just inside the glass, and the
  storeys follow the standard headquarters storey height.
- "Enter building" (the full office) uses the same floors and desk places, but its rooms, lift
  landing and lobby furniture are still its own drawing, and it shows the office's generic people
  rather than the named characters.
- Sounds: Atlas has no volume control on main yet (pull request #466), so the routine plays none.
