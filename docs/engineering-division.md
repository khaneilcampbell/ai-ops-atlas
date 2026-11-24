# Atlas Engineering Division (Phase 2)

Two agents under Atlas Executive turn a red CI check on `main` into a pull request Khaneil can review:

- **Atlas Engineering** (`atlas-engineer`, Autonomous Software Engineer, level 3 conditional autonomy).
  Claude Code edits a fresh checkout of the failing commit in a throwaway GitHub Actions job.
- **Atlas Quality Assurance** (`atlas-qa`, Independent Quality Verification). Checks every change from
  GitHub's own records before a pull request exists. No model.

Nothing in the division can merge, deploy, change credentials or approve its own work. Khaneil merges.

## Audit (2026-11-23)

| Part | State before Phase 2 |
| --- | --- |
| Executive engine, goals, tasks, approvals, audit events (`server/executive/`) | IMPLEMENTED, migration 0002 not applied on the database |
| n8n Executive Dispatch / Schedule | CONFIGURED as drafts, unpublished |
| Agent memory (`atlas.memory_items`, migration 0003) | IMPLEMENTED, applied |
| GitHub webhook receiver (`server/live.ts`) | IMPLEMENTED, feeds the live ticker only |
| Senior Engineering Reviewer, Fix with Claude | IMPLEMENTED, manual, separate from the Executive |
| Workflow Intelligence history | PARTIAL, kept in the browser only; engineering history uses the Executive event log instead |
| CI repair, isolated runner, independent QA, PR delivery | MISSING (built here) |

## How a repair runs

```
CI fails on main ──► webhook (signature checked) or 30-minute sweep ──► Atlas re-reads the run from GitHub
   ──► dedupe (repo + workflow + commit) ──► classify (lint / typecheck / test only) ──► intake rule
   ──► Executive goal "engineering-ci-repair": implement → qa → deliver → report
implement: n8n Atlas · Engineering Dispatch ──► .github/workflows/atlas-engineer.yml
   guard      validates the task, confirms the failed run, fetches its log (redacted)
   implement  Claude Code: Read/Edit/Write/Glob/Grep only, no shell, no web, ANTHROPIC_API_KEY in that step only
   report     pushes atlas-eng/<task>-a<attempt> (never main), starts the checks on that branch,
              POSTs /api/hooks/engineering-result
checks: .github/workflows/atlas-engineer-validate.yml on the atlas-eng branch as its own ref:
   npm ci, Lint / Typecheck / Unit tests, NO secrets, no dependency cache. The model-written change is
   only ever installed and run here, in the branch's context, so it can't reach main's Actions cache.
qa (inside Atlas): reads the runner run, the checks run for exactly the pushed commit, and the
   base...branch diff from GitHub; it looks again about every 5 minutes while the checks run
   PASS ──► deliver   FAIL ──► repair with QA's feedback (at most 2), then Khaneil
   NEEDS_REVIEW (dependency or security-relevant change) ──► approval for Khaneil   BLOCKED ──► retry later
deliver: n8n Atlas · GitHub PR Delivery opens the pull request ──► pr-delivery/1 back to Atlas
report: completion summary, a Mission Control note and an unverified lesson in agent memory
```

Lifecycle phases are stored per execution in `atlas.eng_executions` and as `engineering.phase` events:
TASK_ASSIGNED → CONTEXT_COLLECTED → IMPLEMENTATION_PLANNED → POLICY_CHECKED → WORKSPACE_PREPARED →
CODE_MODIFIED → VALIDATION_STARTED → VALIDATION_COMPLETED → QA_REVIEW_REQUESTED → PR_READY, with
BLOCKED, FAILED, CANCELLED and AWAITING_APPROVAL on the side. `atlas.exec_events` refuses UPDATE and
DELETE (migration 0004), so the audit trail can only grow.

## Limits and rules

All in `src/engineering/types.ts` and `src/engineering/repos.ts`, changed only by a reviewed pull request
(the runner refuses to edit them):

- Allowlist: `khaneilcampbell/ai-ops-atlas`, workflow `CI`, job `Frontend (types, tests, build)`.
- One open job per repository, 3 automatic repairs a day (then each needs approval), $1 model spend
  per attempt, $3.50 per goal, 10 files and 400 changed lines, 30 Claude turns, runner timeout 55 minutes.
