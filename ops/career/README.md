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
     CLAIMS CHECK ................... scripts/check_claims.py (every claim cites a verified entry)
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
| `scripts/` | `init_private.py` (set up your private workspace), `validate_database.py` (find unfinished or unverified entries), `check_claims.py` (fact-check a tailored resume's claims manifest before you approve it), `build_tracker.py` (regenerate the tracker) |
| `docs/workflow.md` | Step-by-step guide to running the workflow |
| `jobflow/` | Python pipeline: fetch a posting, score it, tailor and fact-check a resume, render DOCX/PDF, update the tracker ([docs/automation.md](docs/automation.md)) |
| `n8n/` | Importable n8n workflow that sends job links into the pipeline |
| `examples/` | Fictional career database and posting used by the tests |
| `docs/roadmap.md` | Phases and what is done |

## Quick start

```bash
pip install -r requirements.txt
python scripts/init_private.py        # creates private/ (gitignored)
# fill in private/career-database/*.json from your resume
python scripts/validate_database.py   # repeat until clean
```

Then follow [docs/workflow.md](docs/workflow.md) to run your first application by hand, or
use the automated pipeline:

```bash
export ANTHROPIC_API_KEY=...
python -m jobflow analyze https://job-boards.greenhouse.io/<company>/jobs/<id>
python -m jobflow tailor <slug>      # resume + fact check; you approve it
```

See [docs/automation.md](docs/automation.md).

## Privacy

Personal data never goes in git. `private/`, generated `.docx`/`.pdf` files, and
`.env` files are gitignored. This repository holds only templates, prompts and code,
so it can be shared publicly as a portfolio project.

## Competencies demonstrated

Business process mapping · AI workflow orchestration · Prompt design with structured
output · API integration (Anthropic API, structured outputs) · Document automation · Human-in-the-loop approvals ·
Data modeling and validation

## Tech stack

| Component | Technology |
|---|---|
| AI analysis | Claude (Anthropic API with structured outputs and prompt caching) |
| Workflow automation | n8n (self-hosted) |
| Resume generation | Python (python-docx, LibreOffice for PDF) |
| Career database | Structured JSON + Markdown |
| Application tracker | Excel (openpyxl) |
| Document storage | Google Drive or local folders |
| Version control | GitHub, excluding personal data |
