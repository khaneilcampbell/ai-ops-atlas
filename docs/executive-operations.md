# Executive goals (Phase 8)

Mission Control > **Executive goals** lets Khaneil hand Atlas an objective and follow it to an outcome
through agents that already exist. It is a thin layer over the systems Atlas already has; it adds no
engine, agent, storage service or dependency.

| Need | Reused system |
| --- | --- |
| Coordinator | **Agent Operations Lead** (`agent-operations-lead`, already granted `tasks.delegate`) |
| Plan format | Workflow Intelligence `WorkflowDefinition` (nodes = registry agents, edges = dependencies) |
| Delegation | `startLiveRun`: one Task Center task per step with agent, dependencies and approval gates |
| Execution | The existing orchestrator and adapters (n8n Step Runner, GitHub with Touch ID, manual) |
| Approvals | Task Center approvals: per run, person only, never the assigned agent |
| Deliverables | Agent Output Studio (`liveOutputs`) for each goal's runs |
| Context | Phase 3 memory `retrieve`, scoped to the goal's project and plan, 800-token budget |
| Model budget | Execution policy step caps (`stepPolicy`) plus the goal's own budget, from reported usage |
| Notifications | The existing dismissed-alert keys, so a dismissed blocker stays quiet |

Code: `src/executive/` (types, templates, plan, autonomy, coordinator, signals, briefing, context,
store, tests) and `src/views/executive/ExecutiveGoals.tsx`. Workflow Intelligence lists every executive
goal with a plan, so Goal → Workflow → Task → Agent → Output works with the screens that exist.

## How a goal runs

1. **Intake.** Objective, project or business, priority, optional deadline, success criteria,
   constraints, optional budget, required approvals. Deadlines and budgets are never invented.
   Editing before the plan starts is allowed; editing an approved plan sends it back for review.
2. **Plan.** Fixed keyword templates (no model): Benjaire product research (reuses the existing
   Benjaire workflow unchanged), repository health, unfinished Atlas work, failed automation,
   business priorities, operational briefing, implementation plan. A goal no template matches gets no
   plan; Atlas shows what a model-drafted plan would cost (model router) and leaves the call to Khaneil.
3. **Validate.** Graph structure, completion criteria per step, every agent registered, not paused or
   retired, building in Atlas, allowed by the workspace. Unavailable agents block approval.
4. **Approve.** Khaneil only.
5. **Delegate.** Khaneil starts it; Atlas re-validates, checks the autonomy level and budget, and
   creates the tasks. Nothing executes until a step is started from the Task Center or the Run panel.
6. **Track.** Progress, agents and next milestone are read from the tasks. When every step finishes
   the goal moves to "awaiting your review"; only Khaneil marks the outcome achieved or not, with a note.

## Autonomy levels

Default **Level 1 · Recommend** (owner setting; stored data with an unknown level falls back to 1).

| Level | Allows |
| --- | --- |
| 0 Observe | Read and summarise only. No plans, no tasks. |
| 1 Recommend | Plans and recommendations. Khaneil starts everything. |
| 2 Supervised | Low-risk steps inside Atlas of an approved plan may start without him. |
| 3 Policy-bounded | Allowlisted read-only routines within daily limits (`ROUTINES` in `autonomy.ts`). |

Every level: sensitive categories (production deploy, repository change, customer message, financial,
destructive, infrastructure) need Khaneil's approval for that run; production changes are never started
by a level; unknown action kinds are refused; only a person changes a level. Levels 2 and 3 are
enforced by `authorizeAction` but nothing in the app starts steps on its own yet: there is no scheduler,
by design (no continuous loops).

## Blockers and briefings

Deterministic, computed when Mission Control renders, no timers or model calls: past deadline (only
when one was set), failed steps, steps without a task, paused or retired agents, pending approvals,
budget used or at 80%, no progress for 7 days, unconfigured steps. One entry per key.

Briefings (right now, daily, weekly, project) aggregate goals, tasks, runs and reported model usage.
Each section says "None" when empty. No AI synthesis is generated; "Copy as text" gives a plain version.

## Storage and security

Device-only `localStorage` key `atlas:executive` (like the Task Center), compare-and-set on each
goal, bounded audit log (ids and short text only), credential-looking text redacted before saving.
Access is the existing owner protection (Mac app; Cloudflare Access on the web). Retrieved memory is
data with its source and never changes approvals or policy.
