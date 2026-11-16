# Workflow Intelligence

Mission Control → **Workflow Intelligence** (view id `workflows`). It shows a goal's workflow as a graph, an inspector, a timeline and a per-building list. The page itself never runs work: execution is coordinated by the orchestrator (see `docs/workflow-execution.md`) and approvals and retries stay in the Task Center.

- **Model** (`src/workflows/types.ts`): `Goal`, `WorkflowDefinition` (versioned nodes and edges), `WorkflowRun` (a frozen snapshot of the definition plus node → Task Center task pointers), `ExecutionEvent`. Nodes name Agent Registry ids (`catalog/*.yaml`) and map building ids; names, buildings and environments are read from the registry, not copied.
- **Template** (`benjaireLaunch.ts`): the Benjaire AI product launch, nine stages. Development and quality checks have no agent or workflow in Atlas, so they are marked **unconfigured**. Marketplace publication points at the existing Approve and Publish n8n workflow, which only runs from Khaneil's approval form.
- **Simulation**: computed from the saved template, never stored, every event labelled simulated, no calls.
- **Live**: "Start a live run" creates one Task Center task per step (dependencies, owner, building, approval categories). Statuses and the timeline are read from those tasks on this device. Nothing is marked done by this page. Approvals are decided in the Task Center, where agents and workflows cannot approve.
- **Map**: selecting a step selects its building in a shared store (`selection.ts`) with a "Focus on the map" action. The 3D renderer is untouched; a building's inspector links back here.
- Runs are stored in `localStorage` key `atlas:workflow-runs`, device-only like tasks. n8n execution stays read-only (see `docs/task-center.md`).
