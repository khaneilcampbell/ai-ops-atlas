# Atlas Hills community preview

Names: the district is **Atlas Hills** and the house on its estate is **Atlas Mansion** (KC, 2026-11-01). The names live in `hillsPlan.ts` (`HILLS_DISTRICT_NAME`, `MANSION_NAME`). Ids did not change: the selection key stays `service:atlas-hills` and the interior key stays `skyline-business:Atlas Hills`, shown as Atlas Mansion through `interiorDisplayName`. Atlas Hills Station keeps the district name.

Planned visual community; no agents, memberships, financial accounts, external services, bookings or payments are activated.

Atlas Mansion (the estate's house), its garage, pool and tennis court retain their original placement. The parcel extends outward to hold four residences, village shops, a café, a community clubhouse, a gym, social club, wellness spa, golf clubhouse and schematic three-hole short course.

## Passenger connection

Homes → Atlas Hills Station ⇄ Financial District Station → district promenade → bank entrance and existing pedestrian network.

One reversible three-car train uses an elevated perimeter route. Carriages follow the same sampled track independently, with additional physical track beyond station stop centers. Both stations have stairs, protected landings and schematic lifts. The Financial station has a separate shore bridge and a reserved footprint clear of freight access. Crossings are derived from actual road intersections.

Three unnamed residents illustrate commuting. They walk home and back during the Hills stop, ride to the Financial District, walk to a bank entrance and back, and ride home. Train doors open during station dwell and close before movement. This is a visual simulation, not evidence of live agent execution.

Traffic must be enabled and reduced motion disabled to see movement. Battery saver, a hidden map or an unfocused window pauses the new service. The simulation clock holds its position while paused; it does not catch up in the background.

## Implementation

- `hillsPlan.ts`: expanded parcel; original 20-unit estate anchor preserved.
- `hillsCommunityPlan.ts`: stable amenity IDs, shared street/walking routes, station geometry, rail sampling, deterministic train and commuter phases.
- `HillsCommunity.tsx`: instanced neighborhood and track geometry, shared materials, one train and three residents.
- `scene.ts`: reserved station parcel, freight clearance and shared planning integration.
- Existing selection/nameplate systems provide detail panels and collision-aware labels. One Atlas Mansion label appears at overview distance (its hover title names Atlas Hills); supporting names appear on selection or closer zoom. Search finds both Atlas Hills and Atlas Mansion and opens the Atlas Hills panel.

## Validation

25 focused tests cover all four grouping modes, parcel and building clearance, pedestrian paths, airport separation, complete round-trip timing, door phases, articulated carriage clearance, original estate connections and freight access. Type checks, lint and a production build are required. Browser checks cover day/night appearance, both stations, selection-first details and mansion floor navigation.

## Limits

Only Atlas Mansion has an enterable interior. New amenities are exterior previews. Lifts are schematic and not animated. There are two train stops; onward travel uses existing pedestrian connections. The golf course is a compact schematic short course, not a regulation course. No additional integrations or agents were created. No merge or deployment is included.
