# Marketplace floor and circulation repair

## Reusable engineering prompt

Act as a senior software engineer and 3D architectural designer for Atlas. Inspect Marketplace’s existing floor plates, hallway, doors, lift, escalators and furnishings. Standardize usable floor dimensions while preserving floor IDs, worker links, selection and lighting. Derive landings and railing openings from actual floor edges; connect both arrivals and departures. Keep furniture outside the clear hallway and doorway approach. In single-floor views, represent connections to hidden floors clearly rather than drawing unsupported flights. Validate every floor and connection with focused geometry tests, then inspect Floors 2 and 3 and All floors in day and night modes. Preserve performance controls, add no agent execution or continuous animation, and do not merge or deploy.

## Confirmed causes

- The floor generator subtracted 0.075 from each successive floor’s outer radius factor, while the inner edge and fixed furnishings did not shrink proportionately.
- Escalator bridges used a fixed reach, and intermediate floors provided only a departure-side bridge. Incoming flights could miss their landing.
- Single-floor views drew an upward flight toward a hidden destination; food tables and event seating used fixed rows regardless of room depth.

## Implemented

- The original stepped floor profile is shared by map exterior and interior cutaway. The map stays at its original dimensions; the cutaway uses a larger room scale (24×20 radii), adaptive furnishings and minimum hallway clearance. Stable floors and units are preserved.
- Named minimum hallway clearance of 1.35 interior units, kept clear of all room furnishings.
- Landing endpoints computed from both edges of their full-width strip intersecting the actual atrium boundary. Intermediate floors provide both sides. Railing openings use the same landing data.
- Single-floor connection decks have an end guard and a label directing the viewer to All floors; full flights appear only with their destination floors visible.
- Fewer dining tables, room-sized event seating/stages, and removal of unnecessary full-height dividers between shared dining/event bays.
- Original exterior envelope (12.4×11.6) and fin spacing restored. The existing under-1000-piece budget still passes.

## Validation and limits

33 focused tests pass, including interior/exterior profile agreement and per-floor lift alignment, minimum hallway clearance, arrival/departure connectivity, full-width landing overlap, room-sized furniture, worker IDs, ground slab normals and map/garden clearances across grouping modes. Type checks, lint and build pass; existing bundle-size/Tauri import warnings remain.

Day/night browser checks inspect Lobby, Floor 1, Floor 2, Floor 3 and All floors, Output selection and keyboard floor selection. Screenshots use fixture data, not production status. No visual baselines changed.

The lift and commuters remain schematic/static. This repairs the circulation geometry; it does not activate agents or implement a new walking/elevator simulation. Not merged or deployed.

The current interior matches the exterior silhouette, including upper-floor setbacks and curved wings. Interior spacing is enlarged through room scale instead of replacing the stepped profile with identical plates. Ground paving is derived from the actual atrium boundary.