- Protected paths: `.github/`, `.claude/`, signing scripts, `tauri.conf.json`, `secrets.rs`, `handoff.rs`,
  `UpdateButton.tsx`, write actions, the division's own code, policy and capabilities, `db/`, `catalog/`,
  `ops/atlas-engineer/`, `.env` files. The runner and QA both check them.
- QA fails silenced checks (`.skip`, `.only`, `@ts-ignore`, `eslint-disable`, `#[allow]`), deleted tests,
  oversized changes, a branch that doesn't match the reported commit, or a base other than the failing commit.
- The runner throws away a change that adds anything shaped like a credential.
- Logs, comments and repository text are untrusted: the prompt fences the log, Claude has no shell or
  web tools, and QA trusts only GitHub's records.
- Models by alias (`sonnet` routine, `opus` for test failures and repairs), set by `ATLAS_ENGINEERING_MODELS`
  (`routine=…,complex=…`). The Claude Code CLI version is pinned by the repository variable `CLAUDE_CODE_VERSION`.

## Switching it on

Nothing below has been done. Each step is Khaneil's.

1. Merge this pull request.
2. Apply `db/migrations/0002_executive.sql` (if not yet) and `db/migrations/0004_engineering.sql` to the
   Atlas database, then `db/roles.sql` for the grants.
3. GitHub repository settings, [Secrets and variables → Actions](https://github.com/khaneilcampbell/ai-ops-atlas/settings/secrets/actions):
   secret `ATLAS_ENGINEERING_CALLBACK_TOKEN` (at least 32 random characters; `ANTHROPIC_API_KEY` exists),
   variables `ATLAS_ENGINEERING_RESULT_URL` = `https://ai-ops-atlas.pages.dev/api/hooks/engineering-result`
   and `CLAUDE_CODE_VERSION` (a reviewed Claude Code version).
4. Cloudflare Pages, [project settings](https://dash.cloudflare.com/?to=/:account/pages/view/ai-ops-atlas/settings/environment-variables):
   the same `ATLAS_ENGINEERING_CALLBACK_TOKEN`, and later `ATLAS_ENGINEERING_ENABLED=true`. The site's
   `GITHUB_TOKEN` must read Actions.
5. n8n: open [Atlas · Engineering Dispatch](https://khancam15.app.n8n.cloud/workflow/IAtPkKS8fhFFsRWP) and
   [Atlas · GitHub PR Delivery](https://khancam15.app.n8n.cloud/workflow/1k0B7tA9PACRgOMI), check the
   GitHub credential can dispatch workflows and open pull requests on this repository (a fine-grained token
   with Actions and Pull requests write is the narrowest), then publish both.
6. Set `atlas-engineer` and `atlas-qa` to `active` in `catalog/ai-ops-atlas.yaml`, with "draft" removed
   from their triggers.
7. Set `ATLAS_ENGINEERING_ENABLED=true`. Until then every CI failure is recorded and sent to Khaneil as
   a Task Center task, and nothing is repaired.

## What is and isn't proven

- `src/engineering/engineering.test.ts`, `ops/atlas-engineer/runner.test.mjs` and
  `server/engineering/engineering.test.ts` (PGlite, all four migrations, fake GitHub and n8n) cover
  registration, delegation, allowlist, webhook signature, dedupe, lifecycle, bounds, permissions, timeouts,
  QA's bounded repair loop, NEEDS_REVIEW approval, BLOCKED retry, callback authentication and
  idempotency, cost limits and the full path to a pull request as a **labelled local fixture**.
- No real repair has run: the workflow is not on `main`, the migrations aren't applied and the n8n drafts
  are unpublished.
- Known limits: GitHub-hosted runners can't restrict outbound network; Atlas can't cancel a runner run
  (job timeouts bound it); `atlas-eng/` branches from failed attempts stay until deleted by hand; the 3D
  desks don't show the agents' live activity yet (the panel does).

## Rollback

Revert the pull request. To stop without a revert: set `ATLAS_ENGINEERING_ENABLED` to anything but
`true`, unpublish the two n8n workflows, or disable the Atlas Engineer workflows on GitHub. Migration
`0004_engineering.down.sql` removes the tables (and the append-only trigger) if needed.
