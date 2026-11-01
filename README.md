# AI Ops Atlas

A personal desktop command center for AI agents, projects and GitHub repositories. Repositories are neighborhoods, agents are the buildings around them, and badges show what is active, idle or needs attention.

Atlas is **read-only**. It reads project manifests and GitHub data, and its one built-in agent, the Repository Intelligence Agent, only reads repositories and asks Claude for an assessment. The two exceptions, both in the Mac app only, are **Re-run failed jobs** on a failed GitHub Actions run and **Merge pull request** on a pull request GitHub reports ready (every required check green, no changes requested, not a draft). Each is off by default, limited to repositories you tick, approved in a macOS dialog each time (merges also ask for Touch ID), uses its own write-scoped token (one per repository for merges), and is audited. See [docs/actions.md](docs/actions.md). Nothing else in the app can change a repository or start an external agent. **Fix with Claude** in Mission Control only opens a pre-filled GitHub issue in your browser; nothing is sent until you press Create there (see [ops/fix-with-claude](ops/fix-with-claude/README.md)).

## What it does

| Area | What you see |
|---|---|
| Overview | Agent and repository totals, items needing attention, recent commits, CI runs and agent history, and a card per project |
| Agents | The agent registry. **Directory**: every agent classified (AI agent, AI-assisted workflow, automation, CI/CD, integration, planned) with function, project, operational status, last verified run and risk; search, filter, sort and group. A six-tab inspector (Overview, Goals, Workflow, Operations, Governance, Documentation). **Portfolio**: counts by type, configured versus verified, missing documentation and items needing review. **Goals & performance**: KPI targets against observed values. See [docs/agent-registry.md](docs/agent-registry.md) |
| Repositories | Description, language, latest commit, health indicators (CI, last push, open issues, license, linked agents) and linked agents |
| Workspace map | An isometric map: each project is a district, its repository is the HQ in the middle and its agents are the houses around it. Pan, zoom, hover and click |
| Details | A side panel for any agent or repository with its description, links, status and activity history |
| Search | `⌘K` searches agents and repositories from anywhere |
| Live updates | Workflow runs, pushes and Repository Intelligence runs appear as they happen on the Mac and the website, from GitHub App webhooks collected by the site. The header's **Live** pill shows the latest. See [docs/live-updates.md](docs/live-updates.md) |
| Agent alerts | Unattended customer-facing agents raise an alert when they report a failure or go silent: a red header pill, Mission Control's Agent alerts list, optional Mac or browser notifications, and optional email from the site. Agents that are off on purpose show as Not running. See [docs/alerts.md](docs/alerts.md) |
| Repository intelligence | Pick a repository and the agent reads it from GitHub, asks Claude for a structured assessment and saves a report. Verified facts are kept apart from Claude's unverified recommendations. **Intel** shows the agent's configuration, every run with its trace, and token and cost totals. See [docs/repository-intelligence.md](docs/repository-intelligence.md) |
| Settings | Refresh interval, cache, map labels, an optional GitHub token, and the Anthropic key, budgets and schedule for the intelligence agent. Keys are stored in the macOS Keychain |

## Run it

Requirements: Node 20+, Rust stable, and Xcode Command Line Tools on macOS.

```bash
npm install
npm run tauri dev        # desktop app with hot reload
npm run tauri build      # builds AI Ops Atlas.app and a .dmg under src-tauri/target/release/bundle
npm run dev              # browser-only preview at http://localhost:1420 (public GitHub data, no Keychain)
npm test                 # validates the catalog and the health/attention rules
```

## Install and update

