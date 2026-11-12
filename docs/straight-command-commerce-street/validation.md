# Command Center / Commerce street alignment

Source: 96154edc86f610c74e31a9de6f8c86567363a359, based on main c7d1396. Only Atlas Command Center moves within the existing central campus: its north road centerline now equals Commerce's, accounting for rendered building width, plaza lane and HQ setback. Both district sizes and building designs remain unchanged. Other groupings and filtered-campus fallback retain their existing placement behavior. Development Hub is untouched.

Final checks: npm run lint and npm run typecheck passed. npm test -- --maxWorkers=1: all 197 files / 1,349 tests passed, including the unchanged timing guard. An earlier implementation passed functional checks but hit that timing guard under load; its isolated scene rerun passed 10 tests. A visual review then corrected parcel-edge alignment to actual road-centerline alignment, followed by the final successful full run. No guard, baseline or limit was loosened.

ATLAS_VISUAL_PORT=4187 SHOT_DIR=/private/tmp/straight-street-after-final npm run visual -- visual/command-commerce-street.visual.ts: 2 passed, desktop and 390×844 phone. Before and final after images use identical overhead camera positions; both final images reviewed. Fixture GitHub data and Chromium/SwiftShader, not installed desktop or live operations. Screenshot-only checks, no baseline replacement. No Rust changes; no additional buildings, districts or rendering features.

Preview http://127.0.0.1:5230/ uses main c7d1396 plus this exact runtime file. No merge/deploy performed. CI status must be checked separately before user merge.
