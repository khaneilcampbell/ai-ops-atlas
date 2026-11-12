# Equal operations district parcels

Base: main acf0f21d8a98ad35a51df9b90d5f463d17d9621a. Runtime source: c8a4f86326b8445e54cd8968c123ce88d3a2af9e. Later visual-spec/evidence edits leave runtime unchanged.

Scope: complete By district campus. Commerce keeps its 10 × 10 layout parcel (10.7 × 10.7 terrace); Command Center and Agent Operations move locally to equal-sized parcels beside the existing east city edge. Building widths, heights, architecture and floor counts remain independent of land. Existing fallback layouts and other groupings retain their packing.

The previous sites become unselectable public street reserves, keeping Portfolio's bridge and the original street network. One straight street joins the actual Commerce and Command north plaza lanes. Operations joins Command locally so no new cross-city bridge occupies Development Hub's glass podium. The established Marketplace boulevard retains its old public-grid access. New terrace ground is included before the existing square-island fill, without repacking other districts or relocating landmarks.

Land rendering and ground raycasts use scene terraces; hover and selected rims use districtRect over those same terraces. These three projects use the parcel rim rather than an additional tower box. Building/nameplate selection and district ground select the owning project; the 2D ground handler agrees.

Final lint/typecheck passed; full suite: 200 files / 1,359 tests passed, including the unchanged timing guard. Final desktop and 390×844 iPhone visual cases passed, each checking building geometry, nameplate and ground selection for all three projects. Captures use DPR 1, fixture GitHub data and a fixed overhead diagnostic camera; canvas events are dispatched directly because freezing that camera leaves DOM label positions stale. Nameplate handlers are checked separately. Matching before/after overviews and all three selected states per width are in this folder and were reviewed. No baselines or guards were loosened. Rust unchanged.

Performance: clean-main GPU-only baseline (`PERF_LEAK=0`, unchanged budget) passed: 692 draws, 869,606 triangles, 68 programs, 6.1 MB geometry. Its earlier full probe failed in the leak reader (`last.buffers` on an undefined context). After-change map performance/leak verification remains pending; do not treat this draft as performance-approved. User requested wrapping up without further usage. Required PR map-performance CI must pass before merge.

Earlier local candidates were rejected for transport and neighbor regressions; the final full suite above covers the corrected public street reserves, shared-site preservation and strictly orthogonal through-street.
