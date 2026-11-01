# City startup

The screenshot shows cached repositories already loaded while Projects waits for its first graphics frame. The startup overlay used a fixed pale background even when the map used night colors, leaving pale introductory text barely readable. The first city draw also used the full configured Retina pixel ratio.

Use a shared, lighting-aware startup component for module loading and first-frame drawing. Hide the map introduction until that frame is ready. State the real stage without fabricated percentages. After ten seconds, offer a working flat-map escape instead of trapping the user in the 3D loader. Its timeout is removed on unmount; no polling or recurring tasks are added.

Draw the first city frame at DPR 1, then restore the existing saved/adaptive quality after the actual first-frame callback. On a 2× Retina canvas the first frame has one quarter as many output pixels; shader compilation and procedural planning still have one-time startup cost. This does not establish a native Mac startup-time improvement percentage. Keep the retained renderer, hidden rendering pause, context recovery and normal city appearance.

Validation: lint, type checks and build passed. Five focused browser tests passed: dark readable slow startup/flat-map escape, first draw at 1× then restored quality, repeated Projects re-entry with zero hidden draws, cold-load stage/first-frame readiness, and no reload from generated reports. The fallback button contrast was corrected during screenshot review and its focused test rerun. Screenshots use fixtures; native M5/WebKit startup timing remains unmeasured.

Not merged or deployed.
