# District-based map presentation

All four map grouping choices now share the district layout. Grouping no longer reallocates lots, rebuilds transportation or resets the camera. No grouping hides group headings; district shows district names; status and tag modes summarize real declared project metadata within each district. These are presentation views, not new physical city layouts. Declared status is labelled explicitly and is not GitHub health.

The message above the bottom-right map controls is removed in every connection lens. Existing selector tooltips remain.

Financial tower names now qualify at overview distance just like project headquarters. Both use the existing shared plaque styling and collision placement; selected labels retain priority. Close-only supporting amenities remain distinct from primary buildings. Collision avoidance can still suppress names that would overlap; selecting or approaching a building reveals its name.

Nine focused presentation, group-label and plaque tests passed. Lint, type checks and build passed. The browser regression switches all four grouping modes and compares rendered instance transforms, object identities and camera matrices. It also checks overview label eligibility, removed messaging, automation view and selection. Screenshots are fixture-based, not proof of live repository state.

This branch is stacked on PR #199 so its preview includes the zoom and direct night renderer. Not merged or deployed.
