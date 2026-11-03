# Project Intelligence Hub

Documentation for Khaneil Campbell's engineering projects: one folder per project, five documents each.

| Document | What it covers |
|---|---|
| 01 Project Overview | What the project is, its status, and a five-minute reorientation |
| 02 Technical Deep Dive | Architecture, data flow, security and failure modes |
| 03 Engineering Learning Guide | The concepts behind the project, from beginner to enterprise, with self-test questions |
| 04 Development Journal | Dated history reconstructed from git, with verified and inferred entries labeled |
| 05 Project Roadmap | Prioritized next steps, portfolio readiness and interview readiness |

Every statement is labeled **[Verified]**, **[Inferred]** or **[Recommended]**. No deadlines or completion percentages are invented.

## Projects published here

| ID | Project | Folder |
|---|---|---|
| sec-01 | SOC Automation and Detection Engineering Lab | [03 — Cybersecurity Engineering](03%20—%20Cybersecurity%20Engineering/) |

More projects are added as they are documented and reviewed.

## How it is built

The Markdown in each project's `Source/` folder is the source of truth. `10 — System Administration/Automation Scripts/build_docs.py` renders it to styled DOCX with pandoc and python-docx. See [How This Hub Works](10%20—%20System%20Administration/How%20This%20Hub%20Works.md).

This public repository contains documents, templates and scripts only. The project registry, update logs and backups are kept locally.

Documents are prepared with Claude and reviewed by the project owner.
