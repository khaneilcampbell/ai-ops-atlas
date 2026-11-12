# Equal operations district parcels

Base: main acf0f21d8a98ad35a51df9b90d5f463d17d9621a. Runtime source: c8a4f86326b8445e54cd8968c123ce88d3a2af9e. Later visual-spec/evidence edits leave runtime unchanged.

Scope: complete By district campus. Commerce keeps its 10 × 10 layout parcel (10.7 × 10.7 terrace); Command Center and Agent Operations move locally to equal-sized parcels beside the existing east city edge. Building widths, heights, architecture and floor counts remain independent of land. Existing fallback layouts and other groupings retain their packing.

The previous sites become unselectable public street reserves, keeping Portfolio's bridge and the original street network. One straight street joins the actual Commerce and Command north plaza lanes. Operations joins Command locally so no new cross-city bridge occupies Development Hub's glass podium. The established Marketplace boulevard retains its old public-grid access. New terrace ground is included before the existing square-island fill, without repacking other districts or relocating landmarks.

Land rendering and ground raycasts use scene terraces; hover and selected rims use districtRect over those same terraces. These three projects use the parcel rim rather than an additional tower box. Building/nameplate selection and district ground select the owning project; the 2D ground handler agrees.

Final lint/typecheck passed; full suite: 200 files / 1,359 tests passed, including the unchanged timing guard. Final desktop and 390×844 iPhone visual cases passed, each checking building geometry, nameplate and ground selection for all three projects. Captures use DPR 1, fixture GitHub data and a fixed overhead diagnostic camera; canvas events are dispatched directly because freezing that camera leaves DOM label positions stale. Nameplate handlers are checked separately. Matching before/after overviews and all three selected states per width are in this folder and were reviewed. No baselines or guards were loosened. Rust unchanged.

Performance: clean-main GPU-only baseline (`PERF_LEAK=0`, unchanged budget) passed: 692 draws, 869,606 triangles, 68 programs, 6.1 MB geometry. Its earlier full probe failed in the leak reader (`last.buffers` on an undefined context). After-change map performance/leak verification remains pending; do not treat this draft as performance-approved. User requested wrapping up without further usage. Required PR map-performance CI must pass before merge.

Earlier local candidates were rejected for transport and neighbor regressions; the final full suite above covers the corrected public street reserves, shared-site preservation and strictly orthogonal through-street.

## Merge preparation — 2026-11-12

Refreshed onto main d440f93; the only rebase conflict was CHANGELOG.md, resolved preserving both entries. Tested refreshed commit: bba71f7e4c6db2fe3f50d66fc2682d114116f054. Final lint/typecheck and full unit suite passed: 200 files / 1,360 tests. Map and visual-spec content are byte-identical to the prior visual evidence; main added only activity-label logic outside the map, so desktop/iPhone evidence was reused.

Full after-change performance and leak check passed with the unchanged budget. `PERF {"run":"desktop day","frames":36,"drawsPerFrame":689,"offscreenDrawsPerFrame":113,"trianglesPerFrame":882082,"cpuMsPerFrame":1429.5,"programs":68,"textures":94,"buffers":1359,"geometryMB":6.2,"heapMB":50.1,"contextsCreated":1,"contextsAlive":1,"extraBuffers":-6,"extraTextures":0,"extraPrograms":-2}`

GPU comparison: before 692 calls / 869,606 triangles / 68 programs / 6.1 MB; after 689 calls / 882,082 triangles / 68 programs / 6.2 MB. Full after cleanup reports one live context; no extra buffers, textures or programs retained. CPU timings use software WebGL and are not a production-speed claim. The earlier pending-performance note is superseded by this successful run. No source changes or baseline updates were needed during merge preparation.

## Reviewed CI screenshot expectations

CI run 43197609925 on head 705a67a passed frontend, Rust, security, dependency and map-performance checks. The visual comparison failures were the intended district relocation/background changes in inside-day, inside-night, inside-phone, map-day, map-night, map-selected, office, phone-map, phone-map-selected and phone-more. Reviewed each expected/actual pair from visual-results-3 and visual-results-6: interiors and controls remain unchanged; city placement, framing and exterior backgrounds reflect the approved change. Updated only those ten CI golden images to the reviewed actual captures. Pixel thresholds, tests, masks, local baselines and performance limits remain unchanged. Other visual shards were canceled by matrix fail-fast and must finish in the next run before merge. Runtime source is unchanged; prior source checks remain applicable.
