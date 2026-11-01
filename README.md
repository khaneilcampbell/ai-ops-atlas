# Atlas

Atlas is KC's command center for AI agents, projects and GitHub repositories, drawn as a 3D city.
Each project is a building, projects sit in districts, and each agent works inside the building of
the project it belongs to. Status dots, alerts and live activity show what is running, idle or
needs attention.

It runs as a Mac app (Tauri) and, from the same React code, as a private web page on Cloudflare
Pages that also works on iPhone. A copy installed before the rename keeps its file name (`AI Ops Atlas.app`) when it updates
itself, but shows Atlas in the menu bar, Dock and window; new builds are `Atlas.app`. The bundle
identifier, signing certificate, Keychain entries and update feed are unchanged.

Atlas mostly reads. Everything that can change something is in the Mac app only, off by default,
limited to an allow-list, approved in a macOS dialog with Touch ID, and written to an audit log.
See [docs/actions.md](docs/actions.md). **Fix with Claude** in Mission Control only opens a
pre-filled GitHub issue in your browser; nothing is sent until you press Create there.

## The three views

`⌘1`, `⌘2` and `⌘3` switch between them from anywhere, and `⌘K` searches everything.

| View | What you see |
| --- | --- |
| **Projects** (map) | The 3D city. Pan, zoom and turn with mouse, trackpad or touch, switch day and night, and click a building for its panel. **View** picks which links are drawn (Infrastructure, Agent network, Automation flow) and **Grouping** arranges buildings By district, By status, By tag or with no grouping |
| **Mission Control** | Prioritized work: approvals waiting for you, failing workflows, agent alerts, workflow runs per day, API usage and cost, the busiest repositories and recent activity |
| **Grid** | Every repository side by side with CI, last push, issues and linked agents |

The sidebar also has **Agents** (the registry, Portfolio, Goals and Manage agents),
**Automations**, **Repositories**, **Activity**, **Intel** (Repository Intelligence and the
Engineering review), **API Usage** and **Settings**.

## The city

The map is one landmass of districts joined by road bridges, with one road standard for every
street, a highway, a train with stations and commuters, cars, boats, planes and people.
Landmarks include Atlas HQ, Benjaire HQ, the GitHub tower, the Commerce Pipeline tower, the
Financial District (Circa, Experian, BMW and others, with Financial Park), the Atlas Marketplace
mall and gardens, the Benjaire Marketing Agency on the bay, Atlas Hills with the mansion and its
community, the Skyline shops, a stadium and Atlas Airport with its terminal, ground crew and
jets taking off.

**Enter building** in a building's panel opens its inside: a project's office with its agents at
work, or a dedicated interior for Atlas HQ, the Marketplace, the Marketing Agency, the Circa lobby
and the Skyline shops. If the 3D map ever fails to draw, the rest of the page stays and a
**Try again** button restarts it.

**Settings → Performance and battery** lowers the map's cost on battery, and **Settings → Map
navigation** sets how the trackpad moves the map.

## Agents

Agents are declared in [`catalog/`](catalog/README.md), one YAML file per project; `npm test`
fails on a broken manifest. Statuses come from real runs where Atlas can see them; otherwise
the manifest's value is shown as configured, not verified.

Agents that work on Atlas itself or its repositories:

| Agent | What it does | Docs |
| --- | --- | --- |
| Repository Intelligence | Reads one repository and asks Claude for an assessment, within per-run and monthly caps | [docs/repository-intelligence.md](docs/repository-intelligence.md) |
| Senior Engineering Reviewer | Reviews every repository at once and returns a scorecard and ranked fixes. Recommends only | [docs/engineering-review.md](docs/engineering-review.md) |
| GitHub Steward | Observes repository health from the Mac app | [docs/github-steward.md](docs/github-steward.md) |
| Merge Flow | Sorts every open pull request into a lane and names the next move. Recommends only | [ops/merge-flow](ops/merge-flow/README.md) |
| Opportunity Scout | Looks for revenue ideas in the agents KC already runs. Recommends only | [ops/opportunity-scout](ops/opportunity-scout/README.md) |
| Design Consistency | Keeps the look on `src/styles/tokens.css` and opens a fix pull request when it drifts | [ops/design-consistency](ops/design-consistency/README.md) |
| System improvements | Turns CI and source evidence into an improvement report after each main build | [docs/system-improvements.md](docs/system-improvements.md) |
| Fix with Claude | A Mission Control button opens a pre-filled `claude-fix` issue; a Claude Code scheduled task then opens one small pull request or explains why it stopped. Atlas holds no token for it | [ops/fix-with-claude](ops/fix-with-claude/README.md) |

