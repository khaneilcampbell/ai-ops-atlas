---
title: Service Desk Dashboard
subtitle: Project Roadmap · web-04
---

| Project ID | Status | Deadlines | Last verified |
|---|---|---|---|
| web-04 | Planning | None set | 2026-10-26 |

**Scale used.** Pri: P1 (do next), P2 (soon), P3 (when useful). Size: S (under an hour), M (an afternoon), L (several sessions). All tasks are [Recommended]; none has a deadline.

# Immediate Priorities

| # | Task | Pri | Size | Needs | Expected outcome | Status |
|--|----------------------|----|----|-----|---------------|-----|
| 1 | Correct the Splunk lab link spelling on `docs/portfolio-review` | P1 | S | None | Link matches the repo name | Not started |
| 2 | PR and merge `docs/portfolio-review` | P1 | S | None | Baseline and README on `main` | Not started |
| 3 | Delete `claude/project-thread-r7w4hr` | P2 | S | Step 2 | Clean branches | Not started |

# Short-Term Improvements

| # | Task | Pri | Size | Needs | Expected outcome | Status |
|--|----------------------|----|----|-----|---------------|-----|
| 4 | Write the ticket data model and metric definitions | P1 | M | None | `docs/` with definitions | Not started |
| 5 | Choose the stack; enable Dependabot and CodeQL for it | P2 | S | Step 4 | Matching CI | Not started |
| 6 | Synthetic ticket generator with tests | P2 | M | Step 5 | Runnable data | Not started |

# Long-Term Opportunities

| # | Task | Pri | Size | Needs | Expected outcome | Status |
|--|----------------------|----|----|-----|---------------|-----|
| 7 | First dashboard with 3–4 defined metrics | P2 | L | Step 6 | A showable project | Not started |
| 8 | Optional connector to a sandbox ITSM API | P3 | L | A sandbox account | Real-shaped data | Not started |

# Portfolio Readiness

| Item | State |
|---|---|
| Public repo | Yes, but `main` is nearly empty |
| Working demo | No |
| Recommended | Do not feature it until step 7 |

# Interview Readiness

| Can you explain… | Where to review |
|---|---|
| Your repository security baseline | Technical Deep Dive §9 |
| ITSM metric definitions | Learning Guide §2 |
