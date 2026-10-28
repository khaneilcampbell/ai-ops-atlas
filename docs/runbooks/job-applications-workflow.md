# Runbooks: AI Career Application Optimization System

Repository: [khaneilcampbell/job-applications-workflow](https://github.com/khaneilcampbell/job-applications-workflow) (private). Personal data lives only in the git-ignored `private/` folder on KC's machine. The repository's own guides: `docs/workflow.md` (by hand in a Claude Project) and `docs/automation.md` (the `jobflow` command line).

## Job analysis, tailoring and quality review

The three prompts in `prompts/` can be run by hand in a Claude Project, or by `jobflow`, which sends them to the Anthropic API with the career database as a cached block and structured outputs.

- **Run it:** `python -m jobflow analyze <job-url-or-file>`, then `python -m jobflow tailor <slug>`. Read `analysis.md` and `review.md` in `private/applications/<slug>/`, edit `resume.json` if needed, `python -m jobflow render <slug>`, and approve the DOCX yourself. Nothing is ever submitted for you.
- **Needs:** `ANTHROPIC_API_KEY` in the environment. Optional `JOBFLOW_MODEL` (default `claude-opus-5-5`) and `JOBFLOW_EFFORT` (default `high`).
- **When it fails:** `tailor` exits with code 2 when the code fact check finds a problem (title, employer, date, number, skill or project not in the database); fix the resume or the database and run `render`. A refusal is reported as such and nothing is written.
- **n8n intake (optional):** `n8n/job-intake.workflow.json` runs `jobflow analyze --json` from a form on a self-hosted n8n. It stops after analysis by design.
- **Stop it:** don't run it, or unset the API key. Nothing runs on a schedule.

## Career Database Validator

`scripts/validate_database.py`.

- **Run it:** `python scripts/validate_database.py` (checks `private/career-database`), or pass another folder.
- **Healthy:** prints that the database is complete and verified and exits 0.
- **When it fails:** it lists each problem (invalid JSON, TODO placeholders, entries with `"verified": false`, metrics with no source, broken ids). Fix them and run it again.

## Career Workflow CI

`.github/workflows/ci.yml`.

- **Healthy:** latest run on `main` is green.
- **When it fails:** reproduce with `pip install -r requirements-dev.txt && pytest -q`. The "No personal data committed" step fails if anything under `private/` or `output/`, a `.docx`, `.pdf` or `.env` file is tracked: remove it from git (and from history if it was pushed).
- **Blank tracker:** run the workflow by hand with **tracker** ticked and download the artifact.
- **Stop it:** disable the workflow in Actions.
