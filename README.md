# AI-Powered Career Application Optimization System

A human-in-the-loop AI workflow that turns a job posting into an accurate,
tailored, ATS-readable resume in 10-15 minutes, and tracks every application
from submission to interview.

It is built around one principle: **the AI may re-angle facts, but never invent them.**
Every resume claim must trace back to a verified entry in a structured career database.

## Architecture

```
       JOB POSTING
            │
            ▼
  AI JOB DESCRIPTION ANALYSIS ........ prompts/job-analysis.md
            │
            ▼
     RESUME MATCHING ................. career-database/ (verified facts)
            ├── Required Skills
            ├── Preferred Skills
            ├── Experience Gaps
            └── Match Assessment
            │
            ▼
     RESUME TAILORING ................ resume-versions/ + prompts/resume-tailoring-assistant.md
            ├── Professional Summary
            ├── Experience Bullets
            ├── Relevant Projects
            └── Technical Skills
            │
            ▼
      QUALITY CONTROL ................ prompts/quality-review.md + templates/quality-checklist.md
            ├── Accuracy Verification
            ├── ATS Readability
            ├── Grammar Review
            └── Formatting
            │
            ▼
   FINAL RESUME (DOCX + PDF) ......... ⏸ human approval
            │
            ▼
     JOB APPLICATION ................. submitted manually
            │
            ▼
   APPLICATION TRACKER ............... tracker/ (Excel + dashboard)
            │
            ▼
  INTERVIEW PREPARATION .............. templates/interview-prep.md
```

## Repository layout

| Path | What it is |
|---|---|
| `career-database/templates/` | JSON schema-by-example for the master career database: profile, experience, skills, projects, education, preferences, and the **accomplishment bank** |
| `prompts/resume-tailoring-assistant.md` | The reusable Claude Project instruction that runs the full workflow |
| `prompts/job-analysis.md`, `prompts/quality-review.md` | Single-stage prompts with structured output, ready for automation |
| `resume-versions/` | Strategies for the three base resumes: AI Solutions, Enterprise Technology, Security & Automation |
| `templates/` | Quality checklist, job analysis report, interview prep |
| `tracker/application_tracker_template.xlsx` | Application tracker with dropdowns, follow-up highlighting, and a dashboard (volume, interview conversion, target salary, resume-version performance) |
| `scripts/` | `init_private.py` (set up your private workspace), `validate_database.py` (find unfinished or unverified entries), `build_tracker.py` (regenerate the tracker) |
| `docs/workflow.md` | Step-by-step guide to running the workflow |
| `docs/roadmap.md` | Phases, including the planned n8n + Python automation |

## Quick start

```bash
pip install -r requirements.txt
python scripts/init_private.py        # creates private/ (gitignored)
# fill in private/career-database/*.json from your resume
python scripts/validate_database.py   # repeat until clean
```

Then follow [docs/workflow.md](docs/workflow.md) to configure the Claude Project and
run your first application.

## Privacy

Personal data never goes in git. `private/`, generated `.docx`/`.pdf` files, and
`.env` files are gitignored. This repository holds only templates, prompts and code,
so it can be shared publicly as a portfolio project.

## Competencies demonstrated

Business process mapping · AI workflow orchestration · Prompt design with structured
output · API integration (planned) · Document automation · Human-in-the-loop approvals ·
Data modeling and validation

## Tech stack

| Component | Technology |
|---|---|
| AI analysis | Claude (Claude Projects; Anthropic API in Phase 3) |
| Workflow automation | n8n (Phase 3) |
| Resume generation | Python |
| Career database | Structured JSON + Markdown |
| Application tracker | Excel (openpyxl) |
| Document storage | Google Drive or local folders |
| Version control | GitHub, excluding personal data |
