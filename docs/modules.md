# Atlas modules

Atlas buildings can house a standard **module**: a reusable piece of the product (Agent Operations
Center, Business Operations HQ and so on). The module says what the building does. The building
keeps its own name and place on the map. This page explains how the pieces fit together and how to
extend them.

## The four layers

| Layer | File | Holds | Business-specific? |
|---|---|---|---|
| Module types | `src/modules/catalog.ts` | 16 generic modules: capabilities, connectors, views, actions | No. A test fails if one names a business |
| Integration contracts | `src/modules/integrations.ts` | Every data source a module reads, and where its credentials live | No |
| Workspace | `src/modules/workspace.ts` (`WORKSPACE`) | The workspace's name, its landmark building names, its entitlements | Yes |
| Building instances | `catalog/*.yaml` (`project.module`) and `instances.ts` | Which building houses which module | Yes |
| Building names | `catalog/*.yaml` (`project.name`) and `catalog/workspace/buildings.yaml` (`names.ts`) | What each building is called and which organization it belongs to | Yes |

Operational data (`operations.ts`) and the inspector card (`components/ModuleSection.tsx`) read
these layers. They never hard-code a building.

## A building's name, module and organization are separate

Every building has a stable **id** (its map selection key, such as `project:ai-ops-atlas` or
`service:financial:banks`), a **display name** (what the plaque, inspector, interiors, navigation
and search show), the **module** it houses, and optionally the **organization** it belongs to. Only
the id is an identifier. Renaming a building never changes its id, position, geometry, data,
repositories, agents or integrations, and the earlier name keeps working in search.

## Extension points

### Rename a building
- A catalog building: set `name` in its manifest, keep the old name in `former_names`, and put who
  it belongs to in `organization`.
- A building the map draws itself (landmarks, Financial District towers, stations): add or edit its
  entry in `catalog/workspace/buildings.yaml`, keyed by its id:

  ```yaml
  "service:financial:banks":
    display_name: Financial Operations Tower
    organization: Bayvale Bank
    former_names: [Bayvale Bank]
  ```

No code changes. The map's own name constants (`AGENCY_NAME` and so on) stay, because interiors and
saved routes use them as keys. Physical signs on a building's facade keep the organization's brand.
Names up to about 30 characters fit a plaque without an ellipsis.


### Put a module in a catalog building
Add `module: <module-type-id>` under `project:` in its manifest. The id, name, district and map
position stay as they are. Unknown ids are reported as manifest issues and ignored.

### Put a module in a landmark the map draws itself
Add `{ id, name, moduleType }` to `LANDMARK_MODULES` in `workspace.ts`. The `id` is the map's
`service:<id>` selection key and `name` is the map's own name for it (its display name comes from
`buildings.yaml`). Pick the module that matches what the building is for; a building whose function
no module covers houses none rather than borrow an unrelated one. Add an assertion to `modules.test.ts` that ties the id and name to
the map plan constant, so a rename on the map fails the test instead of drifting.

### Add a module type
Every module type in this workspace has at least one building, and `modules.test.ts` checks it,
so a new type also needs a home: a project manifest's `module` field or a `LANDMARK_MODULES` entry.
Add its id to `MODULE_TYPE_IDS` (`types.ts`) and its definition to `catalog.ts`. A capability is
`available` only if it cites a file that does it today (the test checks that the file exists).
Everything else is `planned`. A module with no available capability has no views or actions.

### Add an integration
Add a contract to `integrations.ts`: what it provides, that it is read-only, where credentials are
held on the Mac app and on the hosted site, and the client file. A module can only name connectors
that have a contract. Credentials never go in the web view, browser storage, or client-exposed
environment variables. The desktop shell keeps them in the Keychain, and the site keeps them in its
server functions.

### Set up another workspace
Make a new `AtlasWorkspace` with its own `id`, `name`, `landmarks` and `entitlements`, plus its own
catalog manifests. Every instance function takes the workspace as an argument
(`workspaceBuildings(catalog, workspace)`), so the same module types appear under the other
workspace's building names.

