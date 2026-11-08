# GitHub Operations Steward starter

This package supplies an operating prompt, Atlas-scoped pilot policy and executable GET-only evidence collector. It does not install a background agent, call a paid model, change Atlas behavior, or change GitHub settings. Existing application work is independent.

## First run

1. The pilot policy is enabled for `khaneilcampbell/ai-ops-atlas` only, with `mode` set to `observe`. Review that scope before running. The in-app integration is documented in `docs/github-steward.md` and uses its own fixed limits.
2. Authenticate GitHub CLI with a dedicated read-only identity limited to these repositories. Grant only the read access needed for metadata, Actions and selected security alerts. Unavailable alert permissions are reported as unknown. Do not supply administration or write credentials. The collector uses the CLI's existing authentication; the policy is not a credential permission boundary.
3. Run `python3 ops/github-steward/collect.py > /tmp/github-steward-report.json` from the project root. Keep the report private: it contains repository metadata and potentially vulnerability details. No raw workflow logs or secret values are collected.
4. Give `prompt.md`, the policy and the report to your agent for a bounded assessment. This manual step is the initial agent integration. The collector alone does not diagnose or remediate findings.
5. Create `ops/github-steward/STOP` to stop collection before its next request. Removing it permits a future run. An in-flight request can take up to its timeout to end.

## Smooth rollout

Start with a single manual observation, verify findings against GitHub, then observe daily for a week. Before scheduling, add a trusted scheduler with a cross-process lock, private report storage, retention, immutable audit history, deduplication and change-only notifications. The standalone Python package has no scheduler. Atlas now has a separate opt-in daily scheduler while the app is open; see `docs/github-steward.md`. The policy's concurrency field is a requirement for that scheduler, not an implemented lock.

Before paid reasoning, choose a model and confirm a monthly budget. Enforce limits outside the prompt with provider controls and a durable ledger that reserves the maximum run cost before execution. Stop on missing usage data. No paid calls are implemented here.

Before enabling draft PRs, build a separate narrowly scoped write gateway with an allowlist, path restrictions, protected policy files, idempotency keys, exact-commit validation, a concurrency lock, and expiring approvals. Use isolated workers without production secrets. Enforce branch protections and independent human review in GitHub. The collector deliberately supports observe mode only; changing JSON cannot enable writes.

Merges, production deployments, releases, permission changes, secret rotation, billing and external messages always require a specific human decision. Atlas's existing per-action approvals must remain intact. Do not grant the agent a general administration token.

## Coverage and success criteria

The collector samples metadata, ten recent runs and twenty open alerts per security endpoint. It does not paginate, fetch secret-scanning alerts, measure uptime, inspect dependencies or documentation, execute CI, or retrieve billing. Those domains are responsibilities in the prompt and require additional read adapters and evidence before being marked healthy.

Track confirmed findings, unavailable checks, duplicate proposals, default-branch CI success, incident recurrence, proposed savings versus measured savings, approval rejections and actual spend. Promote autonomy only after reliable evidence, no unauthorized actions and a verified stop mechanism.

Reference: [OpenAI non-interactive execution guidance](https://learn.chatgpt.com/docs/non-interactive-mode). For unattended Codex execution, keep sandboxing and approvals enforced by the runtime. Repository-controlled code must never share a process environment containing model credentials.
