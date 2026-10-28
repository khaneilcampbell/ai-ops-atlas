# Automation (Phase 3)

The `jobflow` package runs the workflow from the command line with the Anthropic API.
It reads your career database from `private/` and writes everything for one job into
`private/applications/<company>-<position>/`. Nothing is ever submitted for you.

## Setup

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...     # or put it in your shell profile; never commit it
# optional: LibreOffice (soffice) on PATH for the PDF copy and page count
```

Optional environment variables: `JOBFLOW_DATA` (data folder, default `private/`),
`JOBFLOW_MODEL` (default `claude-opus-5-5`), `JOBFLOW_EFFORT` (default `high`).

## Commands

```bash
python -m jobflow analyze <job-url-or-file>   # fetch, score, write analysis.md, add tracker row
python -m jobflow tailor <slug>               # tailor, fact-check, review, render DOCX/PDF
python -m jobflow render <slug>               # re-check and re-render after editing resume.json
python -m jobflow status <slug> Applied       # record status; Applied sets a 7-day follow-up
python -m jobflow list                        # everything analyzed so far
```

Typical run:

1. `analyze` the link. Read `analysis.md`: match score, gaps, concerns, and the
   recommended resume version. Greenhouse links use the public job board API, so salary
   ranges come through when the company publishes them.
2. If it is worth it, `tailor` it (add `--version security-automation` to override).
3. Read `review.md`. It lists two kinds of problems:
   - **Fact check (code):** deterministic checks against the career database. Titles,
     employers and dates must match exactly, no position may be dropped, every number
     must already exist in the database, every skill must be one you listed, and
     projects must be verified. Any problem here makes `tailor` exit with code 2.
   - **Quality review (Claude):** unsupported claims, items to confirm, and writing fixes.
4. Edit `resume.json` if needed and run `render`. Open the DOCX and approve it yourself.
5. Submit the application yourself, then `status <slug> Applied`.

## How the Claude calls work

- One system prompt (`prompts/system.md`) plus the whole career database as a cached
  block, so analysis, tailoring and review reuse the same prefix.
- Structured outputs: each call returns a Pydantic model (`jobflow/models.py`), so there
  is no JSON parsing by hand.
- Claude is told to cite database ids for every requirement match, and the code check
  runs on the result anyway. The model is never the only thing standing between you and
  an invented claim.

## n8n

`n8n/job-intake.workflow.json` is an importable workflow for a self-hosted n8n:
a form takes a job link, runs `jobflow analyze --json`, and reports whether the job is
worth tailoring. It stops there by design; tailoring and approval stay with you.
See [n8n/README.md](../n8n/README.md).

## Tests

`pytest` runs the full pipeline against the fictional data in `examples/` with a fake
Claude client, so CI needs no API key and no personal data.
