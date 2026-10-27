# AI Ops Atlas

A personal desktop command center for AI agents, projects and GitHub repositories. Repositories are neighborhoods, agents are the buildings around them, and badges show what is active, idle or needs attention.

This first release is a **read-only catalog**. It reads project manifests and public GitHub data. Nothing in the app can start an agent or change a repository.

## What it does

| Area | What you see |
|---|---|
| Overview | Agent and repository totals, items needing attention, recent commits, CI runs and agent history, and a card per project |
| Agents | Every agent with its purpose, project, framework, status and last run; filter by project, framework, status or language |
| Repositories | Description, language, latest commit, health indicators (CI, last push, open issues, license, linked agents) and linked agents |
| Workspace map | An isometric map: each project is a district, its repository is the HQ in the middle and its agents are the houses around it. Pan, zoom, hover and click |
| Details | A side panel for any agent or repository with its description, links, status and activity history |
| Search | `⌘K` searches agents and repositories from anywhere |
| Settings | Refresh interval, cache, map labels, and an optional GitHub token stored in the macOS Keychain |

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
- **AI-Assisted Portfolio Website**: the Claude site assistant, the site audit script and the security-check workflow
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

## Layout

```
catalog/            project and agent manifests (bundled at build time)
src/catalog/        manifest parsing and validation
src/github/         read-only GitHub client and snapshot types
src/lib/            health, attention and activity rules; search; time; storage
src/views/          Overview, Agents, Repositories, Map, Settings
src/components/     detail panel, filters, icons, status pills
src-tauri/          desktop shell: read-only GitHub proxy and Keychain token storage
```

## Roadmap

1. **Now:** read-only catalog, GitHub data, lists, details, search and the map.
2. **Next:** live n8n visibility (workflow executions and failures), filling in `last_run` and history automatically.
3. **Later:** small project-specific adapters for CrewAI and local agents, and a local database if run history outgrows the cache.
