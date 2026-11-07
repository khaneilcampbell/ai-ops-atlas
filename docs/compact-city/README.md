# Compact city and Marketplace rail

Atlas Hills is removed from the active map. Its estate, community, golf, station and selection
objects are no longer emitted. Catalog projects, registered agents, repositories, ownership and
history are unchanged; no Hills workplace assignment existed to migrate. Reusable legacy geometry
and pure planners remain in source rather than deleting shared code.

Marketplace has its own local-access reservation instead of depending on an estate parcel. Atlas
Station sits beside the Marketplace garden, with a platform, stairs, lift and pedestrian approach
to the public plaza. No separate named Atlas Central Station existed in current main: the former Hills
endpoint is replaced, not supplemented. Its new selection key is `service:atlas-station`.
The Financial District station keeps its identity. Legacy rail field names remain internal for
compatibility; they no longer point to residential destinations.

```mermaid
flowchart LR
 M[Marketplace public plaza] --> W[Sidewalk and garden terrace]
 W --> A[Atlas Central Station: stairs / lift / platform]
 A <-->|One simulated train; 15-second stops| F[Financial District Station]
 F --> P[Financial Park paths]
 P --> B[Financial District entrances]
```

The perimeter is the smallest square enclosing existing parcels and the airport safety margin.
Rendering, junctions and freight planning share these bounds. Original project placements and
building dimensions remain; Marketplace is aligned to its own boulevard and the retained city grid.
Water channels remain, so a square highway boundary does not mean every gap becomes land.
All UI grouping modes already use the canonical district geometry, and this remains unchanged.
Camera bounds continue to derive from the resulting scene, including the supported highway.

A collector-snapping regression exposed by the revised perimeter is repaired by validating the
semi's swept footprint and reusing a complete interchange when a snapped dogleg is too tight.
Tests check both truck directions and keep the one-road-per-gap requirement.
Station stairs/lift footprints also clear vegetation and raised garden beds. Water and low paving
remain intact.

## Validation

- Full unit suite: 981 passed; two pre-existing skipped tests unchanged.
- Lint, type checks and production build pass. Existing bundle-size/import warnings remain.
- Focused desktop/phone browser checks capture day/night, no Hills nameplate, no page errors,
  and Atlas Central Station selection. Before screenshots captured from main `316315c`.
- Existing commuter tests exercise boarding/alighting timing, continuous travel and the complete
  round-trip state machine; new checks cover square bounds, station access and retained records.
- Screenshots use synthetic GitHub fixtures; header CI badges are not production evidence.
- No visual baselines changed. No dependencies, schedules, integrations or agents activated.

## Limits and rollback

This is visual transport, not a live transit service. Lift access is schematic. A real-time complete
journey has logic coverage; screenshots are representative states, not a recorded end-to-end video.
No wholesale tower redesign or relocation is included. Revert this PR to restore the earlier map;
no data migration or repository restoration is required. Nothing has been merged or deployed.
