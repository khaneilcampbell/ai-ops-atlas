"""Markdown reports a person reads before deciding: the job analysis and the resume review."""

from .models import JobAnalysis, QualityReview, TailoredResume


def _bullets(items):
    return "\n".join(f"- {i}" for i in items) or "- None"


def analysis_markdown(a: JobAnalysis, url=None):
    salary = (f"${a.salary_min:,} – ${a.salary_max:,}" if a.salary_min and a.salary_max
              else "Not posted")
    rows = "\n".join(
        f"| {m.requirement} | {', '.join(m.evidence_ids) or '—'} | {m.alignment.capitalize()} | {m.note} |"
        for m in a.requirements_match
    )
    return f"""# Job Analysis: {a.company} · {a.position}

**Posting:** {url or 'local file'} · **Location:** {a.location} ({a.work_arrangement}) · **Salary:** {salary}

## Verdict
**Match score: {a.match_score}%** · **Priority: {a.priority.capitalize()}** · **Recommended version:** {a.recommended_version}

{a.score_reasoning}

## Top competencies
{_bullets(a.top_competencies)}

## Requirements match

| Requirement | Evidence | Alignment | Note |
|---|---|---|---|
{rows}

## Strongest qualifications
{_bullets(a.strongest_qualifications)}

## Missing qualifications
{_bullets(a.missing_qualifications)}

## Concerns
{_bullets(a.concerns)}

## Likely interview questions
{_bullets(a.interview_questions)}

## Decision
Tailor a resume: `python -m jobflow tailor <slug>` · Skip: `python -m jobflow status <slug> Skipped`
"""


def review_markdown(resume: TailoredResume, review: QualityReview, code_problems):
    findings = "\n".join(
        f"- **{f.location}:** “{f.claim}”. {f.problem} Suggested: “{f.suggested_rewrite}”"
        for f in review.unsupported_claims
    ) or "- None"
    verdict = "Ready for your approval" if review.verdict == "ready" and not code_problems else "Needs changes"
    return f"""# Resume Review

**Verdict: {verdict}**

## Fact checks run in code
{_bullets(code_problems) if code_problems else '- All passed: titles, employers, dates, projects, numbers and skills match the career database.'}

## Unsupported or overstated claims (AI review)
{findings}

## Confirm before using
{_bullets(resume.confirm + review.confirm_items)}

## Writing fixes
{_bullets(review.writing_fixes)}

## What changed from the base version
{_bullets(resume.changes)}

Edit `resume.json` if needed, then run `python -m jobflow render <slug>` to rebuild the DOCX and PDF.
Submitting the application is always done by you; afterwards run `python -m jobflow status <slug> Applied`.
"""
