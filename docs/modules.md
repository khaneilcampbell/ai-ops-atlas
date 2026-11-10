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

Operational data (`operations.ts`) and the inspector card (`components/ModuleSection.tsx`) read
these layers. They never hard-code a building.

## Extension points

### Put a module in a catalog building
Add `module: <module-type-id>` under `project:` in its manifest. The id, name, district and map
position stay as they are. Unknown ids are reported as manifest issues and ignored.

### Put a module in a landmark the map draws itself
Add `{ id, name, moduleType }` to `LANDMARK_MODULES` in `workspace.ts`. The `id` is the map's
`service:<id>` selection key. Add an assertion to `modules.test.ts` that ties the id and name to
the map plan constant, so a rename on the map fails the test instead of drifting.

### Add a module type
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
