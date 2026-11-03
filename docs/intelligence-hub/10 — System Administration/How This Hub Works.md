# How This Hub Works

Project Intelligence Hub, set up 2026-10-26. This is the maintenance guide.

## Layout

| Folder | Holds |
|---|---|
| 00 — Executive Dashboard | Master Project Portfolio, Weekly Progress Review, Project Roadmap (built in Step 9) |
| 01 to 05 | One folder per project, named `<id> <Project Name>` |
| 06 — Learning & Engineering Notes | Topic notes: Python, APIs & Integrations, AI Agents, MCP, Cloud Infrastructure, Cybersecurity |
| 07 — Architecture & Visualizations | Cross-project diagrams |
| 08 — Career Portfolio & Interview Preparation | Career material, including car-01 |
| 09 — Templates | Markdown skeletons for the five project documents, and project.example.json |
| 10 — System Administration | Project Registry, Update Logs, Automation Scripts, Backups |

## Inside a project folder

```
sec-01 SOC Automation and Detection Engineering Lab/
├── 01 Project Overview.docx           ← read these
├── 02 Technical Deep Dive.docx
├── 03 Engineering Learning Guide.docx
├── 04 Development Journal.docx
├── 05 Project Roadmap.docx
└── Source/                            ← the source of truth, edit here
    ├── project.json                   ← id, repo, last verified, last synced commit
    ├── 01 Project Overview.md … 05 Project Roadmap.md
    └── *.svg / *.png                  ← diagrams
```

## Rules

- One canonical ID per project (`ai-`, `au-`, `sec-`, `web-`, `biz-`, `car-` plus a number). The registry is the list of record.
- Every statement is labeled [Verified], [Inferred] or [Recommended].
- No credentials, tokens, account data or personal data in any document.
- The Development Journal is append-only.
- Nothing runs on a schedule unless you approve it.
- `local_folder` in project.json is a folder name inside ~/Documents, never a full path.
- GitHub (public repo khaneilcampbell/project-intelligence-hub): only project documents, templates and scripts are published. The registry, update logs and backups stay on this Mac only.

## Updating a project (manual sync)

1. Ask Claude to sync a project. It compares GitHub and your local folder with `last_synced_commit` in `Source/project.json` and proposes changes.
2. You approve the changes; Claude edits the Markdown in `Source/` and appends a journal entry.
3. Claude copies the current DOCX files to `Backups/<date>/`, then rebuilds them with `Automation Scripts/build_docs.py <project folder>`. Nothing for you to run.

## Document format: DOCX (decided 2026-10-26)

The documents are DOCX, not .pages. KC chose this on 2026-10-26 after Pages Creator Studio 15.4 could not be scripted reliably. DOCX opens in Pages, Word, Preview and Google Docs, and Claude can rebuild it directly.

- Read the documents in any app. If you edit one in Pages, Pages will offer to save a .pages copy; your edits then live only in that copy, so tell Claude what to change in `Source/` instead.
- The Markdown in `Source/` stays the source of truth; the DOCX files are generated from it.
- The old Pages converter is kept, disabled, in `Automation Scripts/Retired/` for reference.
