# Map zoom stability

## Confirmed issues

- `fitNow` allowed a maximum distance of 1.8 times the fitted city view, making the city unnecessarily small. The same maximum was not recalculated on all viewport-resize paths after manual navigation.
- The 400-unit ocean plane had a visible edge in the overview. Reviewed browser screenshots showed triangular background gaps beyond it.
- The map render entry point relied on existing viewport/scissor/target state. A regression deliberately leaves a partial viewport/scissor active, then exercises zoom and DPR changes to verify the map recovers to a complete canvas. This is a defensive repair for partial-frame artifacts; the exact native WebKit/Metal cause of the user's black rectangle has not been independently reproduced.

## Changes

Use one zoom-limit calculation for first fit and resize: four-unit minimum, maximum 1.05 times the fitted city distance. Wheel, pinch and toolbar controls retain their existing common limits. Re-clamp an out-of-range camera after resize without resetting its viewing direction.

Start each map frame on the default render target with a full logical viewport and scissoring disabled. Reuse a Vector2; add no continuous timers or allocations per frame. Keep day/night bloom and adaptive DPR.

Extend the existing two-triangle ocean plane past the camera's far range so its hard edge is hidden. No additional terrain meshes or textures.

## Validation

28 focused viewport, trackpad and bloom tests passed; lint, type checks and build passed. Both day/night browser checks passed and screenshots were reviewed in `docs/screenshots/map-zoom/`. They exercise 20 zoom-out clicks, DPR changes (1, 2, 1.5), deliberate partial viewport/scissor state, day/night and close zoom. Screenshot baselines are not changed. Browser software WebGL does not establish native macOS GPU correctness: installed-app zoom verification remains necessary before claiming the specific desktop artifact is fully resolved.

No dependencies, business behavior, paid services, merge or deployment changes.

## Night rendering follow-up

Day and night now use the same direct renderer. The night-only EffectComposer/UnrealBloomPass pipeline and its tests were removed; emissive windows, lamps, materials, shadows and the lighting settings remain. The visual tradeoff is removal of the soft screen-space bloom halo. This eliminates the offscreen compositor path implicated by night-only partial frames rather than relying solely on viewport restoration. No new fallback timers, GPU readbacks or recurring work.

27 focused viewport and trackpad tests, lint, type checks and build passed after removal. Native WebKit/Metal reproduction remains unverified; an installed build must be checked before claiming native GPU correctness.

Both focused night browser checks passed (zoom/DPR/frame coverage and day/night/power-mode/building entry). Updated night overview and close screenshots were reviewed.
