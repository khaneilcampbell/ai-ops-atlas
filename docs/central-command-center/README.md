# Central Command Center

Atlas’s whole 5×5 parcel exchanges places with the equal-sized cleared former Dashboard parcel. Hub center moves from (2.5,17.25) to (22,16.9). This is the center of the project campus, not a redesign of the entire square city. Terrain bounds and architecture stay unchanged. Command Center, Business Operations HQ, Portfolio Site, Development Hub and Security Operations Center now use Agent Operations Center’s logical footprint width (2.55 units); Commerce grows from 3.2 to 3.6 units. Heights and parcel boundaries are unchanged. The widened towers have small rear setbacks to preserve frontage clearance, park spacing and road crossings. Hub worker lots, selection, interior origins and walkway endpoints derive from the relocated shared district data.

Growth & Marketing Studio and Product Marketplace remain at the same coordinates; Galleria retains its existing placement. The old hub location is lawn. No agents, ownership or integrations change. The hub’s overview nameplate gets higher collision priority.

If repository filtering removes part of the expected campus, the existing packing remains in use so Marketplace and Galleria can still find their parcels.

Traffic planning excludes kiosk footprints with a 0.2-unit turning allowance, retaining city traffic without clipping tool offices.

## Validation

52 focused layout, geometry, traffic and scene checks passed. Type checks, lint and build passed. Three day/night/phone building-selection checks passed and screenshots were reviewed. Full suite: 1336 passed; the unchanged map timing guard failed under suite load, then passed in the isolated scene run. No baselines changed. Screenshots use fixtures, not live operational evidence.

[Before day](before/day.jpg) · [After day](after/day.jpg) · [Before night](before/night.jpg) · [After night](after/night.jpg) · [Before phone](before/phone.jpg) · [After phone](after/phone.jpg)

Rollback: revert this PR. No persistent data changes.
