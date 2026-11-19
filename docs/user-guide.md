# Atlas user guide

Atlas is Khaneil's private, single-owner AI command center: one place to oversee businesses (Benjaire), projects, repositories, AI agents, n8n workflows, infrastructure and personal work. It is not a public SaaS product: there is no account registration, no organizations or invitations, and no subscription plans. It shows them as buildings on a city map, tracks their work in the Task Center, and runs reviewed workflows with your approval at every risky step.

This guide is task-first. For how each part works inside, see the linked docs.

## Install

| Version | Needs | Notes |
| --- | --- | --- |
| Mac app | macOS 12 or later | Keys are kept in the macOS Keychain and unlocked with Touch ID once per launch. Updates install from the Update button in the header. |
| Hosted web | A Cloudflare Pages site with Cloudflare Access | Read-only for write actions; keys are Cloudflare secrets. See [packaging.md](packaging.md). |
| Local preview | Node 22, `npm ci && npm run dev` | Public GitHub data only. For development. |

The Mac app is signed with Atlas's own certificate, not an Apple Developer ID, and isn't notarized, so the first open needs **System Settings > Privacy & Security > Open Anyway**. See [packaging.md](packaging.md).

## First run

There is no setup popup: Atlas has one owner. On a device with no workspace yet, Atlas quietly creates the Benjaire workspace with every cataloged project and agent, every tool, the executable workflow templates and the time zone from Settings. Change any of it later in **Workspace**. A device that already has a workspace keeps it as it is.

## Mission Control

Mission Control opens with a **Command brief**: eight plain answers (what agents are doing, which workflows are running, what needs you, which projects moved, which systems have problems, what agents produced, what is costing money, which business goals need action). Each one opens the screen with the detail. It reads only records already in Atlas and adds no polling or model calls.

## Workspace

Open **Workspace** in the sidebar (on a phone: More > Workspace).

- **Setup**: the readiness check, workspace details, **Businesses and projects** (every building grouped by category, then business, with its repositories, agents, workflows, open tasks and outputs; you can move a building to another category without moving it on the map).
- **Tools**: your private tool library. Status, last check, the projects, agents and workflows that use each tool, setup steps, permissions, diagnostics and disconnect.
- **Agents**: the agents in this workspace and the agent library.
- **Workflows**: the workflow template library.
- **Owner controls**: general settings links, workflow limits, usage, system information, export and import.

A workspace holds settings only. Tasks, workflow runs, memory and business records stay in their own stores on the device. More than one workspace can exist; the picker at the top switches the active one. Every workspace on a device sees the same tasks, runs, memory and business records: workspaces are setups for one owner, not separate customer accounts. Atlas has no customer sign-in or tenant isolation yet, so don't use a workspace to run work for another business.

## Integrations

| Integration | Mac app | Web | How it's checked |
| --- | --- | --- | --- |
| GitHub | Keychain token (set it here) | `GITHUB_TOKEN` site secret | Last repository sync / site GitHub check |
| n8n | Via the hosted site | `N8N_API_KEY`, Step Runner keys | Site n8n and Step Runner checks |
| Cloudflare | Via the hosted site | Access, D1, `CLOUDFLARE_API_TOKEN` | Site Access and database checks |
| Anthropic (Claude) | Keychain key (set it here) | Not available | Latest Repository Intelligence run |
| Stripe (via n8n) | Via the hosted site | Step Runner keys + n8n sales feed | When you sync sales in Business > Finance |
| Email alerts (Resend) | Via the hosted site | `RESEND_API_KEY`, `ALERT_EMAIL_TO` | Set only; no test email is sent |
| Atlas site link | Settings > Website sync | Not needed | The site answering with the sync key |

