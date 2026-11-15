# Workflow execution

Workflow Intelligence → Live → **Start coordinating**. The orchestrator (`src/execution/`) moves an approved live run forward with fixed rules and no model calls. It extends the Task Center and Workflow Intelligence; it keeps no task state of its own.

## What it does

- **Start authorisation**: only a person can start a live run (`startLiveRun`) or let Atlas coordinate it (`Orchestrator.authorize`). Agents, workflows and Atlas are refused.
- **Rounds** (`Orchestrator.step`): run on every Task Center change, never on a timer. Each round releases steps whose dependencies completed, asks for approvals, completes approval steps once a person granted them, and dispatches runnable steps to an adapter within a concurrency limit (3 outside runs at once). Research steps whose dependencies are met go out together.
- **Handoffs** (`handoff.ts`): every step has a small versioned output schema. Unknown fields, text over 2,000 characters, control characters and non-https artifacts are refused; documents travel as artifact links. One deterministic repair (trim, "12" → 12, "x" → ["x"]) is tried; nothing missing is ever filled in. The next step receives a standard envelope: run id, task id, source and destination agent ids, input and output schema versions, upstream outputs, artifact refs, correlation id (the run id), idempotency key (task id + attempt), timestamp.
- **Invalid output**: recorded in the ledger, the attempt fails, one automatic retry when repeating is safe, then "Needs review".
- **Reports** (`Orchestrator.receive`): accepted only for the step's live attempt, only from the system that attempt went to, and each report id once. A replayed or forged report can't complete a step or skip an approval.
- **Durable state**: tasks (`atlas:tasks`), runs (`atlas:workflow-runs`) and the ledger (`atlas:workflow-exec`) are on this device, each written with compare-and-set. The dispatch key is saved before anything is sent and is never sent twice. After a restart, `recover()` fails an attempt that was never sent and holds one that may have been sent until a person checks the outside system ("It ran" / "It didn't run").
- **Timeouts**: a run past its timeout (6 h, GitHub 2 h) is checked with the outside system. It is never assumed failed or stopped. If its status can't be read it is held for a person.
- **Retries**: transient failures retry with backoff (1, 2, 4 … max 30 min) only when the adapter has no side effects or the receiving system honours the idempotency key. Otherwise a person retries from the Task Center.
- **Approvals**: enforced by the Task Center lifecycle on every write: per attempt, by a person, never by the assigned agent or whoever asked for the task. GitHub writes also go through the Mac app's dialog and Touch ID.
- **Decisions and waivers**: Khaneil records the viability decision (the branch not taken is cancelled). A person can waive an agent step that needs no approval; the next step's envelope marks it waived.
- **Model policy** (`policy.ts`): approvals, decisions and manual steps use no model; scoring and planning may use an advanced model, other agent steps a small one. Each step has a spend cap ($1 small, $3 advanced) checked against usage the provider reported. Research outputs validated in another run of the same workflow within 30 days are reused instead of re-run.
- **Reporting** (`report.ts`): run status, duration, steps, retries, approvals, handoffs, reported tokens, estimated and billed cost kept apart, artifacts. The business outcome is separate and only what someone recorded: "achieved" needs a metric with its source. A finished launch is not proof of sales.

## What can actually run today

| Step kind | Adapter | From Atlas |
| --- | --- | --- |
| n8n (Product Lab research, scoring, brief, plan; Approve and Publish) | `n8nAdapter` | **Unconfigured.** Atlas holds only a read-only n8n key. Needs an allow-listed webhook per workflow, a signing secret kept on the site, an input schema per workflow, and a callback that posts reports to Atlas. |
| GitHub (Manage agents allow-list) | `githubAdapter` | Started by a person in the Task Center (Mac app, Touch ID). Listed as waiting on you. |
| Manual, decisions, approvals | `manualAdapter` | A person, recorded in the Task Center or here. |
| Development, quality checks | none | **Unconfigured.** No coding agent or product test workflow exists. |

Until the n8n connection exists, research and planning steps show as unconfigured with the exact requirement, and a person can do them by hand, mark them done in the Task Center (recorded as an unverified handoff) or waive them.

## Limits

- State is device-only, like the Task Center. Approvals are enforced by the shared lifecycle code, not a server; a server-side `TaskRepository` (e.g. D1) is the next step for multi-device and server enforcement.
- Model usage appears only when a provider reports it with a run. None does yet.
- Tests use `simulatedAdapter`; nothing in the suite calls n8n, GitHub or a payment system.
