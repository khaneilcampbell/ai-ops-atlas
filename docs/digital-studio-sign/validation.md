# Benjaire Digital Studio façade sign

2026-11-11: only the Growth & Marketing Studio façade wording changes. BENJAIRE remains above DIGITAL STUDIO, replacing MARKETING AGENCY. Building display name, panel name, stable IDs, workplaces, Portfolio and geometry remain unchanged.

Tested source: eb56ed0 on codex/digital-studio-sign, based on main 1e50d65. Local macOS and repository dependencies. Lint/typecheck passed; npm test -- --maxWorkers=1: 197 files, 1,348 tests passed. Rust unchanged.

Final visual command: ATLAS_VISUAL_PORT=4181 SHOT_DIR=/private/tmp/digital-sign-after-verified npm run visual -- visual/marketing-sign.visual.ts. Three passed; manually reviewed desktop day/night and 390×844 phone close-ups. Screenshots use frozen fixture data and Chromium/SwiftShader; no baseline comparison or installed desktop verification. Before sign captures use the same sign renderer and framing from an existing local preview. An initial after run reused that older preview and was discarded; final captures used a dedicated server for this branch and visibly show DIGITAL STUDIO. No baselines or guards changed.

Before: before-day.png, before-phone.png. After: after-day.png, after-night.png, after-phone.png. No merge or deployment.
