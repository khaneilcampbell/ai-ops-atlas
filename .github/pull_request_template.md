## What changes for KC
<!-- One or two plain sentences: what KC will see or be able to do after this merges. -->

## Changelog line
<!-- Also added at the top of CHANGELOG.md. The newest five show in the Mac app's Update button. -->
- YYYY-MM-DD · 

## Risk
<!-- Low, medium or high. High if it touches signing, secrets, CI, the updater, or write actions. -->

## Checks
- [ ] `npm run lint`, `npm run typecheck`, `npm test`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` (if Rust changed)
- [ ] `npm run visual` with before/after screenshots, desktop and iPhone width (if anything on screen changed)
- [ ] macOS build on this branch (if `src-tauri/` changed): run CI by hand with "Also build the macOS app"

## Rollback
<!-- One line. Usually: revert this PR; the revert ships as a newer build and Macs update back within about 10 minutes. -->
