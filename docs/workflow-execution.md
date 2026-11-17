# Workflow execution

Workflow Intelligence → Live → **Start coordinating**. The orchestrator (`src/execution/`) moves an approved live run forward with fixed rules and no model calls. It extends the Task Center and Workflow Intelligence; it keeps no task state of its own.

## What it does

- **Start authorisation**: only a person can start a live run (`startLiveRun`) or let Atlas coordinate it (`Orchestrator.authorize`). Agents, workflows and Atlas are refused.
- **Rounds** (`Orchestrator.step`): run on every Task Center change, never on a timer. Each round releases steps whose dependencies completed, asks for approvals, completes approval steps once a person granted them, and dispatches runnable steps to an adapter within a concurrency limit (3 outside runs at once). Research steps whose dependencies are met go out together.
- **Handoffs** (`handoff.ts`): every step has a small versioned output schema. Unknown fields, text over 2,000 characters, control characters and non-https artifacts are refused; documents travel as artifact links. One deterministic repair (trim, "12" → 12, "x" → ["x"]) is tried; nothing missing is ever filled in. The next step receives a standard envelope: run id, task id, source and destination agent ids, input and output schema versions, upstream outputs, artifact refs, correlation id (the run id), idempotency key (task id + attempt), timestamp.
- **Invalid output**: recorded in the ledger, the attempt fails, one automatic retry when repeating is safe, then "Needs review".
- **Reports** (`Orchestrator.receive`): accepted only for the step's live attempt, only from the system that attempt went to, and each report id once. A replayed or forged report can't complete a step or skip an approval.
- **Durable state**: tasks (`atlas:tasks`), runs (`atlas:workflow-runs`) and the ledger (`atlas:workflow-exec`) are on this device, each written with compare-and-set. The dispatch key is saved before anything is sent and is never sent twice. After a restart, `recover()` fails an attempt that was never sent and holds one that may have been sent. Each round then asks the outside system about held attempts when it can answer: for n8n bridge steps the site's send record and reports settle it (no record means it never went and is sent again once; a report completes or fails it). Only what the site can't tell stays with a person ("It ran" / "It didn't run").
- **Timeouts**: a run past its timeout (n8n bridge steps 20 min, GitHub 2 h, others 6 h) is checked with the outside system. The Run panel runs a round every minute while a step is out, so a missing report is noticed even when nothing else changes. It is never assumed failed or stopped. If its status can't be read it is held for a person.
- **Retries**: transient failures retry with backoff (1, 2, 4 … max 30 min) only when the adapter has no side effects or the receiving system honours the idempotency key. Otherwise a person retries from the Task Center.
- **Approvals**: enforced by the Task Center lifecycle on every write: per attempt, by a person, never by the assigned agent or whoever asked for the task. GitHub writes also go through the Mac app's dialog and Touch ID.
- **Decisions and waivers**: Khaneil records the viability decision (the branch not taken is cancelled). A person can waive an agent step that needs no approval; the next step's envelope marks it waived.
- **Model policy** (`policy.ts`): approvals, decisions and manual steps use no model; scoring and planning may use an advanced model, other agent steps a small one. Each step has a spend cap ($1 small, $3 advanced) checked against usage the provider reported. Research outputs validated in another run of the same workflow within 30 days are reused instead of re-run.
- **Reporting** (`report.ts`): run status, duration, steps, retries, approvals, handoffs, reported tokens, estimated and billed cost kept apart, artifacts. The business outcome is separate and only what someone recorded: "achieved" needs a metric with its source. A finished launch is not proof of sales.

## What can actually run today

| Step kind | Adapter | From Atlas |
| --- | --- | --- |
| n8n research and planning (market, customer and competitor research, scoring, brief, plan) | `bridgeAdapter` | **On since 2026-11-15.** Sent through the site to one restricted n8n step runner workflow (see below). Shows as unconfigured if either bridge secret is removed from the site. |
| n8n Approve and Publish | `n8nAdapter` | **Never started from Atlas.** Stays the existing Approve and Publish flow in n8n; the site refuses these steps even when called directly. |
| GitHub (Manage agents allow-list) | `githubAdapter` | Started by a person in the Task Center (Mac app, Touch ID). Listed as waiting on you. |
| Manual, decisions, approvals | `manualAdapter` | A person, recorded in the Task Center or here. |
| Development, quality checks | none | **Unconfigured.** No coding agent or product test workflow exists. |

Until the bridge is switched on, research and planning steps show as unconfigured with the exact requirement, and a person can do them by hand, mark them done in the Task Center (recorded as an unverified handoff) or waive them.

