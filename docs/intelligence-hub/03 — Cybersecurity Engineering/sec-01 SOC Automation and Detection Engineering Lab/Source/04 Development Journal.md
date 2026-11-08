---
title: SOC Automation and Detection Engineering Lab
subtitle: Development Journal · sec-01
---

| Project ID | Entries | Evidence | Last verified |
|---|---|---|---|
| sec-01 | 9, oldest first | 55 commits across `main` and `docs/portfolio-review`, plus screenshots | 2026-10-26 |

**How this journal works.** Each entry is reconstructed from git history, so **Work completed** and **Files changed** are always verified. Fields that git cannot show (objectives, problems, testing) are marked [Inferred] or "Not recorded". Entries are never rewritten; corrections are added as new entries. New entries go at the end.

# 2026-03-29 · Lab run and first commit

| Field | Entry |
|---|---|
| Objective | [Inferred] Run the lab end to end and capture evidence |
| Work completed | [Verified] Initial commit with 8 screenshots; two rounds of renaming them to `01.` to `08.` |
| Files changed | `screenshots/*`, `configs/.gitkeep`, `notes/.gitkeep`, `.DS_Store` |
| Technical decisions | [Verified] Numbered screenshot names matching lab phases |
| Problems encountered | [Verified] Trailing spaces and a "kaili" typo in file names (fixed 2026-04-01) |
| Solutions implemented | Not recorded that day |
| Testing performed | [Verified] WALKTHROUGH.md names the generated note `soc_case_20260329_150145.md`, so the script ran this day |
| Remaining issues | [Verified] The script itself was not committed |
| Next recommended action | Add documentation |

# 2026-03-30 · Documentation and detection query

| Field | Entry |
|---|---|
| Objective | [Inferred] Make the lab readable on GitHub |
| Work completed | [Verified] Added README, WALKTHROUGH and `.gitignore`; corrected Windows 10 to Windows 11; embedded screenshots; added the SPL query |
| Files changed | `README.md`, `WALKTHROUGH.md`, `.gitignore`, `queries/brute_force_detection.spl` |
| Technical decisions | [Verified] Saved the threshold search as a standalone `.spl` file |
| Problems encountered | [Verified] README and WALKTHROUGH first landed inside folders of the same name; screenshot paths broke |
| Solutions implemented | [Verified] Moved files to the root; fixed paths |
| Testing performed | Not recorded |
| Remaining issues | File name typos |
| Next recommended action | Clean up repository structure |

# 2026-03-31 to 2026-04-01 · Repository clean-up and script add/remove

| Field | Entry |
|---|---|
| Objective | [Inferred] Tidy the repository and publish the automation script |
| Work completed | [Verified] Removed `.DS_Store`, empty `configs/` and `notes/`, a stray `.spl.rtf`; rewrote `.gitignore` three times; fixed file name typos and trailing spaces; added `soc_automation.py`, then removed it the same day |
| Files changed | `.gitignore`, `README.md`, `WALKTHROUGH.md`, `screenshots/*`, `soc_automation.py` |
| Technical decisions | [Verified] Project-specific `.gitignore` rules |
| Problems encountered | [Verified] The added script contained fallback credentials (`admin` and a placeholder password) |
| Solutions implemented | [Inferred] The script was removed, possibly for that reason. The commit message does not say why |
| Testing performed | Not recorded |
| Remaining issues | Repository had no automation script from 2026-04-01 to 2026-10-11 |
| Next recommended action | Restore the script without default credentials |

# 2026-04-05 · README update

| Field | Entry |
|---|---|
| Work completed | [Verified] One README edit (commit c4803ab) |
| Files changed | `README.md` |
| Other fields | Not recorded |

# 2026-04-26 · Security baseline and governance experiment

| Field | Entry |
|---|---|
| Objective | [Inferred] Make the public repository safe and professional |
| Work completed | [Verified] Added SECURITY.md and GitHub hardening guidance; briefly added CI workflows, issue templates, Dependabot, CODEOWNERS, changelog and licence, then removed them the same day to "streamline repo to core lab files"; refined secret patterns in `.gitignore` |
| Files changed | `SECURITY.md`, `.gitignore`, `README.md`, `WALKTHROUGH.md`, `.github/*` (added then deleted) |
| Technical decisions | [Verified] Keep the repository to core lab files only |
| Problems encountered | [Verified] An accidental `testfile.gz` was committed |
| Solutions implemented | [Verified] Removed it in the next commit |
| Testing performed | Not recorded |
| Remaining issues | No CI after the streamlining |
| Next recommended action | Restore the script |

[Verified] Your local clone stops at this date (e7f4385).

# 2026-10-11 · Script restored and AI assistance disclosed

| Field | Entry |
|---|---|
| Objective | [Inferred] Make the automation claim verifiable for the portfolio |
| Work completed | [Verified] Restored `soc_automation.py` with credentials from environment variables only and an early exit when they are missing; removed an organization name from the console banner; added "Built with AI Assistance" and CONTRIBUTING.md |
| Files changed | `soc_automation.py`, `README.md`, `CONTRIBUTING.md` |
| Technical decisions | [Verified] No default credentials in code |
| Problems encountered | Not recorded |
| Solutions implemented | As above |
| Testing performed | Not recorded; [Inferred] no screenshot was regenerated |
| Remaining issues | Severity rule in code does not match screenshot 07 |
| Next recommended action | Licence and title clean-up |

# 2026-10-12 · Licence and title

| Field | Entry |
|---|---|
| Work completed | [Verified] Cleaned up the README title (PR #6); added MIT licence (PR #7) |
| Files changed | `README.md`, `LICENSE` |
| Other fields | Not recorded |

# 2026-10-24 to 2026-10-25 · Portfolio review branch (unmerged)

| Field | Entry |
|---|---|
| Objective | [Verified] Portfolio review: accurate status, limitations and links |
| Work completed | [Verified] Restructured README with Status, Detection logic, Running the automation and Limitations; declared `requests>=2.31`; unblocked `.github` in `.gitignore`; updated titles and links after repository renames |
| Files changed | `README.md`, `requirements.txt`, `.gitignore` |
| Technical decisions | [Verified] Document both SPL versions and require keeping them in step |
| Problems encountered | [Verified] Links pointed at old repository names |
| Solutions implemented | [Verified] Links updated |
| Testing performed | Not recorded |
| Remaining issues | [Verified] Branch not merged into `main` as of 2026-10-26 |
| Next recommended action | Review and merge |

# 2026-10-26 · Project Intelligence Hub documentation created

| Field | Entry |
|---|---|
| Objective | [Verified] Pilot project for the Project Intelligence Hub |
| Work completed | [Verified] Created the five hub documents from the repository, history and screenshots. No project files were changed |
| Files changed | Hub only: `03 — Cybersecurity Engineering/sec-01 SOC Automation and Detection Engineering Lab/` |
| Technical decisions | [Verified] Documented from GitHub, because the local folder is behind |
| Problems encountered | [Verified] Found the double count, the severity mismatch and the 81 versus 80 event difference |
| Solutions implemented | Recorded as roadmap items, not changed in code |
| Testing performed | Viewed screenshots 05 and 07 against the code |
| Remaining issues | See Project Roadmap |
| Next recommended action | Merge the docs branch, then fix the double count |

# 2026-10-26 · Hub name changed

| Field | Entry |
|-----|------------------|
| Work completed | [Verified] At your request, the hub now uses the lab's current name, "SOC Automation and Detection Engineering Lab", matching the repository README and your profile. The repository slug stays `splunk-bruteforce-detection-lab` |
| Next recommended action | None |
