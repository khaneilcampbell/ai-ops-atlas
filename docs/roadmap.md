# Roadmap

## Phase 1: Foundation ✅ scaffolded
- [x] Career database schema and templates
- [x] Reusable Claude tailoring prompt and stage prompts
- [x] Three resume version strategies
- [x] Quality checklist, job analysis and interview prep templates
- [ ] Finalize master resume (resolve placeholders)
- [ ] Fill and verify the career database and accomplishment bank
- [ ] Generate and approve the three base resumes
- [ ] Configure the Claude Project

## Phase 2: Tracker and real use
- [x] Excel application tracker with dashboard
- [ ] Use the workflow on real applications and refine prompts based on output quality

## Phase 3: Automation (n8n + Python)

```
Tracker row added (job URL)
        │
        ▼
 n8n: fetch job description ──► Claude: prompts/job-analysis.md ──► JSON match assessment
        │                                                                │
        │                              score < threshold? ──► mark "Skip suggested", stop
        ▼
 Claude: tailor using version strategy + career database
        │
        ▼
 Claude: prompts/quality-review.md ──► flags unsupported claims
        │
        ▼
 Python: render DOCX + PDF (python-docx / LibreOffice) ──► Drive or local folder
        │
        ▼
 ⏸ HUMAN APPROVAL (review resume + flags)
        │
        ▼
 Update tracker: status, resume version, file link
        │
        ▼
 You submit the application manually
```

Planned components:
- `scripts/analyze_job.py`: call the Anthropic API with `job-analysis.md`, write JSON
- `scripts/render_resume.py`: structured resume JSON → ATS-safe DOCX and PDF
- `scripts/update_tracker.py`: append and update tracker rows
- `n8n/`: exported workflow JSON wiring the steps together

Design rules that stay fixed: final approval and submission are always manual,
and personal data never leaves `private/` or your own storage.
