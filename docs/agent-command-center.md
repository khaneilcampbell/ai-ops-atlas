# Agent Command Center — Phase 1

Open **Command** in Atlas navigation. Register a custom agent or use one of six configuration templates, save project assignments, create a simulation, expand its task row, and update its status. A building's inspector shows the same local assignments and outstanding simulated tasks and links to the workspace filtered to that project.

## Architecture and identity

`src/features/agent-command-center/model.ts` defines agent configuration, tasks, approvals, audit events and pure state transitions. `store.ts` is a small event-driven React external store. `CommandCenter.tsx` is lazy loaded through existing navigation. `ProjectAgents.tsx` connects existing project/building inspectors to the same store. No dependencies or polling were added.

Catalog agents retain their existing IDs. The workspace reads manifest profiles and saves local configuration overrides keyed by those IDs, rather than cloning agents into another registry. New names are checked against the combined directory. Templates are never instantiated automatically. The existing catalog includes deterministic automations as well as AI agents; both retain their identities in this directory. Existing Agents, Mission Control and telemetry continue to read authoritative manifests and observed runtime evidence. Local overrides are configuration for the Command Center and building inspector, not manifest edits.

Agent configuration contains name, role, mission, department, declared capabilities/integrations, local simulation status, project IDs and timestamps. Catalog-derived records have no invented creation timestamp or activity history. The status field is explicitly a manually maintained simulation status, not a claim about an existing runtime. Task events are tracked separately.

## Task lifecycle and approvals

All tasks have `executionMode: simulation`. New tasks start queued. Queued tasks can start, request approval or cancel; in-progress simulations can complete, fail, request approval or cancel. Failed tasks can requeue or cancel. Completed and cancelled tasks are terminal. History records each local transition with agent, task and optional project IDs.

Requesting approval creates a pending local record with risk and proposed action taken from the associated task. A pending task cannot start or complete. Approval returns it to queued and records **approved for future execution; no action executed**. Rejection cancels it. Cancelling a pending task closes its approval as rejected. Decisions cannot be replayed. Completing a simulation is a separate manual transition, labelled **Simulated execution completed**. Phase 1 cannot record actual execution.

## Persistence and boundaries

Configuration overrides, tasks, approvals and activity are stored together in `atlas:command-center:v1` in the existing browser/Tauri localStorage environment. Saves commit before notifying subscribers; storage failures are shown instead of silently losing changes. Unsupported or unreadable data disables writes to preserve stored records. This is per-device, per-origin storage, not server synchronization. Do not enter credentials or confidential task payloads. No secrets are needed.

The subsystem never imports execution services or calls external APIs. Local approval is independent of Atlas's existing GitHub rerun/merge approval system. Existing integrations retain their behavior. No production configuration or map geometry, lighting, camera or runtime telemetry is changed. Simulation status is textual in the building inspector and never drives verified activity lighting.

`AgentRuntimeAdapter` is a read-only future interface for status, capabilities and history. A later runtime needs its own authenticated boundary, authorization policy and verified execution records; local Phase 1 approval must not be treated as authorization to perform external actions automatically. Provider names are compatibility declarations only; no Claude, OpenAI, n8n, CrewAI, Cloudflare or MCP runtime is installed.

## Validation

Run `npm run typecheck`, `npm test`, `npm run lint` and `npm run build`. Focused tests cover legal/illegal transitions, immutable state updates, approval replay prevention, cancellation, persistence round trips, invalid data and shared catalog identities. Browser review confirms the workspace loads through existing navigation and exposes its directory and simulation controls.
