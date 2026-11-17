# Runbooks: Development & Repository Hub

The Development Hub's scheduled routines live in this repository under `ops/`. Each has its own runbook: [Merge Flow](../../ops/merge-flow/README.md#runbook), [Design Consistency](../../ops/design-consistency/README.md#runbook) and [Opportunity Scout](../../ops/opportunity-scout/README.md#runbook).

## Development Hub Lead

An owning agent with no model of its own. Its automations are Design Consistency and Opportunity Scout, both on GitHub Actions schedules. Atlas shows its health as the worst of theirs; follow the runbook of whichever is red.

## GitHub Profile Manager

A published n8n agent ("Development Hub – GitHub Profile Manager", id I4i0qQm5g0bfEID8, Claude Sonnet 5). Khaneil attached its GitHub credential and published it on 2026-11-17. It keeps the profile README in khaneilcampbell/khaneilcampbell current for Forward Deployed Engineer roles.

**Its task, every 6 hours** ("Sync profile README with recent repo changes", cron `0 */6 * * *`, New York time):

1. Get the GitHub username and find the profile repository named after it.
2. Read README.md and the date of its last commit (no commits yet: look back 30 days).
3. List Khaneil's own non-fork repositories updated since then; check commits, merged pull requests, releases, descriptions, topics and README changes.
4. Sort each change into meaningful (new project, feature, release, integration, new technology) or trivial (typos, dependency bumps, CI, formatting).
5. If anything is meaningful, rewrite the affected sections in this order: headline and FDE intro, What I do, Featured projects (4 to 6), Recent activity (3 to 5 dated bullets), Tech stack, Contact. Commit README.md to the default branch.
6. Reply with the repositories that triggered it, the sections changed and the commit link, or say the profile is already current.

Rules: writes only to the profile repository, never invents projects, metrics or clients, never names private repositories, no commit for trivial changes. Tools: GitHub MCP server and Anthropic web search (5 per run). Memory and prompt caching are on.

- **Healthy:** the profile repository gets a README commit only after meaningful project changes, and n8n shows the agent's runs without errors.
- **Know:** it commits straight to the default branch with no pull request, up to 4 times a day.
- **Stop it:** unpublish the agent in n8n or disable its task. To remove it for good, archive it in n8n and mark its catalog entry retired.

