---
title: Phishing-to-Malware Response Walkthrough
subtitle: Project Overview · sec-02
---

| Project ID | Category | Status | Last verified |
|---|---|---|---|
| sec-02 | Cybersecurity Engineering | In progress (site description only) | 2026-10-26 |

| Source | Location |
|---|---|
| GitHub repository | None |
| Local folder | None found in Documents |
| Public description | khaneilcampbell.com/labs.html and lab-details.html |
| Related projects | sec-01 (the published lab), web-01 (the site) |

**How to read the labels.** **[Verified]** read on the site's source. **[Inferred]** my reasoning. **[Recommended]** a suggestion. **Important:** the only evidence for this lab is the description on your portfolio site. I found no lab files, notes, logs or screenshots, so everything below describes the plan, not completed work.

# Project Reorientation

*A five-minute read to pick the project back up.*

**Where you left off.** [Verified] The site lists this lab as "In progress". [Not found] Any working files.

**What it is meant to be.** [Verified, site] A phishing intrusion followed from the user report through host indicators, process review, log evidence and containment, to an incident summary written for people who were not there.

**Planned case file.** [Verified, site]

| Part | Plan |
|---|---|
| Scenario | A user reports a suspicious email, then the host starts behaving unusually. |
| Telemetry | Host process review, Windows Event Logs, endpoint investigation notes. |
| Evidence goal | A timeline linking delivery, execution, persistence and containment. |
| Workflow | Report, analyze, contain, report out. |
| Tools named | Sysinternals, Windows Event Logs, Containment |

**The site's own standard.** [Verified] Every lab must answer: what happened, what evidence proves it, how someone should respond, and how it becomes repeatable. "Anything that cannot answer all four stays marked in progress."

**What to work on next.** Decide whether to build it now; if so, start a repository for it like sec-01's.

**Explain it in one breath (once built).** "A phishing intrusion followed from the user report through host indicators, process review, log evidence and containment, to an incident summary written for people who were not there."

# 1–3. Summary, Problem and Objectives

See the planned case file above.

# 4. Current Development Status

| Area | State |
|---|---|
| Lab environment | Not found |
| Evidence, write-up | Not found |
| Public page | Lists it as in progress |

# 5–10. Stack, Architecture, Workflow, Decisions, Challenges, Limitations

Not started. Planned tools: Sysinternals, Windows Event Logs, Containment.

# 11. Next Development Steps

1. [Recommended] Decide build now, later, or remove from the site.
2. [Recommended] If building: a lab VM setup, a repository, and the four-question write-up modelled on sec-01.

# 12. Career Relevance

[Inferred] Rounds out the security portfolio beyond detection (sec-01) into incident response.

# 13. Last Updated

| Field | Value |
|---|---|
| Last verified | 2026-10-26 |
| Verified against | khaneilcampbell.com `labs.html` and `lab-details.html` on `main` (b6283c4) |
| Prepared by | Claude, for review by Khaneil Campbell |
