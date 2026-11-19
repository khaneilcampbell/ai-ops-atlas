# Task Center

The **Task Center** tab (sidebar, second item; on a phone under More) lists tasks, who owns them,
which building they belong to, and every run, approval and result. Code: `src/tasks/` (model,
rules, store, routing, adapters, intake) and `src/views/tasks/`.

## How it works

- **Lifecycle** (`src/tasks/lifecycle.ts`): fixed transitions, checked in one place. Queued →
  Running → Completed or Failed; Queued ⇄ Blocked (dependencies); Queued ⇄ Awaiting approval;
  Failed → Queued only through Retry, within the attempt limit. Each run is an attempt with an
  idempotency key (`<task id>:<attempt>`), and a second run can't start while one is live.
  No model is called for any of this.
- **Approvals**: tasks marked sensitive (deployments, repository changes, customer messages,
  money, destructive or infrastructure work) need a person's approval before every run. Atlas,
  workflows and agents can ask but can't approve, and an agent can't approve its own task.
- **Storage**: this device only (the Mac app's or the browser's local storage), behind the
  `TaskRepository` interface so a synced store can replace it. Writes are compare-and-set.
  The page says "Saved on this Mac only"; it never claims to sync.
- **Agents and buildings** come from the catalog. Retired agents can't take new tasks; old
  tasks keep their name.
- **Routing** (`src/tasks/routing.ts`) suggests an agent by its declared capabilities. It is a
  replaceable interface; permission checks run again when the task starts.
- **Automated intake** (off by default, "Create tasks from failed runs"): a failed n8n run of a
  catalog workflow, or a failed default-branch GitHub run of a catalog agent, becomes one task,
  never two (keyed by run id), at most 10 per pass.
- **Map**: each building's and agent's inspector shows its open, running, blocked and failed
  counts and opens the Task Center filtered to it. Nothing is drawn in the 3D scene.

## What can run from Atlas

| Workflow | From the Task Center |
| --- | --- |
| GitHub, agent on `src/manage/agents.json` | Runs on main from the **Mac app** with a Manage agents token, through the existing native dialog, Touch ID and audit log. Atlas then watches GitHub for the run (every minute, only while the window is visible) and records its id, link and result. |
| Other GitHub workflows | Read-only: recent runs are shown and linked. |
| n8n | Read-only: the site's n8n key is read-only. Recent runs are shown as context and never claimed as the task's own. |
| Manual | Khaneil starts it, then marks it completed or failed. |

Not set up yet, and needed before n8n work can start from Atlas: an allow-listed webhook per
workflow, a signing secret kept only on the site, an input schema per workflow, and a verified
callback that reports the execution id back. Syncing tasks between devices needs a server-side
store (D1 is the likely home). Cancelling a GitHub run from Atlas is not on the Mac app's
allow-list, so a stop is recorded as requested and becomes cancelled when GitHub confirms it.
