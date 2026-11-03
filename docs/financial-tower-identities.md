# Financial District tower identities

Four existing IDs retain their placement and gain distinct, static procedural architecture:

| Stable ID | Display name | Architecture |
|---|---|---|
| residence | Experian (was Garden Residences, then Circa) | Floor-to-ceiling clear glass curtain wall, Experian blue core and crown, lit office floors visible from outside |
| harbor-residence | The Ritz-Carlton | Warm stone, champagne crown, hotel arrival canopy and guest suites |
| records | Wells Fargo | Bevelled glazing, metal rims, red/gold fascia, bank reception |
| financial-planning | Vanguard | Modern Art Deco setbacks, planted terraces, corporate research and meeting rooms |

`financialDimensions` supplies the full envelope, including balconies, podiums and canopies, to layout routing, camera bounds, freight clearance, street lights and the station's onward walk. The five unchanged towers, nine-building count, park, district parcel, highway and railway remain intact. Wells Fargo shifts 1.5 scene units west within its block to keep the taller bank from obscuring Circa; all positions and routes are derived from the shared plan. The station's shore-side walking path moves outward to clear the wider towers. Geometry is calculated once per plan; lighting changes update window colors separately.

## Architectural scale

Wells Fargo uses a **235-metre architectural reference / 18 reference metres per scene height unit = 13.056 scene units**. This is a stylized vertical convention, not a geospatial measurement or a uniform real-world scale for people and vehicles. The existing HQ-relative minimum wins if a grouping produces a taller reference envelope. Crowns receive additional clearance in the camera bounds.

## Identity and interiors

All Financial District interiors now have stable `financial:<id>` keys. The new Wells Fargo route is `financial:records`; the existing Skyline Wells Fargo keeps its name, room configuration and location. Old, unambiguous names remain aliases. Global search matches both new names and old names.

Existing furnished interiors provide the lobby and four selectable schematic floors, rather than a floor-by-floor representation of the high-rise. Circa and the hotel have beds and lounges; Vanguard retains planning and meeting workspaces; the bank has advisory spaces. No workers, services, repositories or financial data are created or connected. Company names are unofficial visual representations.

## Validation

Focused layout, architecture, identity, transport and street-light tests cover all grouping modes, safe envelopes, balcony circulation, planting height, preserved IDs and the separate bank routes. Browser checks cover day/night appearance, search-to-panel selection, explicit entry, lobby/floor navigation and exit. Screenshots use deterministic GitHub fixtures, not live account or repository evidence. Before images reuse the previously reviewed Financial District layout captures; no visual baselines are replaced.

No merge or deployment is included.

## Circa / American Express placement update

Circa (stable ID `residence`) now occupies Spending & Budget's former local position `(3.5, 9)`. American Express (stable ID `budget`, legacy name Spending & Budget) occupies Circa's former position `(15.7, 4.3)`. Each keeps its existing height role. All other towers retain their positions.

American Express uses the shared Art Deco planner with blue/white branding, silver ribs, stepped planted terraces, a dedicated two-line wordmark fascia and three blue crown fins. Its existing budget-review purpose and local-read-only boundaries remain intact. Interior rooms are member reception, spending review, budget planning and private consultation; no services or agents are connected.

The shared geometry envelope continues to drive entrances, freight avoidance, street lights and the station's shore walk. Regression tests enforce the exact swap, names, legacy search alias, interiors and clear access across all grouping modes.


### American Express glass and height follow-up
- American Express now derives its height from the actual Wells Fargo tower, with a 1.8-unit minimum height advantage.
- BMW and American Express share clear architectural glazing. Amex has hollow upper floors, narrow cores, desks, ceiling illumination and slim mullions instead of an opaque volume behind its windows.
- Focused architectural/layout checks, type checks, lint and build passed. Browser verification covered current and legacy search, lobby/floor navigation, exit, and day/night appearance.

### District life follow-up
- Added 30 bounded, instanced visual visitors: 13 around financial entrances/park/promenade, eight on community paths, five on the golf course/edge path and four at BMW.
- Financial bank/residence visitors use the existing approaches and stop in real hollow foyers. BMW visitors remain on the display forecourt and inside the showroom, away from the active service aisle.
- Nine entrances use shared sliding glass panels and moving handles. They open before crossing, hold while visitors remain nearby, and close afterward. The unfinished Business Finance tower is not treated as an enterable foyer.
- Expanded the existing rail simulation to six unnamed commuters, with two visible riders per carriage. Figures are visual residents, not registered agents or evidence of live execution.
- New movement pauses with Traffic off, reduced motion, Battery saver, background/hidden map or an interior overlay. No timers, external requests, paid calls, or registry activation were added.
- Validation: 34 focused tests passed across grouping, obstacle/parking/pool clearance, door thresholds, continuous visit cycles, existing train planning, architecture and door easing. Type checks, lint and build passed. Browser checks exercised a complete six-person train round trip, rendered crowd counts and door opening, and Battery saver freezing. Day/night captures were reviewed.
- Remaining scope: visitors use simple deterministic paths, not a collision-aware pedestrian traffic simulator; community amenities remain exterior previews, and BMW is viewed through its glazing. No merge or deployment.


