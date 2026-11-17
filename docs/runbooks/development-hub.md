# Runbooks: Development & Repository Hub

The Development Hub's scheduled routines live in this repository under `ops/`. Each has its own runbook: [Merge Flow](../../ops/merge-flow/README.md#runbook), [Design Consistency](../../ops/design-consistency/README.md#runbook) and [Opportunity Scout](../../ops/opportunity-scout/README.md#runbook).

## Development Hub Lead

An owning agent with no model of its own. Its automations are Design Consistency and Opportunity Scout, both on GitHub Actions schedules. Atlas shows its health as the worst of theirs; follow the runbook of whichever is red.

## GitHub Profile Manager

An unpublished n8n agent ("Atlas – GitHub Profile Manager", last edited 2026-11-08). It does not run. Its instructions and tools can't be read from Atlas's n8n connection, so before anyone publishes it, open it in n8n, check its tools and budget, and document them here and in `catalog/khaneilcampbell-profile.yaml`.

- **Stop it:** it is already off. To remove it for good, archive it in n8n and mark its catalog entry retired.