## The n8n bridge

Atlas can start six steps (`BRIDGE_STEPS` in `src/execution/n8nBridge.ts`) in one n8n workflow, "Atlas · Step Runner", at webhook path `atlas-step-runner`. That workflow has no email, Notion, shop, payment or publish tools: it runs one model call with the step's prompt and posts a structured report back. The read-only n8n API key is not used or widened.

```
page (Access) ── POST /api/n8n/steps ──┐
Mac app (sync key) ── POST /api/hooks/n8n-steps ──┤ site: allow-list, record key, daily cap
                                                  └── POST n8n /webhook/atlas-step-runner (N8N_BRIDGE_TOKEN)
n8n step runner ── POST /api/hooks/n8n-report (N8N_BRIDGE_CALLBACK_TOKEN) ── site D1
page / Mac app ── GET same paths ?since= ── picked up every minute while a step runs ── orchestrator
```

Safeguards:
- Two secrets, one per direction, each 32+ characters, kept only as Cloudflare Pages secrets and n8n credentials. The callback key can only add reports, and only for a step the site sent, under the same run and attempt.
- Each send is recorded by idempotency key before it goes out and is never sent twice; an unclear answer is "unknown" and is reconciled by a person, never retried blindly. At most 20 sends a day.
- Report ids are stored once; the report's source is always set by the site, so a report can't claim to be a person or an approval. Outputs are re-checked against the step's schema by the orchestrator.
- Requests are authenticated by bearer secret over HTTPS with idempotency and report-id dedupe. There is no timestamp signature; a replayed report changes nothing because its id is already stored.
- Run data (envelopes and reports) lives only in the private D1 database `LIVE` and is deleted after 30 days. Nothing goes to GitHub; the repository holds the code and this contract only.

To switch it on (Khaneil):
1. Save `N8N_BRIDGE_TOKEN` and `N8N_BRIDGE_CALLBACK_TOKEN` (two different random values, 32+ characters) as Pages secrets.
2. Put the same values in the step runner's two n8n credentials (webhook header auth, and the report request's header).
3. Publish the step runner in n8n. Done 2026-11-15; its catalog entry is `active`.

## Reliability test

`src/execution/reliability.test.ts` runs the whole Benjaire launch workflow (goal, Task Center, the six step runner steps, Khaneil's decision and three approvals, a Stripe-measured outcome) on the real orchestrator, task lifecycle, ledger and site bridge handlers with a real SQLite database. Only n8n is a stand-in, with the published step runner's checks and report shape, and it can be told to fail. "Restart" rebuilds everything from storage, as quitting the Mac app does. Each scenario checks that every step ran in n8n once, at most one result was recorded per step, and the site called nothing but the step runner webhook.

| Area | Scenario | Result |
| --- | --- | --- |
| Interrupted | Quit while steps are out with n8n | Pass |
| Interrupted | Quit after Atlas recorded a send, before the site got it | Pass after fix (was held for a person forever) |
| Interrupted | Quit after the site sent it to n8n | Pass after fix (was held for a person forever) |
| Interrupted | n8n webhook times out after the step started | Pass after fix (step completed but its hold stayed) |
| Interrupted | Model call fails mid-run | Pass (one retry after backoff) |
| Interrupted | n8n answers 500 | Pass after fix (reason now shown) |
| Interrupted | n8n dies after accepting and never reports | Pass after fix (was "running" for 6 h, and only noticed if something else changed) |
| State | Report delivered twice | Pass |
| State | Report never reaches the site | Pass after fix (held at 20 min instead of running for hours) |
| State | Report picked up but not saved on the device | Pass after fix (was lost; now found again from the site) |
| State | Empty answer or not JSON | Pass (never counted as done) |
| State | Late or forged report for a finished step | Pass |
| State | Two windows send the same step at once | Pass after fix (the site sent it to n8n three times) |
| Authorisation | Approval steps without Khaneil; agents, n8n or Atlas approving | Pass |
| Authorisation | Publish, approvals, development or intake sent to n8n | Pass (site refuses) |
| Authorisation | n8n's report key used for another step, run or approval | Pass |
| Authorisation | Cancelled run receives reports | Pass (nothing more sent) |
| Full run | Goal to measured outcome, once | Pass |

## Limits

- State is device-only, like the Task Center. Approvals are enforced by the shared lifecycle code, not a server; a server-side `TaskRepository` (e.g. D1) is the next step for multi-device and server enforcement.
- Model usage appears only when a provider reports it with a run. None does yet.
- Tests use `simulatedAdapter`; nothing in the suite calls n8n, GitHub or a payment system.
