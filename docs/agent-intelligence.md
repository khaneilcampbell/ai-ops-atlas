# Agent intelligence, memory and improvement

Phase 3 gives the Benjaire workflow agents four things Atlas already had the pieces for: memory they
may read, tools they may use, a model route per step, and a score for every finished step. Khaneil
rates the work and decides on every change. No new service, database or AI call was added.

Code: `src/intelligence/`. Screens: Agent Detail → **Intelligence**, Workflow Intelligence → a live
run's **Evidence and evaluation**, and a Task Center task's **Context used / Output quality / Human
feedback / Improvement suggestions**.

## Memory (`memory.ts`, `knowledge.ts`)

| Category | Who writes it | Lifetime |
| --- | --- | --- |
| Working | the agent, for its own project or workflow | 7 days by default, 30 at most |
| Project knowledge | Khaneil only | reviewed every 180 days, marked stale after |
| Operational | Khaneil, or an agent's proposal Khaneil verifies | reviewed every 90 days |
| Human-approved | Khaneil only (seeded policies live in the repository) | until retired |

Every record has an id, category, scope (one project or `global`, optionally one workflow and named
agents), a source reference, created/updated times, verification, sensitivity and an expiry or review
date. Reads are checked per agent: an agent reads only its own project, the workflows it is a step in,
and global records, and never above its catalog `dataSensitivity`. Restricted records are never shown
to agents. Retired, expired, suspicious (instruction-like) and disputed records are refused. Writes
that contain anything shaped like a secret are refused and audited. Only Khaneil verifies or retires.

The seeded knowledge (approval gates, no self-change, Publish never from Atlas, model use, the
Benjaire scorecard, research limits, handoff schemas, n8n read-only) is code, so it changes only
through a reviewed pull request, which is its version history and rollback.

Storage is this device's browser storage (`atlas:agent-intel`), the same as the Task Center, with
compare-and-set saves and caps on the audit log (1,000), contexts (300) and evaluations (1,000).

## Retrieval (`retrieval.ts`)

Deterministic: filter by access, then score term overlap with title and tags (×3) and body (×1),
weighted by category and verification, halved when stale. Pinned policies always come first. Results
are cut to a token budget (1,500 by default) and every item carries its source, verification and
category. What was left out is counted by reason. The block sent to an agent is labelled reference
data, not instructions. No vector database.

## Tools (`capabilities.ts`)

Twelve capabilities, each with an id, input and output schema, required permission, adapter, side
effect (none, read, write, external), timeout and retry. Each of the seven agents has a fixed grant
list. `authorize` refuses an ungranted tool, an unknown tool, or one that needs an approval Khaneil
hasn't given. `shop.publish` is marked never-from-Atlas. Agents can only be matched to tools that exist.

## Model routing (`routing.ts`)

Tier 0 is no AI, tier 1 a small model (Haiku), tier 2 an advanced model (Sonnet; Opus only for code).
The tier comes from the task type and complexity, is lowered or held for privacy (restricted data
gets no model) and budget (a step that would pass its cap drops a tier or is held), and never goes
above what the step policy allows. Tokens are recorded, and estimated cost stays separate from billed.

## Decisions (`decisions.ts`)

A recommendation is stored with its evidence (HTTPS links or memory ids), constraints, alternatives,
uncertainties, confidence, impact and required approvals. No reasoning or chain-of-thought field is
accepted. High impact, low confidence, no verified evidence, three or more uncertainties, or a
spending/publication/deployment category needs Khaneil's review.

## Evaluation (`evaluation.ts`)

When a step finishes Atlas scores it from what was recorded: completed, valid output (schema),
evidence, right tools, policy, first-try reliability, cost and latency. A policy breach caps the score
at 40. Results group by agent, workflow version, prompt version, model and task type. No model grades
another model. Khaneil's 1–5 rating is attached to the latest evaluation.

## Improvement cycle (`improvement.ts`)

Run → evaluation → feedback → suggestion → proposal → Khaneil's review → recorded version → rollback.
Suggestions come from fixed thresholds (repeated schema failures, thin evidence, over-tier models,
low ratings). Agents may propose prompt, knowledge-source, workflow and validation changes only;
anything touching permissions, security, credentials, approvals or deployments is refused unless
Khaneil writes it. Atlas never applies a change itself: Khaneil applies it where it lives (n8n or a
pull request) and records where, which becomes version n+1. Rolling back marks the version and says
to revert it in the same place.

## Benjaire workflow (`benjaire.ts`)

Each step of the Benjaire launch workflow gets a profile (task type, complexity). When the
orchestrator sends a step, its envelope carries an optional `context`: the retrieved items, the
granted tools, the route and the output schema. Validated research handoffs become unverified
working memory for 30 days, so later steps can reuse findings. Approval gates before development,
spending, publication and deployment stay as they were.

## Limits

- Device only: memory, ratings and proposals don't sync between the Mac and the web page.
- The n8n step runner ignores `context` until its workflow is updated by hand in n8n.
- Prompts aren't edited from Atlas; approved proposals are applied by hand and recorded.
- Nothing here has run against a real workflow run yet; tests use mocked runs.