### American Express restoration and bank location swap
- Restored American Express to its earlier Art Deco solid facade, regular window grid, blue crown details and original HQ-relative height (reference × 1.08). Removed the later hollow glass-floor treatment and forced height advantage over Wells Fargo.
- Swapped the exact current American Express and Wells Fargo slots: American Express now uses local (14.5, 9.5); Wells Fargo uses (15.7, 4.3), before the shared expansion offset. Circa remains in place.
- Existing stable IDs, branded interiors, visitor doors and routes follow the shared planner. No unrelated architectural or community changes were reverted.
- 36 focused tests passed for tower geometry, heights, locations, clearances, rail access and visitor paths across grouping modes.
- Browser verification passed for both tower selections, restored relative height, legacy search, American Express lobby/floor navigation, exit and day/night screenshots. Type checks, lint and build passed; existing bundle-size warnings remain. Not merged or deployed.


### Benjaire Finance
- Renamed the existing business-finance identity to Benjaire Finance, retaining its slot, height ratio and stable route. Business Finance remains a searchable legacy alias.
- Sources reviewed: https://benjaire.com/ ; https://github.com/khaneilcampbell/benjaire.com/blob/main/site/src/styles/global.css ; site/public/brand/benjaire-monogram-graphite.svg and benjaire-wordmark.svg. The repository's Pavilion identity supplies pearl #f3f3f1, silver #8e939a and charcoal #1f2124. Glass is an Atlas interpretation.
- Added a pearl/silver facade, dark accents, three connected pavilion roof ribbons, original vector monogram and wordmark rendered locally on canvas, finance room names and design-reference links. No runtime asset or font downloads.
- New hollow foyer participates in the existing visitor/door system: 31 added visitors and ten paired entrance doors total. Financial connections and the proposed role remain inactive.
- Confirmed and fixed exact-name search being outranked by a dashboard description match; exact titles and legacy aliases now rank first, preserving other result ordering.
- Validation: 44 focused tests, type checks, lint and build passed. The initial browser check reached the map but caught the search mismatch. The requested browser rerun after the search fix was declined, so final visual/navigation verification and new screenshots remain incomplete. No merge or deployment.


### Flight clearance repair
- Confirmed the commercial city circuit used a fixed height of 14 while the private jet flew at 8.5; Financial District roofs can exceed those heights.
- Added a shared scene-derived roof envelope for headquarters/crowns, financial towers, uncataloged repositories, worker houses, tool buildings, airport buildings, BMW and community structures. Both commercial and private flights use roof clearance plus a four-unit margin.
- Commercial departures keep the original taxi/runway path and reach clearance height on the runway heading before the first city turn. Climb and circuit heights join continuously; private-jet orbit shape remains unchanged. The 15-second scheduler and existing pause controls are preserved.
- Flight calculations and the airport mirror transform are shared by rendering and tests. Static height planning runs once per scene; no added animation clocks, network requests or dependencies.
- Focused validation samples the actual commercial poses throughout the full cycle against conservative building/airframe envelopes in all four grouping modes, checks private-jet height throughout its orbit, and verifies future tower growth. Existing schedule, continuity, runway and airport tests remain passing. No browser rerun was requested for this math-focused fix. Not merged or deployed.

### Final merge validation

Integrated the latest main-branch WebGL recovery and adaptive quality changes. Full suite: **485 tests passed**; lint and type checks passed. Browser review: **15 passed, 1 intentionally skipped**, covering desktop/phone layouts, day/night map, office, and building navigation. A final desktop/phone check also passed and confirmed the blimp is above the skyline. Commercial planes, private jets, the blimp and balloon baskets now share roof-clearance planning. Screenshots: [desktop](screenshots/pr-153/desktop-day.png), [phone](screenshots/pr-153/phone-day.png). No visual baselines were replaced.

## Circa twin towers (west waterfront parcel)

