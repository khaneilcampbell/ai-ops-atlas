# Working on Atlas

Atlas is a Tauri Mac app and the same React app as a private web page (Cloudflare Pages). Every merge
to `main` signs and publishes a Mac update that KC's installed app picks up within about 10 minutes,
and redeploys the web page. Treat every merge as a production release.

## Every change
- One small pull request per change, on its own branch. Fill in `.github/pull_request_template.md`.
- Add one line at the top of `CHANGELOG.md`: `- YYYY-MM-DD · What changed, in plain words (#PR)`.
  KC reads these in the Update button, so write for KC.
- Add or update tests for new logic. Before pushing, run `npm run lint`, `npm run typecheck`,
  `npm test`, and `cargo test --manifest-path src-tauri/Cargo.toml` when Rust changed.
- Anything on screen: `npm run visual` (see `docs/visual-testing.md`) and attach before/after
  screenshots at desktop and iPhone width.
- Rust or Tauri changes: pull requests don't compile macOS. Run the CI workflow by hand on the branch
  with "Also build the macOS app" before asking to merge.
- Never merge. KC merges, or says "merge" in the thread.

## High risk, say so in the PR
Signing and release (`.github/`, `scripts/*signing*`, `src-tauri/tauri.conf.json`), secrets
(`src-tauri/src/secrets.rs`, `handoff.rs`), the updater (`src/components/UpdateButton.tsx`), and write
actions (`src-tauri/src/actions/`, `src/actions/`). Never change the updater public key: installed
copies would stop updating.

## Rollback
Revert the pull request. Update versions only go up, so the revert ships as a newer build and every
Mac moves back. Never edit or delete `latest.json` on the `main-build` release by hand.
