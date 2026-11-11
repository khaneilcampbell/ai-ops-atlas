# Atlas handoff — 2026-11-11

Objective complete: Portfolio Web Studio district footprint and building canopy height match Agent Operations Center. Twelve floors and façade preserved. District grows locally from 5×5 to 7.5×7.5; protected anchors and Commons stay fixed. GitHub's three-tier annex retains its depth on a shorter clear east-edge span. Filtered layouts without room inside the original city envelope retain their fallback footprint.

Workspace: /private/tmp/atlas-portfolio-size. Branch: codex/portfolio-district-size, based on current main 1e50d65d77f2780e7e8fe5ead4b5dd4a5e1a00f3.
Draft PR: https://github.com/khaneilcampbell/ai-ops-atlas/pull/365. No merge or deployment. Next action: review draft and limitation; KC decides whether to merge.
Preview: http://127.0.0.1:5226/ (local Vite; availability verified when written). Not evidence of the installed desktop app or production.
Tested source commit: 322954ef01bbfdd5b06961963c0fef6c25a321c7. Subsequent changes are changelog/handoff only; runtime code, environment and coverage unchanged.
Validation: lint/typecheck passed; full unit suite with one worker: 197 files, 1,353 tests passed, including unchanged timing guard. Final affected visual checks: desktop day/night and 390×844 phone, 3 passed. Screenshots manually reviewed. Fixtures in Chromium/SwiftShader, not live operations. Rust unchanged. Before/after evidence and exact limitations: docs/portfolio-district/validation.md. Initial repacking failed layout guards and was replaced; concurrent timing failure resolved by a serial final run, without loosening checks.
Limitation: existing nameplate selection test stalled on main and was interrupted; no passing selection claim. Screenshot-only specs do not compare baselines; after cameras are farther back to show full height. No paid/model/recurring work or parallel agents used.

Original workspace /Users/khaneil/Documents/ChatGPT/AI Ops Atlas has extensive unrelated dirty work; do not clean/reset or treat it as current production evidence. This task only updates its handoff. Prior worktree /private/tmp/atlas-central-hub and prior preview 5225 are separate and stale for this task. Advisory docs/development/minimal-usage.md remains local in that original workspace.
