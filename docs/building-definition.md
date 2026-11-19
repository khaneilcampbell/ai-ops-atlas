# One definition per building

Every headquarters that holds an office has one definition, `src/buildings/buildingDefinition.ts`,
that every view of it reads: the map's exterior, the Inside cutaway, the agents walking in and
sitting down, the building's panel (`src/components/BuildingInside.tsx`) and the full-screen
office's floor numbers. Exterior and interior are two views of the same place.

| Part | Where it comes from |
| --- | --- |
| Id, name, district, purpose | The map's tower (`project:<id>`, never changes) and the project manifest |
| Footprint, storeys, storey height | The tower: its own storey count spread from the floor base to its roof |
| Floor plates | `src/buildings/shellPlates.ts`, measured from the shell the map draws, storey by storey |
| Door, sidewalk, lobby, lift | The lobby's measured front face; the lift stands inside every floor it serves |
| Desks | One per working AI agent (the person its city character stands for), floors 1 to 4 |
| Workflows | Every automation, listed at its owning agent's desk; an automation never gets a seat |
| Desk screens | The agent's operational state (`src/buildings/deskScreen.ts`), the same as its card |

## Rules

- **Inside the glass.** A desk floor is drawn on its storey's measured plate, so it never hangs out
  of a curved or pinched tower. `SHELLS=1 npx playwright test -c visual visual/building-shells.visual.ts`
  measures the shells again and fails if a plate no longer fits; run it after changing a tower's shape
  (`MEASURE=1` prints new plates for `shellPlates.ts`).
- **Same size inside and out.** The interior scale (`INTERIOR_K`) draws the seated person the same
  height as the agent's city character, so a desk is sized for the person who walked in.
- **Desk floors.** An agent's declared `office_floor` is kept when its floor has room; the rest fill
  from floor 4 down. Floor 0 is the lobby. Two agents never share a desk.
- **One floor open.** The Inside view opens one floor per building (`src/buildings/insideFloors.ts`):
  the floor picked, or the highest floor with a desk. Agents on that floor are drawn at their desks;
  anyone above it waits as a badge on the facade at their floor, so nobody floats where the shell is
  cut away. With Inside off, the badge on the facade shows which floor an agent is working on.
- **The walk in** (`journeyTo`): sidewalk, door, lobby, lift, its floor, the aisle behind its chair,
  its chair; leaving is the same in reverse. Every point after the door is inside the shell.
- **Where it is and what it does stay separate.** The character's place comes from its routine
  (`src/routine/`); its work comes only from n8n, GitHub runs and the Task Center. Walking in,
  sitting down, picking a floor or switching views never starts, stops or completes a run.

## Adding a building with desks

Measure its plates with `MEASURE=1 npx playwright test -c visual visual/building-shells.visual.ts` and add them to
`shellPlates.ts`; `buildingDefinition.test.ts` fails for a building with desks and no measured shell.
