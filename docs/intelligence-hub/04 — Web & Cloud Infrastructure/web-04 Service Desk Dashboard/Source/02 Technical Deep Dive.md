---
title: Service Desk Dashboard
subtitle: Technical Deep Dive · web-04
---

| Project ID | Verified against | Last verified |
|---|---|---|
| web-04 | `docs/portfolio-review` at f65c017 | 2026-10-26 |

**Scope.** There is no application yet, so this document covers the repository baseline only. Sections that would describe the running system say "Not built".

# 1. System Architecture

Not built.

# 2. Components (repository baseline)

| File | Role |
|---|---|
| `.github/workflows/ci.yml` | Python lint and test (skips until a Python project exists), gitleaks secret scan, dependency review on PRs |
| `.github/workflows/codeql.yml` | CodeQL for GitHub Actions; weekly schedule (Monday 06:23 UTC) |
| `.github/dependabot.yml` | GitHub Actions updates; pip or npm left commented out |
| `.github/CODEOWNERS`, templates | Review ownership, bug and feature forms, PR template |
| `.env.example` | Names only: `SERVICE_DESK_BASE_URL`, `SERVICE_DESK_API_TOKEN`, `DATABASE_URL` |
| `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE` (MIT) | Process and policy |
| `.editorconfig`, `.gitattributes`, `.gitignore` | Consistency |

# 3. Integrations

[Verified] Planned only: `.env.example` names ServiceNow, Jira Service Management and Zendesk as examples of a service desk API.

# 4. Authentication

Not built. [Verified] Tokens are meant for a gitignored `.env`.

# 5–8. Data Flows, Structures, Error Handling, Monitoring

Not built.

# 9. Security Considerations

[Verified] Actions pinned to full commit SHAs; `permissions: contents: read`; gitleaks over full history; dependency review fails on high severity; CodeQL weekly. Ground rule: no employer data.

# 10. Deployment Architecture

Not decided.

# 11. Testing Methodology

[Verified] CI runs `ruff check .` and `pytest` once a Python project and `tests/` exist. Nothing to run today.

# 12. Troubleshooting Procedures

| Symptom | Check |
|---|---|
| CI "Lint and test" passes instantly | Expected: no `pyproject.toml` yet |
| Dependency review skipped | Expected unless a manifest changed |

# 13. Performance Considerations

Not applicable yet.

# 14. Future Engineering Improvements

[Recommended] When a stack is chosen, enable the matching Dependabot ecosystem and add that language to CodeQL.
