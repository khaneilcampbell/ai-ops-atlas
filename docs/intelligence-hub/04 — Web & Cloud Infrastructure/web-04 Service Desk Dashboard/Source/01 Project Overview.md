---
title: Service Desk Dashboard
subtitle: Project Overview · web-04
---

| Project ID | Category | Status | Last verified |
|---|---|---|---|
| web-04 | Web & Cloud Infrastructure | Planning (no application code) | 2026-10-26 |

| Source | Location |
|---|---|
| GitHub repository | [khaneilcampbell/service-desk-dashboard](https://github.com/khaneilcampbell/service-desk-dashboard) (public) |
| Local folder | None found in Documents |
| Related projects | sec-01 Splunk lab, ai-01 Commerce Pipeline (linked from the README) |

**How to read the labels.** **[Verified]** read in the repository. **[Inferred]** my reasoning. **[Recommended]** a suggestion.

# Project Reorientation

*A five-minute read to pick the project back up.*

**Where you left off.** [Verified] On 2026-10-24 you created the repo (one-line README on `main`), added a GitHub development and security baseline, and wrote a README with purpose, ground rules and planned scope. All of that sits on unmerged branches; `main` still has only the initial commit.

**What it is meant to do.** [Verified, README] Turn service desk ticket data into insight: volume and backlog trends, SLA health, first contact resolution, recurring issues, knowledge article coverage and team workload.

**How it works.** Nothing runs yet. [Verified] The README says so: "Everything below describes intent, not a working system."

**What you learned so far.** Setting up a repository baseline: pinned GitHub Actions, CodeQL, a gitleaks secret scan, dependency review, Dependabot, issue and PR templates, CODEOWNERS.

**What remains unresolved.** The stack, the data model, the synthetic data generator and the metric definitions. The README links the Splunk lab as `ssplunk-bruteforce-detection-lab` (double s), while the repository is named `splunk-bruteforce-detection-lab`; I could not confirm from here whether GitHub redirects that spelling.

**What to work on next.** Merge the baseline and README, fix the link, then design the data model.

**Explain it without AI in one breath.** "It's a planned ITSM dashboard that will run on synthetic ticket data; right now it's a repository with CI, secret scanning and security policies ready for the first code."

# 1. Executive Summary

[Verified] A planned portfolio project for service desk reporting, with ground rules against employer data and invented metrics. Only the repository baseline exists.

# 2. Problem Statement

[Verified, README] Service desk activity holds operational insight that is hard to see without a dashboard. [Verified, README] It "builds on an internal, unpublished ITSM AI assistant" from your service desk work; I have not seen that assistant.

# 3. Objectives

[Verified, README] Planned scope: a documented data model; a synthetic data generator; the dashboard, with each metric defined before it is shown; setup and verification instructions.

# 4. Current Development Status

| Area | State | Evidence |
|---|---|---|
| `main` | Initial commit only | a6d0458 |
| Security and CI baseline | On a branch, unmerged | `claude/project-thread-r7w4hr` (285b3bf) |
| Full README | On a branch, unmerged | `docs/portfolio-review` (f65c017), which includes the baseline |
| Application code | None | File list on every branch |

# 5. Technology Stack

[Verified] Not chosen. The CI is written for Python 3.12 (ruff, pytest) and skips itself until a `pyproject.toml` or `requirements.txt` exists. `.env.example` lists a service desk API URL and token and a database URL. [Inferred] Python is the likely stack, but nothing commits to it.

# 6. System Architecture

No architecture exists yet, so no diagram is drawn.

# 7. Workflow Explanation

[Verified] Planned workflow from the README and CONTRIBUTING: protected `main`, pull requests with passing checks, Conventional Commits, branch prefixes `feat/`, `fix/`, `chore/`, `docs/`.

# 8. Key Engineering Decisions

| Decision | Label |
|---|---|
| Synthetic or anonymised data only | Verified |
| No metric without data in the repo | Verified |
| Secrets only in a gitignored `.env` | Verified |
| Actions pinned to commit SHAs | Verified |

# 9. Challenges and Solutions

[Verified] One: dependency review ran on every PR; commit 285b3bf limits it to PRs that change a dependency manifest.

# 10. Current Limitations

[Verified] No code, no data model, no stack. [Inferred] `main` being protected and nearly empty means the baseline must arrive by pull request.

# 11. Next Development Steps

1. [Recommended] Open a PR from `docs/portfolio-review` (it contains the baseline) and merge it; delete `claude/project-thread-r7w4hr` afterwards.
2. [Recommended] Change the Splunk lab link to `splunk-bruteforce-detection-lab`.
3. [Recommended] Write the data model and metric definitions before any code.

# 12. Career Relevance

| Role focus | What this project could show |
|---|---|
| IT service management | ITSM metrics: SLA, backlog ageing, first contact resolution |
| Data and dashboards | Data modelling and honest metric definitions |
| Engineering practice | Already shows a secure repository baseline |

# 13. Last Updated

| Field | Value |
|---|---|
| Last verified | 2026-10-26 |
| Verified against | All three branches (a6d0458, f65c017, 285b3bf) |
| Not read | The internal ITSM assistant mentioned in the README |
| Prepared by | Claude, for review by Khaneil Campbell |
