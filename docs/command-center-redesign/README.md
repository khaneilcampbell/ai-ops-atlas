# Atlas Command Center: cream stone, green glass, brass (prototype)

Khaneil, 2026-11-17: start the Atlas design concept with Atlas Command Center only. Cream stone,
forest-green glass and subtle brass; the outside is the lobby and four office floors you walk
through inside. Parcel, roads, selection, building entry, floor navigation, agents and telemetry
unchanged. The concept images were references, not geometry: everything here is the running app.

## How it is built

- **Existing stack, no new tool or dependency.** The map is React Three Fiber on three.js, and
  every landmark is generated in code: a plain-number plan (`*Plan.ts`), merged geometry
  (`*Geometry.ts`) and a component that picks materials. Atlas's only GLB pipeline is the office
  furniture (`public/models/office/`, loaded with drei's `useGLTF`). A Blender GLB was not needed:
  this building is a rounded block, ledges, piers, a parapet and a box, which the shared helpers in
  `atlasHqGeometry.ts` (`skin`, `bands`, `fins`, `lid`) already build into a few merged meshes. A
  GLB would add a loader request, a second source of truth for storey heights and no saving.
- `src/views/map3d/commandCenterPlan.ts`: the plan. Storeys are the interior's own (lobby 3.3,
  floors 2.7) at its scale of 12 office units per map unit; it fits the old square footprint.
- `src/views/map3d/commandCenterGeometry.ts`: green glass, warm lobby glass, cream stone, one brass
  hairline, roof and lawn, each one merged mesh.
- `src/views/map3d/atlasHqPalette.ts`: the shared colours; the interior shell
  (`src/views/office/AtlasHqShell.tsx`) reads the same palette and the block's proportions.
- `src/views/map3d/AtlasHq.tsx` draws it. The map's shared opening glass doors now stand in the
  stone bay (`ccDoor`), and the nameplate and inside view use the building's real roof (`towerTop`).

## What changed on purpose

- The building is now a five-storey block, lower than before. Three height guards that said "Atlas
  HQ is the tallest" now compare Benjaire HQ and Commerce with Atlas's height share instead, and
  the stadium check leaves Atlas out. The other buildings' heights do not change.
- Inside: green glass on every office floor, warm glass in the lobby, cream stone piers and
  mullions, a slim brass canopy, a flat top floor. The Floor 3 podium terrace is gone, as the new
  building has no podium (its garden is on the roof).

## Validation

- Map performance, unchanged budget (`PERF_BUDGET=1 npm run measure:perf`): desktop day 730 draw
  calls of 800, 867,604 triangles of 1.2M, 73 programs of 80, 6.4 MB, one context, no leak.
  The building itself is under 12k triangles (was under 26k).
- Lint, typecheck and tests pass, except the 300-repository timing test, which also fails on
  plain `main` in this container (1.88 s against 1.5 s).
- Screenshots: `npm run visual -- atlas-hq` with `SHOT_DIR`; before is `main` at 62eba93.

| | Before | After |
| --- | --- | --- |
| Map as it opens | [before](before/map-day.jpg) | [after](after/map-day.jpg) |
| Exterior | [before](before/front-day.jpg) | [after](after/front-day.jpg) |
| Closer exterior | [before](before/close-day.jpg) | [after](after/close-day.jpg) |
| Night | [before](before/front-night.jpg) | [after](after/front-night.jpg) |
| Interior, all floors | [before](before/all-day.jpg) | [after](after/all-day.jpg) |
| Interior, Floor 4 | [before](before/agents-day.jpg) | [after](after/agents-day.jpg) |
| Selected | [before](before/selected.jpg) | [after](after/selected.jpg) |
| iPhone map | [before](before/phone-map.jpg) | [after](after/phone-map.jpg) |
| iPhone exterior | [before](before/phone.jpg) | [after](after/phone.jpg) |
| iPhone interior | [before](before/phone-all.jpg) | [after](after/phone-all.jpg) |

Rollback: revert this pull request.
