# Mac rendering efficiency

Focused changes on top of main `45c0b5a`, preserving appearance and scene complexity. No device-name detection, dependencies, lower visual defaults or saved-setting changes.

## Confirmed issues and repairs

1. **Unnecessary static/background frames.** The map started its 30 FPS idle pump even when Reduce motion had frozen the simulation. Covered maps could still receive global wake scheduling; interiors did not set their canvases to stop when the document was hidden. The shared visibility/pacing policy now suspends hidden and covered pumps, stops all hidden interior canvases, and lets static scenes sleep while camera interactions and application updates still invalidate them.
2. **Night resolution did not follow quality changes.** Bloom sizing depended on window size, not adaptive DPR. A Retina-sized effect could remain after the governor reduced canvas resolution. The pipeline now checks actual renderer dimensions and DPR, resizes only when they change, and preserves the original bloom settings and half-resolution mip chain.
3. **Incomplete GPU cleanup.** `EffectComposer.dispose()` in the installed Three version releases its own two targets and copy pass, but not added passes. All owned passes and bloom targets are now released exactly once, including the high-pass material omitted by Three r180's bloom disposal. Daylight allocates no bloom pipeline; repeated night/day switches reuse one pipeline per mounted canvas.

## Evidence

- Existing animated desktop-day probe before changes: **660 draw calls/frame, 979,873 triangles/frame, 7 MB geometry, 61 shader programs**. Software WebGL timings are not M5 Pro hardware FPS.
- Identical static/Reduce-motion browser regression against unchanged main: **22,528 draw calls in one simulated second**, failing the new no-idle-drawing assertion as expected.
- Updated static scene: **0 idle draw calls** in the same test; camera navigation wakes drawing and hidden-window drawing stops. These savings apply to static scenes, not a claim that an animated city draws zero frames.
- Resource tests cover DPR 2 → 1 (1600 → 800 pixel-wide offscreen targets), viewport changes, no repeat sizing at rest, and complete idempotent disposal.

## MacBook Pro use

Balanced retains Retina detail and full-rate interaction, with paced background animation. Automatic uses the existing macOS power-source integration to select Battery saver on battery. Best remains available; no hardware-specific limits or speculative M5 Pro benchmark claims are introduced. Actual macOS WebKit/Metal frame time, thermal behavior and Energy Impact still require an installed-app hardware session; browser validation here uses Chromium/SwiftShader.

## Validation

- Full suite after integrating main `6e633d8`: **688 passed, 2 skipped**. Type checks, lint, build and diff whitespace checks passed. Existing chunk-size/Tauri import warnings remain; no Rust changes.
- Focused browser checks: **2 passed** — static idle, camera wake, document visibility, DPR change, day/night switching, office entry, desktop and phone screenshots.
- Before/after comparison: **0 differing pixels**, both desktop (3024×1800) and phone (780×1688), at the existing screenshot threshold 0.2. [Desktop before](screenshots/render-efficiency/before-desktop.png) · [after](screenshots/render-efficiency/after-desktop.png) · [Phone before](screenshots/render-efficiency/before-phone.png) · [after](screenshots/render-efficiency/after-phone.png).
- The baseline intentionally fails the added idle assertion; the updated branch passes. No visual baselines were replaced. Full screenshot-suite/installed macOS energy measurements were not run in this focused pass.

The before/after comparison isolates these performance changes against main `45c0b5a`. Subsequent main updates (Marketplace, Hills mansion and commuters through `6e633d8`) are preserved and the combined branch is revalidated.

## Projects re-entry delay

Confirmed in `App.tsx`: the view-keyed boundary and conditional MapView mount destroyed the entire WebGL scene on every departure from Projects. Re-entry repeated scene construction, GPU uploads and shader setup. The lazy map import also had a null loading fallback.

Projects now retains exactly one map instance outside the route-keyed boundary. Its inactive host stays measured but is invisible, inert and excluded from accessibility. Retaining dimensions avoids a resize-observer race that can leave a resumed canvas waiting to draw. An explicit active prop stops the canvas and frame pump while other pages are open; 2D camera animation is cancelled and open interiors close as before. The first visit shows loading/preparation until a real map frame has been submitted. Context-loss retry still creates a fresh canvas when genuinely needed.

Validation on the latest city: browser regression passed three page round trips with the exact same canvas, zero hidden draw calls even after an unrelated wake, successful redraw on return, building entry/exit, and first-load status. Desktop/phone screenshots reviewed: [desktop](screenshots/projects-resume/desktop.png), [phone](screenshots/projects-resume/phone.png). Full unit suite: **696 passed, 2 skipped**; lint, type checks and build passed. No native latency percentage is claimed. One cached scene remains in memory off-page; initial startup still needs its one-time 3D setup. The saved view/camera and graphics quality are retained rather than allocating multiple scenes.

Final reconciliation through main `de6e8f2` preserves Atlas naming, CI health, Commerce annexes, every-view placement and close-up lighting changes. Revalidated: **716 unit tests passed, 2 skipped**; lint, type checks, build and both Projects browser regressions passed. Screenshot artifacts were refreshed on this combined version. The agent Output implementation remains a separate PR (#194).

A second preview-only cause was confirmed in the live Vite log: writing `playwright-report/index.html` triggered a full-page reload. Development watching now ignores generated Playwright reports, results, visual output and artifact folders. A browser regression writes a generated HTML report and confirms zero navigations; lint, types and build pass. Production bundling and application data remain unchanged by this watch setting.
