# Roadmap

## Phase 1: Foundation ✅ done
- [x] Career database schema and templates
- [x] Reusable Claude tailoring prompt and stage prompts
- [x] Three resume version strategies
- [x] Quality checklist, job analysis and interview prep templates
- [x] Finalize master resume (resolve placeholders)
- [x] Fill and verify the career database and accomplishment bank
- [x] Generate and approve the three base resumes
- [x] Decide where tailoring runs (no separate Claude Project needed)

## Phase 2: Tracker and real use ✅ in use
- [x] Excel application tracker with dashboard
- [ ] Use the workflow on real applications and refine prompts based on output quality

## Phase 3: Automation (n8n + Python) ✅ built

```
Job link (CLI or n8n form)
        │
        ▼
 jobflow analyze: fetch posting ──► Claude (structured JobAnalysis) ──► analysis.md + tracker row
        │
        │            priority "skip"? ──► stop here
        ▼
 jobflow tailor: Claude (TailoredResume) ──► code fact check ──► Claude quality review
        │
        ▼
 Render DOCX + PDF (python-docx / LibreOffice)
        │
        ▼
 ⏸ HUMAN APPROVAL (review.md + the resume)
        │
        ▼
 You submit manually ──► jobflow status <slug> Applied (follow-up date set)
```

- [x] `jobflow/` package: fetch (Greenhouse API + generic pages), analyze, tailor, fact check, review, render, tracker
- [x] Deterministic fact check that blocks invented titles, dates, numbers and skills
- [x] Tests on fictional data with a fake Claude client; CI lint + tests
- [x] `n8n/job-intake.workflow.json`
- [ ] Run live on real postings and tune the prompts from the results
- [ ] Optional: cover letter and interview prep generation from the same analysis

Design rules that stay fixed: final approval and submission are always manual,
and personal data never leaves `private/` or your own storage.
