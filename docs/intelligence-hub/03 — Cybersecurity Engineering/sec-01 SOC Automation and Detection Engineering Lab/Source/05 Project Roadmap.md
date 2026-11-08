---
title: SOC Automation and Detection Engineering Lab
subtitle: Project Roadmap · sec-01
---

| Project ID | Status | Deadlines | Last verified |
|---|---|---|---|
| sec-01 | Completed as a lab; improvements open | None set | 2026-10-26 |

**Scale used.** Priority: P1 (do next), P2 (soon), P3 (when useful). Complexity: S (under an hour), M (an afternoon), L (several sessions). All tasks are [Recommended] unless marked otherwise; none has a deadline.

# Immediate Priorities

| # | Task | Priority | Complexity | Depends on | Expected outcome | Status |
|---|---|---|---|---|---|---|
| 1 | Review and merge `docs/portfolio-review` into `main` | P1 | S | None | README on GitHub shows accurate status, limitations and links | Not started |
| 2 | Update the local folder from GitHub; decide what to do with the older duplicate clone | P1 | S | 1 | One current local copy that includes `soc_automation.py` | Not started |
| 3 | Fix the profile README link `ssplunk-bruteforce-detection-lab` (also in service-desk-dashboard) | P1 | S | None | Links from your profile resolve | Not started |

# Short-Term Improvements

| # | Task | Priority | Complexity | Depends on | Expected outcome | Status |
|---|---|---|---|---|---|---|
| 4 | Group the detection on the target account only, in both SPL copies | P2 | M | Lab environment running | One row per real alert instead of two | Not started |
| 5 | Re-run the lab and regenerate screenshots 05, 07 and 08 | P2 | M | 4 | Evidence matches the committed code, including severity | Not started |
| 6 | Exit with a non-zero status on any error | P2 | S | None | Failures are visible to schedulers and CI | Not started |
| 7 | Move `SPLUNK_HOST` and TLS verification into environment variables | P2 | S | None | Script can run against another Splunk without code edits | Not started |
| 8 | Add `pytest` tests with recorded JSON for `generate_case_note()` | P2 | M | None | Output format protected against regressions | Not started |
| 9 | Explain the 81 versus 80 event difference in the README | P3 | S | 5 | Numbers in the README reconcile | Not started |

# Long-Term Opportunities

| # | Task | Priority | Complexity | Depends on | Expected outcome | Status |
|---|---|---|---|---|---|---|
| 10 | Add a correlation search for 4624 after 4625 from the same source | P3 | M | 4 | Detects a successful guess, not only attempts | Not started |
| 11 | Detect password spraying (many accounts, one source) | P3 | M | 4 | Covers T1110.003 | Not started |
| 12 | Convert the detection into a scheduled Splunk alert that triggers the script | P3 | L | 6, 7 | Unattended detection-to-note pipeline | Not started |
| 13 | Send case notes to a ticketing system or chat | P3 | L | 12 | Matches a real SOC workflow | Not started |

# Portfolio Readiness

| Item | State |
|---|---|
| README with status, limitations and AI disclosure | [Verified] Done on the docs branch; needs merge (task 1) |
| Evidence screenshots | [Verified] Present; three need regenerating after task 4 (task 5) |
| Public case study | [Verified] Live at khaneilcampbell.com/soc-automation-lab.html |
| Licence and contribution guide | [Verified] MIT licence and CONTRIBUTING.md on `main` |
| Automated checks | [Verified] None; task 8 adds them |

# Interview Readiness

Concepts to explain confidently, with the guide section that covers each:

| Concept | Where to study it | Confidence |
|---|---|---|
| Event ID 4625 fields and logon types | Learning Guide 2 | Not assessed |
| Thresholds, buckets and false positives | Learning Guide 2 and 9 | Not assessed |
| Forwarder, indexer and search roles | Learning Guide 2 | Not assessed |
| REST session authentication and secrets handling | Learning Guide 2 and Deep Dive 4 | Not assessed |
| The double-count bug and its fix | Learning Guide 7 | Not assessed |
| How you used Claude and what you verified | Overview 12, README | Not assessed |

Update the Confidence column yourself after each review.
