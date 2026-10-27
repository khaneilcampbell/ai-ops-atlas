# Catalog manifests

Each YAML file in this folder registers one project, its repository and the agents that belong to it. The app bundles every `*.yaml` file here at build time, and `npm test` validates them.

```yaml
schema: atlas/v1

project:
  id: commerce-pipeline            # lowercase letters, digits and dashes; unique across files
  name: Multi-Agent Commerce Pipeline
  summary: One or two sentences on what the project does.
  status: active                   # active | idle | paused | attention | retired
  repository: owner/repo           # GitHub repository, read-only
  tags: [crewai, shopify]          # optional
  links:                           # optional, https only
    - label: Case study
      url: https://example.com

agents:
  - id: niche-scout                # unique across all files
    name: Shopify Niche Scout
    purpose: What this agent is for.
    framework: CrewAI              # free text; drives filters and map colors
    model: Claude (Anthropic API)  # optional
    runtime: Linux VPS             # optional: where it runs
    status: idle                   # same values as project.status
    trigger: Phase 1, weekly       # optional: what starts it
    source: scripts/crew.py        # optional: path in the repository, linked on GitHub
    repository: owner/other-repo   # optional, defaults to project.repository
    last_run: 2026-10-26T06:52:28Z # ISO date or null when unknown
    observe:                       # optional read-only live sources
      github_workflow: ci.yml      # latest run of this workflow updates last run and health
    links: []                      # optional
    history:                       # optional notable events, newest first
      - at: 2026-10-12
        event: What happened
```

## Status meanings

| Status | Use it when |
|---|---|
| `active` | It runs on a schedule or is in regular use. Active agents with no run in 7 days are flagged. |
| `idle` | It runs on demand and nothing is expected. |
| `paused` | Deliberately switched off for now. |
| `attention` | Something is wrong and you want it on the overview until you fix it. |
| `retired` | Kept for the record only. |

## What comes next

`last_run` and `history` are filled in by hand for now. The next milestone adds live sources (n8n executions first, then project-specific adapters for CrewAI and local scripts) that fill these in automatically. The `observe` block is where those sources will be declared.
