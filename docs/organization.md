# Infrastructure organization

Atlas organizes the catalog in three ways. Each value is either **declared** in a manifest or **inferred** by a fixed rule in `src/catalog/organization.ts`. Nothing is guessed by a model, and the inspector shows which one applies (hover the value for the reason).

## Districts

| District | Projects today |
|---|---|
| AI Operations | AI Ops Atlas |
| Business Operations | Benjaire.com, Benjaire Ops Dashboard, Multi-Agent Commerce Pipeline |
| AI Engineering | Project Intelligence Hub |
| Security & Infrastructure | SOC Brute Force Detection Lab, Service Desk Intelligence Dashboard |
| Career & Portfolio | khaneilcampbell.com, GitHub Profile, AI Career Application Optimization System |

Each manifest declares `project.district`. Without it, the rules look at the tags and at the most common registry category among the project's items (CI pipelines don't count): career or portfolio, then security or infrastructure, then business, and AI Engineering otherwise. AI Ops Atlas itself is always AI Operations. A test checks that the rules reproduce every declared district, so a new manifest without the field still lands in the right place.

On the map, **By district** is the default grouping (stored as `mapGroupBy2`). Districts stay on one landmass with walkways, roads and bridges between them, with a quiet name label at each district's back corner. The other groupings are unchanged.

## Agent tiers

- **Central Operations**: AI Ops Atlas items other than its own CI. They work across every repository (Repository Intelligence, Engineering Review, Re-run, Merge).
- **Department Coordinator**: an item that lists two or more items of its own project under `registry.responsibilities.dependencies` (today: the commerce pipeline orchestrator).
- **Specialized Agent**: everything else.

`registry.tier` overrides the rule. No agent is created or switched on by this.

## Automation categories

Continuous Integration, Security, Monitoring, Business, Intelligence and Maintenance. The rules apply in this order: CI/CD pipelines (security ones are Security), then the security category, CI/CD or release subcategories, the business category, health and monitoring subcategories, then backup, validation, code quality and documentation subcategories. AI items and data work count as Intelligence. Anything left takes its district's function. `registry.automation_category` overrides the rule.

## Standard record

`organize(catalog)` returns one `OrgRecord` per item: id, name, kind (AI agent or automation), classification, role, project, repository, district, tier, category, responsibilities, declared status, trigger, trigger type, source, and where runs can be observed (`github-actions` with a workflow file, `atlas-run-log`, or `none`). Future discovery adapters (n8n, local runners) should produce the same shape. Observed runs stay in the GitHub snapshot and run logs, and are joined in only where they are shown.

## Map views

The toolbar's view menu has three views (3D map only, stored as `mapLens`):

- **Infrastructure view** (default): no lines at rest. Selecting a building shows only its own connections, without fading the rest of the map. "Show connections" in the Connections menu still draws everything.
- **Agent network**: links between agents from registry dependencies (AI agents, n8n and cross-project dependencies), at every zoom.
- **Automation flow**: each repository to the automations whose source or workflow it hosts, plus n8n flows.

Every line still comes only from manifests and GitHub data (`src/lib/connections.ts`). The views only choose which ones to draw (`src/lib/lenses.ts`).

## Building panel

The Overview tab has an **Organization** section with the district, the declared status, AI agents by tier, automations by function, and the latest recorded activity (a GitHub commit, an Actions run or a manifest history entry, with its source). When nothing is recorded it says "Nothing recorded yet". The Agents tab lists AI agents with their tier and automations with their function. An agent's details show its district, role, tier and function.