Statuses: **Connected** (a real request proved it; "Last successful check" says when), **Key set · not verified** (the key or link is set but no check has reached the service yet; workflows may still use it), **Degraded** (a check failed or partly failed), **Disconnected** (the service didn't answer), **Configuration Required** (a key or link is missing), **Unsupported** (not on this platform, or no adapter: OpenAI, Gemini, Slack, direct Shopify). Health is read once and reused for five minutes; **Check again** forces a fresh read.

Disconnect: on the Mac, **Disconnect** removes a Keychain key. Site keys are removed in the Cloudflare dashboard (Workers & Pages > ai-ops-atlas > Settings > Variables and Secrets) and take effect on the next deploy. Atlas never reads or shows a key.

## Agents

Open an agent to see its purpose, building, capabilities, granted tools, permissions, memory scope, required integrations, workflows and KPIs. In a workspace you can change three things: **on/off**, the **model limit** (Tier 0 no AI, Tier 1 lightweight, Tier 2 advanced) and a **note**, or apply a preset (Standard, Economy, No AI, Paused). Every change is recorded in **Configuration history**.

Tools, permissions, memory scope and building are protected. They change only through a reviewed pull request to the Agent Registry (`catalog/*.yaml`, `src/intelligence/capabilities.ts`).

A turned-off agent, or a step that needs a higher model tier than its limit, stops Workflow Intelligence from starting a run that uses it, with the reason shown. Turning an agent off while a run is going holds that agent's next steps (they show the reason and are never sent) until it is turned back on, and the Task Center won't start new tasks for it. Work already sent finishes and stays in history.

The **Agent library** lists every registered agent not yet in the workspace. It is private, not a marketplace. **Add** only lets the workspace use it: nothing is downloaded and no outside code runs.

## Workflows

In **Templates**, open a template to see its inputs, outputs, required agents and integrations, approvals and version.

- **Preview** lists every step.
- **Simulate** plays the whole run on the page. It's never saved, makes no tasks and calls nothing outside Atlas.
- **Run in Workflow Intelligence** opens the live view, where you confirm and start. Only a person can start, authorise or cancel a run. See [workflow-intelligence.md](workflow-intelligence.md) and [workflow-execution.md](workflow-execution.md).

Follow live work in the **Task Center** ([task-center.md](task-center.md)) and results and diagnostics in **Mission Control > Production health**.

## Security and approvals

- Keys live in the macOS Keychain or Cloudflare secrets, never in the page, local storage, exports or logs. Any workspace text, note or import that looks like a key is refused.
- Repository changes, deploys, spending and customer messages always wait for a person's approval. Agents and automations can't change workspace or agent settings.
- Imported workspace files are untrusted: unknown agents, integrations and templates are dropped, protected settings are refused, the import becomes a new inactive workspace, and nothing runs.
- The hosted site checks every request with Cloudflare Access and an owner allowlist. See [production-readiness.md](production-readiness.md).

## Usage and costs

Workspace > Administration > Usage counts tasks, workflow runs and reported spend (billed, and estimated where the provider hasn't billed yet). **API Usage** in the sidebar has the full breakdown ([api-usage.md](api-usage.md)).

## Backup and export

- **Workspace settings**: Administration > Configuration export downloads a JSON file without keys, history or records. Import adds it as a new workspace.
- **Everything on this device** (tasks, runs, memory, business records, settings, workspaces): Settings > Data > Backup. Restoring can be undone once.

## Troubleshooting

| You see | Do this |
| --- | --- |
| An integration says Configuration Required | Open its card, follow Setup, then **Check again**. |
| Mac app shows site integrations as "isn't linked" | Settings > Website sync: enter the site address and make a key, then set the site's `USAGE_SYNC_TOKEN`. |
| GitHub is Degraded | Open the card's diagnostics; usually an expired token or rate limit. Replace the token. |
| "Run can't start" in Workflow Intelligence | The message names the agent. Turn it on or raise its model limit in Workspace > Agents. |
| A template says Design only | It has no workflow definition yet; the card names what covers that work today. |
| Storage is full | Settings > Data > Clear and refetch removes the GitHub cache; then back up. |