Download `AI-Ops-Atlas-macOS.zip` from the [latest release](https://github.com/khaneilcampbell/ai-ops-atlas/releases/latest), unzip it and move **AI Ops Atlas** into Applications. The app isn't signed by Apple, so open it the first time with right-click → Open. To update, download the newer release and replace the app; your token and settings stay. With the GitHub CLI: `gh release download -R khaneilcampbell/ai-ops-atlas -p '*.zip'`.

To publish a release: run `npm run version:set -- 0.3.0`, merge that change, then tag `v0.3.0` on `main` and push the tag. The Release workflow builds a universal (Apple silicon and Intel) app and attaches it.

## Contributing

`main` only takes pull requests that pass CI. Before pushing, run `npm run lint`, `npm test`, and in `src-tauri/`, `cargo fmt` and `cargo clippy --all-targets -- -D warnings`. Dependabot opens weekly update PRs, and CodeQL scans every PR. See [SECURITY.md](SECURITY.md) for how secrets are handled.

## Add a project or agent

Add or edit a YAML file in [`catalog/`](catalog/README.md). The format is documented there, and `npm test` fails on a broken manifest. There is one manifest for each of the 11 `khaneilcampbell` repositories, including:

- **Multi-Agent Commerce Pipeline**: the autonomous loop, the six CrewAI brand-crew agents, and the Canva, Shopify, SEO and health-report stages
- **AI-Assisted SOC Brute Force Detection Lab**: the Splunk detection search and the SOC case-note automation
- **khaneilcampbell.com**: the Claude site assistant, the site audit script and the security-check workflow
- **Benjaire.com**: the contact form Worker, the Benjaire Flow intake in n8n and Site CI
- **AI Career Application Optimization System**: the three Claude prompt stages and the career database validator

Repositories with no manifest still appear. The app lists every repository owned by the accounts in **Settings → Show every repository owned by** (default `khaneilcampbell`), and shows the rest under "Not in the catalog yet" on the list and the map. Private repositories need a token.

Statuses and last-run times in the manifests are a starting point. Correct them by hand until live sources arrive.

## GitHub access and secrets

- All GitHub calls are `GET` requests to `api.github.com/repos/...`, plus the repository lists at `/users/{owner}/repos` and `/user/repos`. The Rust side rejects any other path.
- The app keeps GitHub usage low:
  - Repository details come from the one repository list used to find new repositories, instead of one request per repository.
  - Commits and languages are fetched again only when a repository's last push changes. Workflow runs are checked on each refresh with a token, or every 3 hours without one, and always while a run is still in progress.
  - One run list per repository covers both CI and the workflows agents observe.
  - Requests are conditional (ETags). With a token, GitHub doesn't count unchanged 304 answers against the limit; without one, every request counts.
  - Repositories checked within the refresh interval are left alone, the timer pauses while the window is hidden, and refreshes stop when the hourly limit is spent until it resets.
  - **Settings → GitHub request budget** shows what the last refresh cost and how much of the hour's limit is left.
- Without a token the limit is 60 requests an hour. A first load of 11 repositories takes about 20 requests and a quiet refresh about 1.
- With a token, private repositories work and the limit rises. Use a fine-grained token with read-only **Contents**, **Metadata** and **Actions** access. It is saved in the macOS Keychain under `com.khaneilcampbell.ai-ops-atlas`, attached to requests by the Rust side, and never returned to the web view, shown in the interface or logged.
- Preferences and cached GitHub metadata are kept in the app's local storage on your Mac.

## Repository intelligence

The agent needs an Anthropic API key. Create one at [console.anthropic.com](https://console.anthropic.com/settings/keys) (ideally in its own workspace with a spend limit), then paste it in **Settings → Repository intelligence**. It is stored in the Keychain and only the Rust side reads it.

- Spending is capped per run (default $0.40) and per month (default $5.00). The worst case is checked before anything is sent.
- If nothing in a repository changed since the last analysis, the saved one is reused without calling Claude.
- Scheduled analysis (chosen days and time, preset to Mon, Wed and Fri at 08:00) is off until you turn it on and confirm it, and it only runs while the app is open.
- Costs shown are estimates from Anthropic's reported token counts. The Anthropic Console has the billed amounts.

The full guide, including what is sent to Anthropic, is in [docs/repository-intelligence.md](docs/repository-intelligence.md).

## Layout

```
catalog/            project and agent manifests (bundled at build time)
src/catalog/        manifest parsing and validation
src/github/         read-only GitHub client and snapshot types
src/lib/            health, attention and activity rules; search; time; storage
src/views/          Overview, Agents, Repositories, Map, Settings
src/components/     detail panel, filters, icons, status pills
src/registry/       agent registry: profiles, migration, telemetry, directory logic
src/intel/          intelligence agent bridge, types and formatting
src-tauri/          desktop shell: read-only GitHub proxy and Keychain storage
src-tauri/src/intel/  Repository Intelligence Agent: collection, prompt, Claude client, validation, budgets, jobs
```

## Roadmap

1. **Done:** read-only catalog, GitHub data, lists, details, search and the map.
2. **Now:** the Repository Intelligence Agent.
3. **Next:** a persistent background worker for scheduled analysis, and a CI failure triage agent (see the [agent roadmap](docs/repository-intelligence.md#10-roadmap-for-the-next-autonomous-agent)).
4. **Then:** live n8n visibility (workflow executions and failures), filling in `last_run` and history automatically.
5. **Later:** small project-specific adapters for CrewAI and local agents, and a local database if run history outgrows the cache.

## License

Copyright (c) 2026 Khaneil Campbell. All rights reserved. The code is public for viewing only, and no one may use, copy, modify or distribute it without written permission. See [LICENSE](LICENSE).