The `residence` tower was renamed **Garden Residences** so the name Circa belongs to the new twin-tower landmark (stable ID `circa`), on a waterfront parcel west of Navy Federal Credit Union and Vanguard, beside the highway. It is the tallest Financial District building (its roof clears the Wells Fargo-scaled tower by `CIRCA.lead`). It is a stylized, unofficial landmark inspired by the 2018 Downtown Los Angeles complex: two elliptical glass towers with balcony ribs on one side, an eight-storey podium with street retail and louvered parking, a wave-shaped emissive LED band wrapping all four sides of the podium, a glass entry on the street face sized like the district's other front doors (`CIRCA.entrance.w` 1.8, doors .74 by .65, canopy at the shared door height), opening into a wider lobby (`CIRCA.entrance.lobby` 2.8) seen through the podium glass opening into a lobby recessed `CIRCA.entrance.recess` into the podium (a stylized, logo-free take on a modern residential lobby: black-framed storefront with centre double doors, slatted grey ceiling with black spotlights, faceted marble west wall, sculpted wavy walnut east wall, walnut elevator vestibule on grey stone tile with two sculptural pillars, marble-and-walnut reception under pendant rods, a diamond chandelier over a round flower table, and two lounges; the same design is the ground floor inside "Enter building", `src/views/office/CircaLobby.tsx`), and stays below the band, which sits at y .94 to 1.6 on the podium (`CIRCA.entrance`, `circaEntrance()`; Circa skips the shared plinth and door landing) (abstract placeholder content, scrolls only when motion is allowed) and a rooftop pool deck. Geometry lives in `circaPlan.ts` (pure, tested) and `CircaTowers.tsx` (instanced, no lights). The highway's north-west run keeps at least 1.2 units from the parcel in every grouping (`CIRCA_HIGHWAY_GAP` in `cityPerimeter.ts`).

### Inside Circa

"Enter building" numbers Circa's floors like a real building, and only Circa: Floor 1 is the lobby (`CircaLobby.tsx`), Floor 2 the open-air pool deck on the podium roof, and Floors 3 to 6 apartments (six floors; `interiorFloors()` in `src/views/office/circaFloors.ts` returns 5 levels above the lobby, every other building keeps 4 and Atlas Hills 1). The pool deck mirrors the deck on the map: round pool ringed by loungers, lap pool under a white colonnade, three cabanas, a round spa, a fire pit and palms, with a glass rail on the street edge. Each apartment floor has a 2 bed + 2 bath on the curved north glass (island kitchen, round column, curved sofa, marble tables, two bedrooms with baths) and two mirrored 1 bed + 1 bath units on the street side (galley kitchen, live-edge dining table, velvet sofa, cognac chair, walnut sideboard, bath with tub, washer/dryer closet). Sofa colours rotate by floor. Labels only say "Apartment 302 · 1 bed"; there is no rent, availability or resident data. Layout and furniture are pure part lists in `circaInteriorParts.ts` (tested in `circaFloors.test.ts`), drawn by `CircaUpperFloors.tsx` as six instanced meshes per floor with no lights; glow is emissive only. A stylized, unofficial take on a modern Downtown LA apartment, not the real building's floor plans.

**Grounded lobby, Circa lift, oval floors (Nov 3).** The city drawn round the interior (`CityOutside.tsx`) used to leave out Circa's raised lot and the Financial District terrace, because the map draws those with the district rather than the shared terrain, so the lobby slab hung about 2.75 units above the bare ground. It now draws both terraces plus Circa's street, walks and seawall (`circaSitePieces()` in `map3d/circaSite.ts`, shared with `CircaTowers.tsx`), and drops the city by exactly the slab thickness (`cityDrop()` in `office/interiorGround.ts`), so the lot meets the bottom of the lobby slab. Other buildings keep the old 0.35 drop. The lift takes a palette (`LiftTheme` in `circulation.ts`): Circa's is black header, walnut cab, warm grey stone platform, bronze doors and call button, and a thin emissive floor indicator; `ATLAS_LIFT` keeps every other building's colours. Floors 3 to 6 are an oval plate (`CIRCA_PLATE`: centre x 1.1, rx 9.1, rz 6), so the west tip meets the podium edge and the lift shaft at the east tip sits inside the glass. Curved floor-to-ceiling glass with black mullions runs all round, full height on the far (north) arc and a low rail on the near arc. The 2 bed spans the north arc (master suite in the west tip, island kitchen, curved sofa, second bedroom east), the two mirrored 1 beds share a party wall on the ellipse's centre line along the south arc, and a fire stair fills the west tip at the corridor's end. Floors 1 and 2 stay rectangular like the podium; the pool deck carries a bronze inlay of the tower's oval footprint and slim columns where the deck is clear. Tests check every piece against the ellipse, the shaft inside the glass, the lift walk, the drop rule and the lift palettes.

## Experian (stable ID `residence`)

The former Garden Residences tower is an unofficial Experian-inspired business building (`architecture:'curtain'`). Each office floor is one clear glass volume from slab to slab (the district's shared `CLEAR_ARCHITECTURAL_GLASS` material), with dark mullions, a blue service core, desks and magenta/purple meeting pods. The floor panel uses the district's existing interior-glow material, so floors read pale by day and lit at night without any new lights or materials. The sign draws a dot cluster and lowercase wordmark on the shared canvas sign (`symbol:'experian'`). The stable ID, position, height and the old name `Residence` (search alias and interior route) are unchanged. Preview shots: `EXPERIAN_SHOTS=1 npx playwright test -c visual experian`.
