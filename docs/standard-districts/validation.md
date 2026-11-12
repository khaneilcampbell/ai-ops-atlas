# Standard district sizes — blocked draft

Source commit: 541c43bfddd027cf8999eee2c612c34b4ab412fd on codex/standard-district-sizes, based on main 1e50d65. Local repository dependencies and Chromium/SwiftShader with fixture GitHub responses. No installed desktop or production validation.

Implemented: 5×5 single-building parcels and 10×10 multi-building parcels, with consistent terrace margins. External service offices and Development Hub's attached podium count toward the multi-building class. Existing building dimensions are independent of land size. Project-owned selections use the full parcel rim instead of a second tower box/pulse; interiors retain their outlines. Repacking moves district and landmark coordinates. Development Hub's podium stays within its standard parcel; ring-road planning can connect longer links. Portfolio's slot remains vacant when filtered out so the shared Galleria keeps its access land.

Validation: full lint and typecheck passed. Full unit run (`npm test -- --maxWorkers=1`) completed: 1,372 passed, 5 failed across 3 files. The project-ownership outline condition received a final focused lint check and visual coverage after that run; other unit-tested functions were unchanged. Temporary follow-up rail/station experiments were reverted. No tests, limits, baselines or guards were skipped or loosened. Exact coordinate expectations were updated for the requested repacking. The shallow Galleria fixture now explicitly constrains land depth to preserve the original parking fallback assertions.

Final affected visual command: ATLAS_VISUAL_PORT=4186 SHOT_DIR=/private/tmp/standard-district-after npm run visual -- visual/standard-districts.visual.ts. All 3 cases passed (desktop day/night and 390×844 phone), selecting single- and multi-building examples and checking their inspectors. Before desktop/phone and after desktop day/night/phone images are retained here. Screenshots manually reviewed; screenshot-only checks do not compare baselines. Phone captures show the inspector and available map area. The capture clock runs for interaction, then pauses; traffic is disabled.

Blocking unit failures:
- squareTransport.test.ts: missing legacy airport rail leg in none and status groupings (2 tests).
- stadium.test.ts: a route enters the stadium ring in tag grouping, and that grouping has 11 palms against the existing minimum of 12 (2 tests).
- stationPlazaPlan.test.ts: no clear wheel/pavilion plaza found in district grouping (1 test).

The full request is not complete and this branch is not ready to merge. Fix the five regressions before approval, then run applicable final checks and the map performance budget. Performance measurement and broader screenshot/CI completion are not claimed. Work stopped at the user's request to finish with minimal further usage. No merge, deployment, paid/model service, recurring task or parallel agent was used.

At draft PR creation, main had advanced to c7d1396b53b738914c9053419bd3b0b881e953cc. This branch remains based on 1e50d65; refresh and revalidate the affected coverage before any merge. Draft PR #368.
