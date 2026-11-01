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

- Full suite: **656 passed, 2 skipped**. Type checks, lint, build and diff whitespace checks passed. Existing chunk-size/Tauri import warnings remain; no Rust changes.
- Focused browser checks: **2 passed** — static idle, camera wake, document visibility, DPR change, day/night switching, office entry, desktop and phone screenshots.
- Before/after comparison: **0 differing pixels**, both desktop (3024×1800) and phone (780×1688), at the existing screenshot threshold 0.2. [Desktop before](screenshots/render-efficiency/before-desktop.png) · [after](screenshots/render-efficiency/after-desktop.png) · [Phone before](screenshots/render-efficiency/before-phone.png) · [after](screenshots/render-efficiency/after-phone.png).
- The baseline intentionally fails the added idle assertion; the updated branch passes. No visual baselines were replaced. Full screenshot-suite/installed macOS energy measurements were not run in this focused pass.
