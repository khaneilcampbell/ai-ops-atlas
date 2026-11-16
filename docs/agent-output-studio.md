# Agent Output Studio

A full-width section in Workflow Intelligence, directly under the Execution canvas and inspector.
It shows what every step of a workflow produced, as cards, and shares the canvas's one node
selection (`src/workflows/selection.ts`): picking a step highlights and scrolls to its outputs,
picking an output selects its step on the canvas and in the inspector.

## Where outputs come from

| Mode | Source | Label |
| --- | --- | --- |
| Live | The run's Task Center tasks (attempts, approvals, artifacts, reported usage), the execution ledger's handoffs, agent intelligence (context, evaluation, human rating). `src/outputs/live.ts`. | Verified or Unverified |
| Simulation | Fixed illustrative samples for the Benjaire launch template, revealed step by step. `src/outputs/simulation.ts`. | Simulated |

- **Verified** only for a complete output: a handoff that passed its step's schema on a finished
  task, an approval a person recorded, a run link the executor recorded, or a finished task's
  attempt log. Partial, person-entered, waived and in-progress outputs are Unverified.
- Live and simulated outputs carry different run ids (`simulation:<definition>`), and
  `scopeOutputs` keeps only the active mode's run, so they never mix.
- Nothing is stored. Outputs are rebuilt from the records when they change (existing
  subscriptions, no new polling); ids are deterministic, so a repeated execution event never adds
  a card. Earlier attempts are hidden unless "Earlier attempts" is ticked.

## Output types

text, markdown, table, chart, json, document, code, image, link, error. Every output is checked
by `outputProblems` before drawing. Text is redacted for credentials. Markdown is a small safe
subset drawn as React text (no HTML, no scripts). Charts are drawn only from finite numbers in the
record (`parseScores` needs every ranked item to carry a score). Links and images must be https
without credentials; images must be PNG, JPEG, WebP or GIF; links open only for verified outputs.
Tables show 100 rows, then "Show all"; the list shows 12 cards a page; details render only when
expanded.

## Workflow report

"Workflow report" assembles the outputs on screen into goal, agents, completed stages, findings,
recommendation, evidence, decisions, deliverables, failures and next actions, without a model.
Every line keeps its own verification label.

## Access and limits

- Atlas has one owner. There are no organizations or tenants, so there is no tenant isolation to
  enforce. Live outputs are read from this device's own stores; the web site sits behind
  Cloudflare Access with `ALLOWED_EMAILS` checked server-side on every `/api` route.
- No artifact is served by Atlas: artifacts are https links to the system that holds them
  (Google Docs, GitHub, n8n), which checks its own access. An output or run id from elsewhere is
  refused by `scopeOutputs`; having an id grants nothing.
- Opening an artifact is not audit-logged yet.