The Mac app's write actions are **Re-run failed jobs**, **Merge pull request** (only when GitHub
reports it ready) and **Manage agents** (enable, disable or run an allow-listed agent). Each has
its own token. See [docs/actions.md](docs/actions.md) and
[docs/manage-agents.md](docs/manage-agents.md). Alerts for failing or silent agents are in
[docs/alerts.md](docs/alerts.md), and live updates from GitHub App webhooks in
[docs/live-updates.md](docs/live-updates.md).

## Mac, web and iPhone

- **Mac.** Every merge to `main` builds, signs and publishes a new version to the `main-build`
  release. The installed app checks every 10 minutes and shows **Update available** with the
  newest lines of [CHANGELOG.md](CHANGELOG.md). Secrets (GitHub tokens, the Anthropic key) live
  in a Touch ID vault in the macOS Keychain and are only read by the Rust side.
- **Web and iPhone.** `npm run build:web` builds the same app for Cloudflare Pages behind
  Cloudflare Access. It reads GitHub through a Pages Function that holds the token and only
  forwards allow-listed GET requests, and it stays read-only. Setup and the phone layout are in
  [docs/iphone.md](docs/iphone.md).

## Run and test

Requirements: Node 20+, Rust stable, and Xcode Command Line Tools on macOS.

```bash
npm install
npm run dev              # browser preview at http://localhost:1420 (no Keychain, no write actions)
npm run tauri dev        # Mac app with hot reload
npm run lint && npm run typecheck && npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run visual           # screenshot checks against baselines
npm run measure:perf     # map performance measurements
```

**Visual checks** render the map, interiors and Mission Control in headless Chrome with sample
data and a frozen clock, so every run draws the same frame. See
[docs/visual-testing.md](docs/visual-testing.md).

**Performance budget.** One desktop map frame may use at most 800 draw calls, 1.2 million
triangles, 80 shader programs and 8 MB of geometry, and leaving the map must free its WebGL
context. `.github/workflows/perf.yml` measures this on every pull request that touches the map
and warns above 90% of the budget. Limits are in `visual/perf.visual.ts`.

## Making a change

Every merge is a production release, so the rules are in [CLAUDE.md](CLAUDE.md): one small pull
request per change with the template filled in, one plain-words line at the top of
[CHANGELOG.md](CHANGELOG.md), tests for new logic, before and after screenshots at desktop and
iPhone width for anything on screen, and KC merges. To roll back, revert the pull request; the
revert ships as a newer build. See also [docs/runbooks/stop-and-rollback.md](docs/runbooks/stop-and-rollback.md)
and [SECURITY.md](SECURITY.md).

## Where things live

```
catalog/              project and agent manifests
src/views/            Projects map, Mission Control, Grid, Agents, Intel, Usage, Settings
src/views/map3d/      the 3D city: buildings, roads, traffic, airport, plans and their tests
src/views/office/     building interiors
src/components/       panels, header, update button, shared parts
src/lib/  src/registry/  src/catalog/   rules, agent registry, manifest parsing
src/styles/tokens.css the design tokens every stylesheet uses
src-tauri/            Mac shell: GitHub proxy, vault, write actions, intelligence agents, updater handoff
functions/  server/   Cloudflare Pages Functions for the web build (GitHub proxy, live feed, reports, usage)
ops/                  scripts and prompts for the GitHub Actions agents
visual/               Playwright visual and performance checks
docs/                 guides and runbooks
```

## License

Copyright (c) 2026 Khaneil Campbell. All rights reserved. The code is public for viewing only,
and no one may use, copy, modify or distribute it without written permission. See
[LICENSE](LICENSE).