### Live n8n runs
The Automation Plant reads KC's n8n Cloud instance through the site (`server/n8n.ts`): the page asks
`/api/n8n` behind Access, the Mac app asks `/api/hooks/n8n` with its website sync key. The site
holds the only copy of the n8n API key as the Pages secret `N8N_API_KEY` (create it in n8n under
Settings → n8n API with the **Read only** scope). `N8N_BASE_URL` optionally points at another
instance. Only GET requests are made, and only names, on/off and run status and times come back.
To tie a catalog automation to its n8n workflow, add a link labelled `n8n workflow` to
`https://<instance>/workflow/<id>`.

### Hosting and deploys
The Infrastructure Operations Hub lists where each piece of the workspace runs (`src/infra/hosts.ts`
`HOSTS`) and its newest production deploys. The websites come from the property registry
(`src/properties/registry.ts`), so their dashboards and this list share one poller. Atlas web and
the Mac app are added in `hosts.ts`, not to the registry, because the registry is the site checks'
server allowlist. Deploys are read from GitHub with the same read-only access as the rest of Atlas:
Cloudflare check runs, GitHub Pages deployments, and CI's "Publish signed main build" job on the
newest main commits (a skipped job is not counted as a deploy). No new credentials. A host with no
deploy seen shows as unknown, never as live. To add a host, add an entry with its repository and
deploy source.

Its **Incidents** list joins the websites' own incidents (the same ones their dashboards raise, and
dismissed ones stay hidden) with failed or stuck deploys of Atlas web and the Mac app
(`src/infra/incidents.ts`). The newest finished deploy decides, so an old failure followed by a
success is history. A check that couldn't run is never an incident.
### Security alerts
The Security Operations Center counts open GitHub security alerts for every repository in the
catalog, through the site (`server/security.ts`): the page asks `/api/security?repos=…` behind
Access, the Mac app asks `/api/hooks/security?repos=…` with its website sync key (Rust
`live_security`). The site reads Dependabot, code scanning and secret scanning alerts with its own
`GITHUB_TOKEN` secret, which needs read access to those three alert types (fine-grained token:
**Dependabot alerts**, **Code scanning alerts** and **Secret scanning alerts**, all Read-only). Only
the number of open alerts and their severities come back: no advisory text, file path, secret type
or location. Each feed reports one of four states: counted, switched off for the repository, not
readable with the token, or unavailable. A repository shows no open alerts only when all three
feeds were counted. Answers are cached for ten minutes (one minute when a read failed).

### Spend caps
The Financial Operations Tower compares this month's spend with each spend cap the workspace has
set (`src/finance/caps.ts` `SPEND_CAPS`). The Atlas agents' budget is read from Atlas's own settings
and is exact. A provider cap (such as an Anthropic organization or workspace limit) is set on the
provider's page, so Atlas lists its amount and counts the priced, pay-per-use calls it has logged
for that provider this calendar month (UTC). That is a lower bound, and the row links to the page
with the full figure. A cap whose calls Atlas can't see shows "Spend not visible to Atlas" instead
of a number. Subscription and local-log usage isn't billed per call, so it doesn't count. When a
cap changes on the provider's page, change its `limitUsd` here.

### Publishing pipeline
The Commerce & Product Marketplace lists every agent of the projects whose catalog file sets
`module: commerce-product-marketplace` (today the Commerce Operations Center), worst first
(`src/commerce/pipeline.ts` `pipelineStages`). An agent with an `alerts` block follows the alert
rules, so a stage whose manifest says `not_running` shows "Not running" with that reason, never
"Failed". Other agents show their newest finished run on the default branch. A stage with no run
seen, or whose live feed isn't reaching this device, shows "Unknown", never "Healthy". Read only.

## Entitlements are not security
`entitlements` decides which modules the page shows as switched on. A module the workspace isn't
entitled to keeps its building and name, but its card says "Not included in this workspace" and
offers no views. This is a display boundary only. Any protected action (today, re-running failed
jobs and merging) is authorized where it runs: in the Rust shell (`src-tauri/src/actions/`) or in
the site's server functions, with human approval. Never treat a client-side entitlement as
permission to act.

## Health and data honesty
Health comes only from observed signals, currently GitHub CI across a building's repositories. A
repository that hasn't been checked counts as unknown, never as healthy. Cards say when data is
loading, unavailable, or last known. Landmarks without data of their own show nothing rather than
borrow another building's.
