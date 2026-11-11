# Portfolio district sizing — 2026-11-11

Based on main 1e50d65d77f2780e7e8fe5ead4b5dd4a5e1a00f3, branch codex/portfolio-district-size.

Portfolio's parcel is 7.5 × 7.5 instead of 5 × 5 in all four catalog groupings. Its existing building width matches Operations Center; its canopy now matches that building's roof height. Twelve floors and façade details remain. Local expansion preserves protected anchors and Commons. GitHub's annex retains its depth and three tiers on a shorter clear span. Filtered layouts without room inside the old city boundary keep their fallback parcel.

Final checks on this source tree: lint and typecheck passed; `npm test -- --maxWorkers=1`: 197 files, 1,353 tests passed. One worker avoids contention in the unchanged scene timing guard. Earlier concurrent runs failed that guard; the initial parcel repacking approach failed layout guards and was replaced.

`PORTFOLIO_SITE_SHOTS=1 npm run visual -- visual/portfolio-site.visual.ts -g 'Portfolio Site,|on a phone'`: 3 passed. Reviewed day/night desktop and 390 × 844 phone captures. Before screenshots were captured on main; after cameras are farther back to show the taller building. Screenshot-only specs have no baseline comparison. The existing nameplate selection test stalled on main and was interrupted; it is not claimed as passing. No test or guard was disabled or relaxed.

Environment: local macOS, repository dependencies, Chromium with SwiftShader and frozen-clock fixture data. These are web scene checks, not installed desktop or live operations evidence. Rust unchanged. No extra rendering parts or lights. No merge or deployment.

Images: before-day.png, before-night.png, before-phone.png and corresponding after images.
