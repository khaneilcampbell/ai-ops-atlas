# Atlas Automation Plaza

A circular public plaza on the lawn beside the paved square in front of the Growth & Marketing Studio (the
`street-reserve:ai-ops-atlas` square left when the Command Center moved), across the street from the
Studio's pools. Nothing else moved: `planPlaza` in `src/views/map3d/plazaPlan.ts` picks the cleared
square nearest the Studio's front and nudges the plaza until its rim clears streets, brooks, the
Vendor & Supplier Hub, the Marketplace and every street, bridge approach and footpath (the lawn there is a 6.4-wide strip between two streets, which caps the disc size). A glass enclosure about 5.7 units tall (taller than the
Vendor & Supplier Hub, shorter than the nearby towers) holds three gold gyroscope rings on a stone
pedestal; the sign in front reads **ATLAS AUTOMATION PLAZA** with the real counts under it.

## Where the status comes from

`src/plaza/plazaState.ts` builds one snapshot from data Atlas already reads. No new polling.

| Source | Hook | Live when |
| --- | --- | --- |
| Agent runs (GitHub sync + agent feed `/api/hooks/agents`) | `useRuntimes` | GitHub sync or the agent feed answers (docs/live-telemetry.md) |
| n8n executions | `useN8nRuns` (every 2 min) | the summary is under 10 minutes old. Hosted site needs the Pages secret `N8N_API_KEY`; the Mac app reads it through Website sync |
| Task Center | `useTasks`, `useRuns` | always (local), but it never makes the plaza "live" by itself |

If neither agent runs nor n8n are current, the sign says **Status unavailable** and the panel names
the integrations to connect. Stale agent reports and old n8n summaries count as unavailable.

## Look

Concept A from Higgsfield, chosen by Khaneil on 2026-11-19 (pictures in the project files under
`automation-plaza/higgsfield-concepts`): a solid gold dome caps the glass, 16 fine gold mullions frame it,
a gold collar sits at its foot, the three rings are gathered in the middle of the lantern over a warm
glowing floor, and a gold ring is inlaid in the paving round the glass. The glass and dome together keep
the old 5.7 height, so the plaza still stands above the Vendor & Supplier Hub and below the nearest tower.
All of it is decoration; none of it shows status.

## What each state looks like

The sculpture always moves (Khaneil, 2026-11-18): the whole gyroscope turns slowly in a circle round
the lantern's upright axis, and inside it each ring tumbles on its own tilted axis. That motion is
decoration and says nothing about status; the run lights, the sign and the lantern colour carry the status.

| State | Plaza | Text |
| --- | --- | --- |
| Running | up to 9 lights ride the rings | "N running · M queued" |
| Handoff | a light travels from the plaza to the building (no standing lines are drawn) | only when an agent finished and another started in the same building within 90 s |
| Completed | brief green ring + check marker | only when the source reports a successful result |
| Needs attention / failed | amber "!" marker | "N need attention: X failed" plus the real reason in the panel |
| Idle | no run lights, soft architectural light only | "0 running · 0 queued" |
| Unavailable | no run lights, grey | "Status unavailable" |

At night the glass lantern is always lit, in the colour of the status (`src/plaza/lantern.ts`): amber
when something needs attention (this outranks running), gold while runs are in progress, soft warm
white when connected and idle, dim grey when status is unavailable, a brief green flash when a run
completes, and violet for the labelled sample preview. The sign and markers say the same
in words and shapes. The colour also fills the glass, runs up a bright core column, pools on the plaza floor and spills onto
the lawn around the steps. A wide, faint halo of the same colour spreads over the lawn, paths and street
around the plaza. It is a flat glow, not a real light: real lights recompile every lit material in the city
and broke the map's shader-program budget (116 of 80).

Decorative light (lamps, warm ring) uses separate materials from the run indicators.
Events are de-duplicated by `kind:id:timestamp` for 15 minutes, at most 3 pulses show at once,
and the first reading after load is a baseline, so a refresh never replays old events.

A test run started by hand in the n8n editor that is still waiting after a day is left out: it was abandoned, not real work. Waiting runs from triggers, webhooks, forms and agents always show.

Paths are drawn only to buildings whose agents have a real execution source (a GitHub workflow,
the agent feed or a linked n8n workflow). An n8n workflow no agent links to has no building.

## Interaction and accessibility

- Click the sculpture, glass, sign or amber marker (drags are ignored) to open the panel:
  attention, active workflows, queued work, agent, building, step and elapsed time when supplied,
  and links to the Task Center or the execution.
- Portraits: agents show initials until portraits are added.
- Keyboard and screen readers: the map has a focusable "Atlas Automation Plaza" button with a
  polite live summary; status always has words and a shape, never only colour or sound.
- Reduced motion: the sculpture stands still and lights don't move; a handoff briefly lights the whole route instead.

## Sound

None yet. The plaza is silent until the city sound work lands; its shimmer and completion chime
ship with that change.

## Sample preview

"Show a sample preview" in the panel plays made-up runs, labelled **Sample preview · not live data**
on the sign and panel. It is session-only, off on every load, and never fires live events.
