---
title: Service Desk Dashboard
subtitle: Engineering Learning Guide · web-04
---

| Project ID | Purpose of this guide | Last verified |
|---|---|---|
| web-04 | Prepare the concepts this project will need, and explain the baseline you already have | 2026-10-26 |

**Labels.** General explanations are background knowledge; every "Example from your project" is **[Verified]**.

# 1. Engineering Concepts This Project Teaches

| Concept | Where it shows up |
|---|---|
| Supply-chain security for CI | SHA-pinned actions, dependency review |
| Secret scanning | gitleaks job |
| Static analysis | CodeQL |
| ITSM metrics | Planned scope |
| Synthetic data | Planned generator |

# 2. How the Major Components Work

## Pinning actions to commit SHAs

**Beginner.** A workflow step like `actions/checkout@v7` runs someone else's code. A tag can be moved to point at different code.

**Intermediate.** A full commit SHA cannot be moved, so the code you reviewed is the code that runs. Dependabot can still update SHA pins.

**Enterprise application.** Many security teams require SHA pinning after real supply-chain attacks through compromised actions.

**Example from your project.** [Verified] `actions/checkout@3d3c42e…  # v7.0.1` in `ci.yml`.

## Secret scanning

**Beginner.** A tool that searches your code and its history for things that look like passwords or keys.

**Example from your project.** [Verified] The gitleaks job checks out the full history (`fetch-depth: 0`). That matters: ai-01 shows a password can stay in history after it is removed from the current code.

## ITSM metrics you plan to show

**Beginner.** First contact resolution: share of tickets solved on the first interaction. Backlog ageing: how long open tickets have waited. SLA health: share of tickets resolved within their target time.

**Intermediate.** Each needs a precise definition (what starts and stops the clock, whether reopened tickets count) before it is computed.

**Enterprise application.** ITIL 4 practices and tools such as ServiceNow Performance Analytics define these formally.

**Example from your project.** [Verified] Ground rule: "A value appears only when it is computed from the data in the repository."

# 3. Why These Tools

[Verified] Python CI scaffolding and MIT license are chosen; the dashboard stack is not.

# 4–7. Behind the Scenes, Code Structures, Data Movement, Failures

Not applicable until code exists.

# 8. How an Experienced Engineer Would Approach It

Define the data model and each metric in writing, build the synthetic generator, and only then pick a dashboard tool that fits the data.

# 9. What You Need to Explain in a Technical Interview

- Why you use synthetic data instead of real tickets.
- Why actions are pinned to SHAs.
- How you would define first contact resolution precisely.

# 10. What to Learn Next

Pandas and a dashboard framework (for example Streamlit or Grafana); data modelling for tickets; ITIL 4 measurement.

# Test Your Understanding

1. Why does the CI "Lint and test" job pass today even though there is no code?
2. Why does the gitleaks job fetch the full git history?
3. What is the risk of `uses: some-action@v1` compared with a SHA?
4. Define backlog ageing in a way that two people would compute the same number.
5. Which branch would you merge to get both the baseline and the full README, and why?
