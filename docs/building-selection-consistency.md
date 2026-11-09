# Building selection consistency

Financial towers previously registered windows and signs for pointer picking, but their opaque architectural batches disabled raycasting. A click on a roof or solid facade could therefore reach a different building behind the visible surface.

The repair keeps opaque building parts separate from public-space geometry and assigns each instance its existing stable financial building key. Bevelled architectural parts use the same key. Labels, glass, highlights and detail panels retain their existing identity and selection flow. Roads, landscaping and park furniture remain outside the building batch. No new click boxes, models, dependencies, animations or network requests are introduced. One extra shared opaque instanced batch is rendered; no per-frame bookkeeping is added.

`visual/building-selection.visual.ts` frames financial towers by their plaques, finds a solid roof with an unobstructed ray, clicks it through the browser pointer, and checks the selected nameplate and inspector agree. Day checks cover eight towers; night checks cover Wells Fargo and American Express. Shared instance selection metadata makes this test inspect the actual rendered instances instead of guessing screen coordinates.

Validation: type checks, lint, build and 24 focused financial layout/architecture tests passed. Both browser checks passed: eight towers in daylight, and Wells Fargo/American Express at night. Reviewed screenshots are in `docs/screenshots/building-selection/`. Native installed-desktop testing remains a separate check. Not merged or deployed.
