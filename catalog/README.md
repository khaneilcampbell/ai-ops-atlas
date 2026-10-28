# Catalog manifests

Each YAML file in this folder registers one project, its repository and the agents that belong to it. The app bundles every `*.yaml` file here at build time, and `npm test` validates them.

```yaml
schema: atlas/v2                   # atlas/v1 still works; v2 adds the registry block

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
    capabilities:                  # optional: what it can do, shown in Agent management
      - Score niches by demand and competition
    permissions:                   # optional: access it holds, shown as declared
      - "Anthropic API: messages"
    observe:                       # optional read-only live sources
      github_workflow: ci.yml      # latest run of this workflow updates last run and health
      atlas_intel: true            # or: the app's own run log, for agents that run inside Atlas
    links: []                      # optional
    history:                       # optional notable events, newest first
      - at: 2026-10-12
        event: What happened
```

## Agent registry block (atlas/v2)

Each agent may carry a `registry` block. Every field is optional: anything left out shows as **Not documented** in the app, never as a guess. Editors that understand `yaml-language-server` validate against [`schema/atlas-v2.schema.json`](schema/atlas-v2.schema.json); `npm test` runs the real validator.

```yaml
    registry:
      title: Website Quality Auditor     # display title; id, name, source and workflow names stay as they are
      category: engineering              # engineering | security | business | data | career | infrastructure
      subcategory: Code quality
      classification:
        type: C                          # see "Agent types" below
        confidence: verified             # verified | provisional | unverified
        evidence: scripts/site_audit.py uses no AI model
      mission:
        purpose: Defaults to the agent's purpose
        problem: The problem it solves
        outcomes: [Expected outcome]
        beneficiaries: [Who it serves]
      responsibilities:
        tasks: [What it does]
        tools: [Services and libraries it uses]
        inputs: [What it consumes]
        outputs: [What it produces]
        dependencies: [other-agent-id]   # agent ids become links in the app
        limitations: [Known limits]
      goals:
        objective: Primary objective
        review_frequency: Monthly
        kpis:
          - name: Run success rate
            kind: reliability            # reliability | quality | cost | throughput | other
            target: At least 95% of runs succeed
            target_value: 95             # optional number, needs direction
            direction: min               # min | max
            basis: Why this target
            measure: run_success_rate    # optional: run_success_rate | runs_last_30d | avg_duration_minutes | month_spend_usd
      execution:
        trigger_type: event              # manual | scheduled | event | continuous
        schedule: Daily at 06:00
        environment: GitHub-hosted runner
        stages: [Step one, Step two]
      governance:
        autonomy: 0                      # 0 to 4, see "Autonomy levels"
        autonomy_note: Why this level
        data_sensitivity: public         # public | internal | confidential | restricted
        approval: Who approves what
        credential_owner: Who holds the keys
        risk: low                        # low | medium | high
        audit_log: Where runs are recorded
      cost:
        budget: Spending limit, in words
        notes: How cost is incurred
      docs:
        technical: docs/how-it-works.md  # repository path or https URL
        runbook: docs/runbook.md
        known_issues: []
        improvements: []
        last_review: 2026-10-27
```

Tool permissions stay in the agent's existing `permissions` list, so there is one place for them.

**Targets versus observations.** A KPI's `target` is written by a person. Its observed value is computed by the app from a live source named by `measure` and `observe`, and is never stored in YAML. Without a live source the app shows **Not connected**.

### Agent types

| Type | Meaning |
|---|---|
| `A` AI Agent | Uses an AI model to interpret inputs, reason about tasks or select actions within defined boundaries. |
| `B` AI-Assisted Workflow | Uses an AI model inside a predefined workflow. |
| `C` Deterministic Automation | Performs predefined steps without AI-driven decisions. |
| `D` CI/CD Pipeline | Runs tests, builds, validation or deployment. |
| `E` Utility or Integration | Provides a capability or connects systems without its own agent mission. |
| `F` Planned Agent | Proposed, not implemented. |

### Autonomy levels

Levels describe what the agent is permitted to do in its own environment, not how capable its model is. Atlas itself is read-only at every level.

| Level | Name | Meaning |
|---|---|---|
| 0 | Observe | Read-only data collection and monitoring. |
| 1 | Recommend | Insights and proposed actions, no external changes. |
| 2 | Approval required | Prepares actions a person authorizes before they run. |
| 3 | Limited autonomous execution | Narrowly scoped actions with predefined controls. |
| 4 | Advanced orchestration | Coordinates agents under explicit policies and audit controls. |

## Connections on the map

The 3D map draws a connection only where a manifest or GitHub data states it. Shared technology never counts. Today it reads:

- **GitHub**: a repository and the agents whose `source` or `observe.github_workflow` it holds, and AI Ops Atlas reading each cataloged repository.
- **AI agents** and **n8n**: agent ids listed under `registry.responsibilities.dependencies`. A link is n8n when either agent's framework or runtime is n8n.
- **Dependencies**: dependencies between agents of different projects, and anything a project declares:

```yaml
project:
  connections:                     # optional; each target must be a project or agent id
    - to: benjaire-flow-intake
      type: n8n                    # github | agent | n8n | dependency
      direction: outbound          # optional: outbound | inbound; leave out when unknown
      note: What the relationship is and how it was verified.
```

A connection turns red only when an observed workflow run on the default branch failed. Moving dots mean a run or sync verified it in the last 14 days.

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

## When GitHub changes

Atlas follows GitHub on every refresh, on the desktop app and the iPhone web build alike:

- **Deleted repository.** With a token, a cataloged repository that GitHub answers 404 for and that is missing from the owner's full repository list is hidden from the map and every list. The Repositories page names it, so delete its manifest here to drop it for good. Without a token Atlas can't tell deleted from private, so it keeps showing it as unavailable.
- **Archived repository.** Hidden the same way, and back as soon as it is unarchived.
- **Renamed repository.** GitHub redirects the old name, so the project keeps working, and the new name isn't listed a second time as uncataloged. The Repositories page suggests updating the manifest.
- **New repository.** Owner discovery lists it as uncataloged until it gets a manifest.
