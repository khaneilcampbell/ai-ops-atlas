# Community Pavilion & Café

A low public pavilion on the paved square the Intelligence Hub left, between the operations through
street and the Marketplace boulevard, just east of the Atlas Automation Plaza. Atlas's agents spend
free time there. It shows on the 3D map in the District grouping only (the other groupings close that
square up).

## What is built
- Two floors (Khaneil, 2026-11-19): the café on the ground floor, then a stone floor band and an upper
  storey with a row of tall windows between stone pilasters, which light up warm at night. Agents use
  the ground floor only; the upper floor and roof lift away with the Inside toggle.
- Cream stone walls, a forest-green hipped roof with a gold fascia and ridge, and glass fronts on the
  west (the entrance, facing the walk down from the plaza crossing) and the south, with gold mullions.
- Inside: a counter with an espresso machine, pastry case and back-bar shelves, pendant lights and two
  tables for four seats. The roof lifts away with the map's Inside toggle.
- Outside: a pergola terrace with three tables of four (the south one under a cream umbrella),
  climbing leaves on the beams, planters, two benches facing the pavilion and four lamps.
- The sign "Community Pavilion & Café" over the entrance.

Code: `src/views/map3d/cafePlan.ts` (layout, sizes, seats and walking routes, pure),
`CommunityCafe.tsx` (drawing), `cafeVisits.ts` (who sits where), `src/components/CommunityCafePanel.tsx`.

## Sized for the agents
Every size comes from `agentBody.ts` (the larger agent bodies), never from the floating photo
markers. The door is two agents wide and a standing agent plus clearance tall, the ceiling, pergola and
umbrella edges clear a standing agent, seats are at hip height so seated legs rest level, tables just
above them, and the counter at waist height. Seats are a seated agent's shoulders apart.

## Visits
"Café" is a free-time choice like the park or the Ferris wheel (`routine.ts`, `freeTime.ts`): an agent
walks to the entrance, goes in, stops at the counter for 12 to 32 seconds, walks to its seat, sits for
the rest of its stay (8 to 25 minutes) and walks back out. Seats and counter places are given first
come, first served for the whole visit, so no seat is ever given twice and nobody stands in the walk
in; 20 seats hold all 17 agents. New work cuts the stay short with just enough time to get out of the
door (the longest walk out, `leaveSecs`) and then the usual walk to the office. Work itself is never
delayed: the routine is a picture only, worked out from the real schedules with simple rules and no AI
calls. Nothing is ordered, paid for or sent.

## Selecting it
The café's panel shows what it is for, who is there now (with what they are doing and until when),
free seats inside, on the terrace and on benches, View inside, and Select agent / Follow for each
visitor, all from the same visits the map draws.

## Not done
- No ambience sound: Atlas has no sound volume control on `main` yet, and the request was to add
  sound only through one.
- Agents walk the café's own routes; the city walking graph brings them to its entrance.
