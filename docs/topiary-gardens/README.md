# Topiary gardens

Three small formal gardens on open lawn round the city (Khaneil, 2026-11-13), after a topiary chess
garden and a page of shrubs: a green and cream checkerboard lawn on a stone edge, a clipped box hedge
open in the middle of each side, boxwood balls at the openings, evergreen cones in the corners, two
heart topiary trees with roses, hydrangea and camellia pinks in the inner corners, and one centrepiece
each: a topiary chess knight with a gold mane and bridle, a three-tier boxwood, and a large clipped
ball ringed by roses.

- `src/views/map3d/gardenPlan.ts` picks the spots (`planGardens`) and builds the pieces (`gardenParts`).
  A garden only stands on open ground, clear of every building, lot, paving, water, street, walk and
  track, at least 20 units from the next one. At most three. Nothing else on the map moves; loose lawn
  trees and shrubs inside a garden give way.
- `src/views/map3d/Gardens.tsx` draws every garden with five shared instanced meshes: no textures,
  lights or frame work.
- `src/views/map3d/gardenPlan.test.ts` checks every map grouping.
- The Map inventory counts them under Parks, "Topiary garden".

## Screenshots

[Whole map](top-desktop-day.jpg) · [Chess knight garden](knight-desktop-day.jpg) · [At night](knight-desktop-night.jpg) ·
[Tiered garden](tiered-desktop-day.jpg) · [Rose ball garden](ball-desktop-day.jpg) · [iPhone map](top-iphone-day.jpg) · [iPhone close-up](knight-iphone-day.jpg)

## Rollback

Revert the pull request.
