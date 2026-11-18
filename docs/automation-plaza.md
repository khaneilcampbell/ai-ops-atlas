# Atlas Automation Plaza

A circular public plaza on the former Career Applications lot (`park:vacant:career-optimizer`),
between the Portfolio, Commerce, GitHub and SOC Lab buildings. Nothing else moved: the plaza slides
east inside the lot until its rim clears the middle avenue (`planPlaza` in
`src/views/map3d/plazaPlan.ts`). A glass enclosure holds three gold gyroscope rings on a stone
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

## What each state looks like

| State | Plaza | Text |
| --- | --- | --- |
| Running | rings turn, up to 9 lights ride them | "N running · M queued" |
| Handoff | a light runs along the gold path to the building | only when an agent finished and another started in the same building within 90 s |
| Completed | brief green ring + check marker | only when the source reports a successful result |
| Needs attention / failed | amber "!" marker | "N need attention: X failed" plus the real reason in the panel |
| Idle | still rings, soft architectural light only | "0 running · 0 queued" |
| Unavailable | still rings, grey | "Status unavailable" |

Decorative light (path glow, lamps, warm ring) uses separate materials from the run indicators.
Events are de-duplicated by `kind:id:timestamp` for 15 minutes, at most 3 pulses show at once,
and the first reading after load is a baseline, so a refresh never replays old events.

Paths are drawn only to buildings whose agents have a real execution source (a GitHub workflow,
the agent feed or a linked n8n workflow). An n8n workflow no agent links to has no building.

## Interaction and accessibility

- Click the sculpture, glass, sign or amber marker (drags are ignored) to open the panel:
  attention, active workflows, queued work, agent, building, step and elapsed time when supplied,
  and links to the Task Center or the execution.
- Portraits: agents show initials until portraits are added.
- Keyboard and screen readers: the map has a focusable "Atlas Automation Plaza" button with a
  polite live summary; status always has words and a shape, never only colour or sound.
- Reduced motion: no rotation or moving lights; a handoff lights the whole path instead.

## Sound

Uses the city sound toggle and volume (`src/sound`). Muted on first visit, preference remembered,
starts only after a click. A quiet shimmer plays near the plaza while runs are in progress and a
soft chime on completion. Mute silences everything at once; sound pauses when the tab is hidden or
the map closes.

## Sample preview

"Show a sample preview" in the panel plays made-up runs, labelled **Sample preview · not live data**
on the sign and panel. It is session-only, off on every load, and never fires live events.
