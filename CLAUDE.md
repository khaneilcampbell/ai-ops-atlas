# Working on Atlas

Atlas is a Tauri Mac app and the same React app as a private web page (Cloudflare Pages). Every merge
to `main` signs and publishes a Mac update that KC's installed app picks up within about 10 minutes,
and redeploys the web page. Treat every merge as a production release.

## Every change
- One small pull request per change, on its own branch. Fill in `.github/pull_request_template.md`.
- Add one changelog line in a new file `changelog.d/<your-branch-name>.md`:
  `- YYYY-MM-DD · What changed, in plain words (#PR)`. Don't edit the top of `CHANGELOG.md`: every
  pull request editing the same line made them conflict with each other. Khaneil reads these in
  the Update button, so write for Khaneil.
- Add or update tests for new logic. Before pushing, run `npm run lint`, `npm run typecheck`,
  `npm test`, and `cargo test --manifest-path src-tauri/Cargo.toml` when Rust changed.
- Anything on screen: `npm run visual` (see `docs/visual-testing.md`) and attach before/after
  screenshots at desktop and iPhone width. CI screenshot checks only run on a pull request with the
  `visual` label (and nightly on main): add the label when the map or layout changed.
- Rust or Tauri changes: pull requests don't compile macOS. Run the CI workflow by hand on the branch
  with "Also build the macOS app" before asking to merge.
- Never merge. KC merges, or says "merge" in the thread.

## Keep the dashboard tabs current
Khaneil's standing rule (2026-11-13): any change that adds, removes, renames or switches on or off
something in Atlas updates the data behind the tabs in the same pull request, so every tab shows it.
- Agents, automations, n8n workflows: the agent's entry in `catalog/*.yaml`. Its `status`, `trigger`,
  `last_run`, `history` and links must match what is live (published in n8n = `active`, draft =
  `paused` with "draft" in the trigger). Link every n8n workflow it runs, labelled with "n8n".
- Buildings and landmarks: `catalog/workspace/buildings.yaml` (names), `workspace.yaml` (module,
  agents), and the map inventory in `src/inventory/mapInventory.ts` for new map objects.
- Hosting, spend caps: `src/infra/hosts.ts`, `src/finance/caps.ts`, `catalog/workspace/finance.yaml`.
- A new agent gets a desk inside its building. It never resizes a district or moves buildings, so
  leave outside services out of its `registry.responsibilities.tools` unless Khaneil wants a new
  tool building there (a major tool that works with that building).
- Only record what is on `main` and what you checked; anything unproven stays "Not documented".
- `src/catalog/dashboardData.test.ts` guards this; the Workflow Automation Plant in the app lists
  any n8n workflow switched on but not in the catalog as "Not in Atlas yet".

## High risk, say so in the PR
Signing and release (`.github/`, `scripts/*signing*`, `src-tauri/tauri.conf.json`), secrets
(`src-tauri/src/secrets.rs`, `handoff.rs`), the updater (`src/components/UpdateButton.tsx`), and write
actions (`src-tauri/src/actions/`, `src/actions/`). Never change the updater public key: installed
copies would stop updating.

## Rollback
Revert the pull request. Update versions only go up, so the revert ships as a newer build and every
Mac moves back. Never edit or delete `latest.json` on the `main-build` release by hand.
