# Central Command Center

Atlas’s whole 5×5 parcel exchanges places with the equal-sized cleared former Dashboard parcel. Hub center moves from (2.5,17.25) to (22,17.25). This is the center of the project campus, not a redesign of the entire square city. Terrain bounds, building scale and architecture stay unchanged. Hub worker lots, selection, interior origins and walkway endpoints derive from the relocated shared district data.

Growth & Marketing Studio and Product Marketplace remain at the same coordinates; Galleria retains its existing placement. The old hub location is lawn. No agents, ownership or integrations change. The hub’s overview nameplate gets higher collision priority.

If repository filtering removes part of the expected campus, the existing packing remains in use so Marketplace and Galleria can still find their parcels.

## Validation

59 focused layout, Marketplace and Galleria checks passed. Lint, type checks and build passed. Three day/night/phone building-selection checks passed. Screenshots use fixtures, not live operational evidence. Full suite: 1335 passed; the unchanged map timing guard failed under full-suite load, then passed in an isolated 13-test scene/hub run. No baselines changed.

[Before day](before/day.jpg) · [After day](after/day.jpg) · [Before night](before/night.jpg) · [After night](after/night.jpg) · [Before phone](before/phone.jpg) · [After phone](after/phone.jpg)

Rollback: revert this PR. No persistent data changes.
