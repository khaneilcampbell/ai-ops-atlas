# Command Center, Floor 4 (Blender)

The agent office floor of Atlas Command Center, modelled in Blender from Khaneil's "Agent office
floor" concept panel (2026-11-17). Only Floor 4 is furnished this way so far; the lobby and
Floors 1 to 3 are unchanged.

| File | What it is |
| --- | --- |
| `build_office_floor.py` | The source. Builds the .blend and the GLB from nothing. |
| `command-center-floor4.blend` | Editable scene: one object per piece, in collections (static rooms, service core, workstation kit, zones, preview context). |
| `../../public/models/office/command-center-floor4.glb` | What the app loads (about 0.5 MB, about 8.6k triangles, no textures). |
| `build.json` | Fingerprint of the three files; `commandCenterFloorPlan.test.ts` fails if they drift apart. |

## Changing the design

1. Edit `build_office_floor.py` (hand edits in the .blend are overwritten by the next build).
2. `npm run model:command-center-floor` (Blender 5.3 from /Applications, or set `BLENDER`).
   Blender's Python module works too: `python assets/command-center-office/build_office_floor.py`.
   `RENDER=/tmp/floor4` also renders `/tmp/floor4-reference-angle.png` and `/tmp/floor4-atlas-angle.png`.
3. `npm test -- src/views/office/commandCenterFloorPlan.test.ts`, then look at it in the app.

## What the model holds, and what it never holds

- Static: carpet with brass inlay under the desks, service core with service lift (steps aside
  like a back wall when the camera goes behind it), glass meeting room, lounge, storage, planting.
  None of it takes clicks, so it never gets between the camera and an agent.
- One workstation kit (desk, privacy screen, ergonomic chair, monitor housing) with anchors
  (`anchor_screen`, `anchor_label`, `anchor_lamp`, `anchor_seat`, `anchor_select`). Atlas puts a
  copy at every desk it plans (`planOffice`), so agent ids, floors and desk places never come
  from the model.
- `zones`: the carpet the desks must stay on and keep-out boxes for the rooms and planting. The
  test checks every planned Floor 4 desk against them.
- Never: agents, names, screens' content, status lights or anything else live. A furnished desk
  says nothing about whether an agent is running; Atlas draws that from telemetry.

The glass, slab and wall display shown in the Blender preview are context only (collection
"Preview only (not exported)"); the app draws its own.
