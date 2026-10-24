# Running the Workflow (Manual, AI-Assisted)

Target: **10-15 minutes per application** once the database and base resumes are set up.
Complex applications take longer.

## One-time setup (Phase 1)

1. `pip install -r requirements.txt && python scripts/init_private.py`
2. Put your current resume in `private/resumes/master/`. Resolve any unfinished
   placeholders in it first: it becomes the source of truth.
3. Fill in `private/career-database/*.json`. Ask Claude to draft them from your
   resume, then review every entry and set `"verified": true` only once it's accurate.
4. Build the **accomplishment bank**: 10-20 entries in `accomplishments.json`, each
   with situation, action, result, and a metric *only if you can source it*.
5. Run `python scripts/validate_database.py` until it reports no issues.
6. Create a Claude Project. Paste `private/claude-project-instructions.md` (with the
   placeholders filled) into its instructions and upload the career database files,
   your master resume, and the three files in `resume-versions/`.
7. Ask Claude to generate the three base resumes, review them against
   `templates/quality-checklist.md`, and save the approved ones in `private/resumes/base/`.

## Per application (Phase 2)

| Step | You | Claude | Time |
|---|---|---|---|
| 1. Analyze | Paste the job description or link: "Run my resume tailoring workflow." | Extracts requirements, scores the match, recommends a version and priority | 2 min |
| 2. Decide | Go / skip. Prioritize strong-fit roles | Waits for your go-ahead | 1 min |
| 3. Tailor | Answer any `[CONFIRM: ...]` flags | Tailors summary, bullets, projects, skills | 3 min |
| 4. QA | Optionally run `prompts/quality-review.md` in a fresh chat | Fact-checks every claim against the database | 2 min |
| 5. Approve | Read the resume, tick the checklist, export DOCX + PDF | | 3 min |
| 6. Apply | Submit the application yourself | | varies |
| 7. Track | Paste the tracker row into `private/application_tracker.xlsx`, set a follow-up date (about 7 days) | Provides the row | 1 min |
| 8. Prep | When an interview lands, fill `templates/interview-prep.md` | Suggests questions mapped to your accomplishments | |

Save each application's files in `private/applications/<company>-<position>/`
(job description, analysis, final resume).

## Keep improving

After every 5-10 applications, review the Dashboard sheet: which resume version
converts best, what match score actually leads to interviews, which gaps keep
appearing. Update the accomplishment bank and version strategies accordingly.
