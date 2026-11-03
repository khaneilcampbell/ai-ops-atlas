"""Read and update the Excel application tracker built by scripts/build_tracker.py."""

from datetime import date, timedelta

from openpyxl import load_workbook

from .models import JobAnalysis

VERSION_LABELS = {
    "ai-solutions": "AI Solutions",
    "enterprise-technology": "Enterprise Technology",
    "security-automation": "Security & Automation",
}
FOLLOW_UP_DAYS = 7


def _columns(ws):
    return {cell.value: cell.column for cell in ws[1] if cell.value}


def _find_row(ws, cols, company, position):
    first_empty = None
    for r in range(2, ws.max_row + 1):
        c = ws.cell(r, cols["Company"]).value
        if not c:
            first_empty = first_empty or r
            continue
        if str(c).strip().lower() == company.lower() and str(ws.cell(r, cols["Position"]).value or "").strip().lower() == position.lower():
            return r, False
    return (first_empty or ws.max_row + 1), True


def upsert(path, company, position, **fields):
    """Create or update the row for company + position. Field names are the column headers."""
    wb = load_workbook(path)
    ws = wb["Applications"]
    cols = _columns(ws)
    row, new = _find_row(ws, cols, company, position)
    values = {"Company": company, "Position": position, **fields}
    if new:
        values.setdefault("Application Status", "Not Applied")
        values.setdefault("Interview Status", "—")
    for header, value in values.items():
        if header not in cols:
            raise KeyError(f"Tracker has no '{header}' column")
        ws.cell(row, cols[header], value)
    wb.save(path)
    return row


def from_analysis(path, a: JobAnalysis, url=None, version=None):
    notes = "; ".join(filter(None, [
        "Gaps: " + ", ".join(a.missing_qualifications[:4]) if a.missing_qualifications else "",
        "Concerns: " + ", ".join(a.concerns[:2]) if a.concerns else "",
    ]))
    return upsert(
        path, a.company, a.position,
        **{
            "Industry": a.industry,
            "Location": a.location,
            "Work Arrangement": a.work_arrangement.capitalize(),
            "Salary Min": a.salary_min,
            "Salary Max": a.salary_max,
            "Match Score": a.match_score / 100,
            "Priority": a.priority.capitalize(),
            "Resume Version": VERSION_LABELS[version or a.recommended_version],
            "Job Posting URL": url,
            "Notes": notes[:500],
        },
    )


def mark(path, company, position, status, on=None):
    """Record a status change. Marking 'Applied' sets the application and follow-up dates."""
    fields = {"Application Status": status}
    if status == "Applied":
        on = on or date.today()
        fields.update({"Application Date": on, "Follow-up Date": on + timedelta(days=FOLLOW_UP_DAYS)})
    return upsert(path, company, position, **fields)
