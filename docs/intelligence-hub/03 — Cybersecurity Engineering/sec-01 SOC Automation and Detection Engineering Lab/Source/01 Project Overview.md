---
title: SOC Automation and Detection Engineering Lab
subtitle: Project Overview · sec-01
---

| Project ID | Category | Status | Last verified |
|---|---|---|---|
| sec-01 | Cybersecurity Engineering | Completed (as a lab exercise) | 2026-10-26 |

| Source | Location |
|---|---|
| GitHub repository | [khaneilcampbell/splunk-bruteforce-detection-lab](https://github.com/khaneilcampbell/splunk-bruteforce-detection-lab) |
| Portfolio case study | [khaneilcampbell.com/soc-automation-lab.html](https://khaneilcampbell.com/soc-automation-lab.html) |
| Local folder | Local clone on your Mac (out of date, see section 4) |
| Related Claude conversation | None accessible |

**How to read the labels.** **[Verified]** means I read it in the repository, its commit history or its screenshots. **[Inferred]** means it is my reasoning from that evidence and could be wrong. **[Recommended]** means a suggestion, not something that exists.

**Contents.** Project Reorientation · 1 Executive Summary · 2 Problem Statement · 3 Objectives · 4 Current Status · 5 Technology Stack · 6 System Architecture · 7 Workflow · 8 Key Engineering Decisions · 9 Challenges and Solutions · 10 Current Limitations · 11 Next Steps · 12 Career Relevance · 13 Last Updated

# Project Reorientation

*A five-minute read to pick the project back up.*

**Where you left off.** [Verified] The lab itself was built and run on 2026-03-29. The last work was documentation: on 2026-10-24 and 25 a `docs/portfolio-review` branch restructured the README and renamed links. That branch is not merged into `main`.

**What the system does.** [Verified] A Kali Linux VM sends repeated wrong-password SMB logons to a Windows 11 VM. Windows logs each failure as Event ID 4625, a Splunk Universal Forwarder ships the log to Splunk Enterprise, and an SPL search flags 10 or more failures from one source against one account in a five-minute window. A Python script then pulls those alerts through the Splunk REST API and writes a Markdown case note.

**How the architecture works.** Two VMs, an attacker and a target with the forwarder, plus Splunk Enterprise. [Inferred] Splunk most likely ran on the Mac itself, because both the Splunk web screenshot and the script use `localhost`. The only automation is `soc_automation.py`, which talks to Splunk's management port (8089). The diagram is in section 6.

**What you learned.** Windows authentication logging, log forwarding, SPL aggregation and thresholds, REST API authentication with session keys, and safe handling of lab credentials.

**What remains unresolved.**

- [Verified] The case-note screenshot labels a 16-failure alert High, but the committed script labels anything under 20 as Medium. The screenshot came from a script version that is not in git.
- [Verified] The search counts each failure twice, once for the account name `-` and once for `administrator` (see the Engineering Learning Guide, section 7).
- [Verified] The `docs/portfolio-review` branch is unmerged, and your local folder is missing `soc_automation.py`.

**What to work on next.** Merge the docs branch, then fix the double count in the SPL. Section 11 has the full list.

**Explain it without AI in one breath.** "I simulated an SMB password-guessing attack in an isolated lab, forwarded the Windows failed-logon events to Splunk, wrote a threshold detection for 10 failures in five minutes, and automated the triage note by querying Splunk's REST API from Python."

# 1. Executive Summary

This is a home security lab that shows the full path from attack to analyst paperwork. [Verified] It simulates a brute-force attack, detects it in Splunk, and turns the detection into a written case note automatically. It is published as a portfolio piece on GitHub and on khaneilcampbell.com, and the README describes it as "complete as a lab exercise".

# 2. Problem Statement

[Verified] The README frames it as an end-to-end SOC workflow: threat simulation, detection engineering, and alert triage documentation. [Inferred] The practical problem is that analysts repeat the same lookup and note-writing for every brute-force alert; the lab shows how that step can be scripted, and gives you hands-on evidence of blue-team skills for job applications.

# 3. Project Objectives

[Verified] From the README "Lab Objectives":

1. Simulate SMB brute-force attempts from Kali to Windows 11.
2. Forward Windows Security logs (EventCode 4625) to Splunk.
3. Build SPL detections for brute-force behavior.
4. Pull detection results programmatically from the Splunk REST API.
5. Generate structured SOC case notes automatically.

# 4. Current Development Status

| Area | State | Evidence |
|---|---|---|
| Lab environment and attack | Completed | WALKTHROUGH.md phases 1 and 2; screenshots 01 to 03 |
| Splunk ingestion and detections | Completed | Screenshots 04 to 06: 81 events, 8 threshold rows |
| Python case-note automation | Completed | `soc_automation.py`; screenshots 07 and 08 |
| Documentation refresh | In progress | `docs/portfolio-review` branch, 2 commits, not merged |
| Severity mismatch in screenshot | Open | Script grades 16 failures Medium; screenshot shows High |
| Double counting by Account_Name | Open | Screenshot 05 shows paired rows for `-` and `administrator` |
| Local copy | Out of date | Local HEAD e7f4385 (2026-04-26), 5 commits behind `main`, no `soc_automation.py` |

Blocked: nothing. Planned: nothing is planned in the repository itself.

# 5. Technology Stack

| Technology | Role in this project |
|---|---|
| VirtualBox 7.2.6 | Runs the two VMs on a host-only network so attack traffic never leaves the laptop |
| Kali Linux | Attacker; runs `smbclient` in a loop with a wrong password |
| Windows 11 | Target; records each failed logon as Event ID 4625 |
| Splunk Universal Forwarder | Reads the Windows Security log (`[WinEventLog://Security]`) and sends it to the indexer |
| Splunk Enterprise | Stores events in `index=main` and runs the SPL detections |
| SPL | Search language used to aggregate, threshold and grade failed logons |
| Python 3 with `requests` | Calls the Splunk REST API and writes the case note |
| Markdown | Format of the generated case note |
| Git and GitHub | Version control, publishing, and the portfolio's evidence trail |

# 6. System Architecture

![Lab architecture, drawn from README.md and WALKTHROUGH.md](architecture.png){width=100%}

[Verified] Data path: failed SMB logons on the Windows VM are written to the Security log as EventCode 4625, forwarded to Splunk, aggregated by account and source address in five-minute buckets, and pulled by the script, which writes one case note per run.

# 7. Workflow Explanation

1. **Prepare the lab.** Give the Windows VM a static IP (10.10.10.10) on the host-only network and confirm Kali can reach it with `ping`.
2. **Forward logs.** Install the Universal Forwarder on Windows and monitor the Security event log into `index=main`.
3. **Attack.** From Kali, loop `smbclient -L //10.10.10.10 -U administrator%wrongpass`. [Verified] The walkthrough records the account locking out (`NT_STATUS_ACCOUNT_LOCKED_OUT`).
4. **Confirm ingestion.** Search EventCode 4625 in Splunk. [Verified] 81 events from 10.10.10.20.
5. **Detect.** Run the threshold search: 10 or more failures per source, account and five-minute bucket. [Verified] 8 rows, all High.
6. **Automate triage.** Run `soc_automation.py` with `SPLUNK_USER` and `SPLUNK_PASS` set. It authenticates, runs the search as a blocking job, fetches results, and writes `notes/soc_case_<timestamp>.md`.
7. **Review.** Read the case note and follow its recommended actions: look for a 4624 success after the failures, decide whether the source is expected, and block or lock if not.

# 8. Key Engineering Decisions

| Decision | Why (as documented) | Label |
|---|---|---|
| Host-only network for all attack traffic | Keeps simulation inside the lab (SECURITY.md, WALKTHROUGH phase 0) | Verified |
| Threshold of 10 failures in 5 minutes | Simple, explainable brute-force signal; README notes it was tuned on one run | Verified |
| Exclude 127.0.0.1 and ::1 | Removes local noise from the detection | Verified |
| Credentials only from environment variables | Restored script dropped a hard-coded default password (commit 5c6dd51) | Verified |
| `exec_mode=blocking` search job | One request waits for the search to finish, so no polling loop is needed | Inferred |
| Markdown case note instead of a ticket | Keeps the lab self-contained; README lists no ticketing integration | Verified |
| Two copies of the SPL (saved search and script constant) | The script version adds logon types, reasons, host and a severity grade | Verified |

# 9. Challenges and Solutions

| Challenge | Solution | Evidence |
|---|---|---|
| Screenshot file names with trailing spaces and a typo broke links | Renamed files and fixed paths | Commits 2026-03-29 to 2026-04-01 |
| Secrets risk in a public repo | Expanded `.gitignore`, added SECURITY.md, removed default password from script | Commits 2026-04-26 and 5c6dd51 |
| Script removed from the repo on 2026-04-01 | Restored on 2026-10-11 with env-only credentials | Commits 817482a and 5c6dd51 |
| Repo name and links drifted after a rename | Docs branch updates titles and links | Commit ba1347a (unmerged) |

[Inferred] Git history shows a lot of clean-up churn; the walkthrough's "Git troubleshooting" note (diverged branches, file names, `.gitignore`) matches it.

# 10. Current Limitations

[Verified] From the README:

- Single host, single tenant: assumes `index=main` and this lab's sourcetype.
- `SPLUNK_HOST` is hard-coded and TLS certificate verification is off.
- The threshold was tuned against one simulated attack, not baseline traffic.
- The case note is a local Markdown file; nothing goes to a ticketing system.

[Verified] Also from the code: the script exits with status 0 even when a request fails, and it counts the same failure under two account names.

# 11. Next Development Steps

1. [Recommended] Merge `docs/portfolio-review` into `main` after reviewing it.
2. [Recommended] Pull the latest `main` into your local folder, and decide whether to remove the older duplicate clone.
3. [Recommended] Fix the double count, for example by using the target account only (`mvindex(Account_Name, 1)`), then re-run and update the screenshots.
4. [Recommended] Reconcile the severity rule with the published case-note screenshot.
5. [Recommended] Return a non-zero exit code on failure so the script can run from a scheduler.
6. [Recommended] Add a 4624-after-4625 correlation search (success after failures), which the case note already tells analysts to check.

# 12. Career Relevance

| Role focus | What this project shows |
|---|---|
| Cybersecurity and SOC | Event ID 4625 analysis, SPL detection with thresholds, MITRE ATT&CK T1110 mapping, triage notes |
| AI Solutions Engineering | Honest, documented use of Claude as a working partner, with your own validation of every output |
| Enterprise automation | REST API integration, session-key auth, environment-based secrets, repeatable output |

# 13. Last Updated

| Field | Value |
|---|---|
| Last verified | 2026-10-26 |
| Verified against | GitHub `main` at c11e44c (2026-10-12) and `docs/portfolio-review` at ba1347a (2026-10-25) |
| Also read | 8 screenshots, local folder git metadata |
| Prepared by | Claude, for review by Khaneil Campbell |
