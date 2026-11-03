"""Build the Excel application tracker.

    python scripts/build_tracker.py                      # data-free template (committed)
    python scripts/build_tracker.py private/tracker.xlsx # your personal copy (gitignored)

The workbook has three sheets:
  Applications  one row per job, with dropdowns and highlighting
  Dashboard     volume, interview conversion, salary and resume-version performance
  Lists         dropdown values; edit these to change the options
"""

import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "tracker" / "application_tracker_template.xlsx"
MAX_ROW = 1000

# (header, width, example value)
COLUMNS = [
    ("Company", 22, "Sony Music (example)"),
    ("Position", 30, "Business Solutions Specialist"),
    ("Industry", 16, "Music"),
    ("Location", 14, "NYC"),
    ("Work Arrangement", 17, "Unconfirmed"),
    ("Salary Min", 12, 100000),
    ("Salary Max", 12, 110000),
    ("Match Score", 12, 0.85),
    ("Priority", 10, "High"),
    ("Application Status", 18, "Not Applied"),
    ("Resume Version", 22, "AI Solutions"),
    ("Application Date", 15, None),
    ("Follow-up Date", 15, None),
    ("Interview Status", 16, "—"),
    ("Job Posting URL", 30, "https://example.com/job-posting"),
    ("Notes", 40, "Gap: Airtable. Developing: business process mapping."),
]
COL = {name: get_column_letter(i + 1) for i, (name, _, _) in enumerate(COLUMNS)}

LISTS = {
    "Work Arrangement": ["Hybrid", "Remote", "Onsite", "Unconfirmed"],
    "Priority": ["High", "Medium", "Low", "Skip"],
    "Application Status": [
        "Not Applied", "Applied", "Recruiter Screen", "Interviewing",
        "Offer", "Rejected", "Withdrawn", "Skipped",
    ],
    "Resume Version": ["AI Solutions", "Enterprise Technology", "Security & Automation"],
    "Interview Status": ["—", "Scheduled", "Completed", "Advanced", "Not Selected"],
}
APPLIED = ["Applied", "Recruiter Screen", "Interviewing", "Offer", "Rejected", "Withdrawn"]
INTERVIEWED = ["Recruiter Screen", "Interviewing", "Offer"]

NAVY = "1F3864"
HEADER_FILL = PatternFill("solid", fgColor=NAVY)
HEADER_FONT = Font(bold=True, color="FFFFFF")
THIN = Side(style="thin", color="BFBFBF")


def rng(column):
    return f"Applications!${COL[column]}$2:${COL[column]}${MAX_ROW}"


def array_const(values):
    return "{" + ",".join(f'"{v}"' for v in values) + "}"


def build_lists(wb):
    ws = wb.create_sheet("Lists")
    for c, (name, values) in enumerate(LISTS.items(), start=1):
        letter = get_column_letter(c)
        ws.cell(1, c, name).font = Font(bold=True)
        for r, v in enumerate(values, start=2):
            ws.cell(r, c, v)
        ws.column_dimensions[letter].width = 24
    return {name: f"Lists!${get_column_letter(c)}$2:${get_column_letter(c)}${len(v) + 1}"
            for c, (name, v) in enumerate(LISTS.items(), start=1)}


def build_applications(ws, list_refs, with_example):
    ws.title = "Applications"
    for c, (name, width, _) in enumerate(COLUMNS, start=1):
        cell = ws.cell(1, c, name)
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(c)].width = width
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = "C2"

    if with_example:
        for c, (name, _, value) in enumerate(COLUMNS, start=1):
            ws.cell(2, c, value)

    # Formats
    for r in range(2, MAX_ROW + 1):
        ws[f"{COL['Salary Min']}{r}"].number_format = '$#,##0'
        ws[f"{COL['Salary Max']}{r}"].number_format = '$#,##0'
        ws[f"{COL['Match Score']}{r}"].number_format = '0%'
        ws[f"{COL['Application Date']}{r}"].number_format = 'yyyy-mm-dd'
        ws[f"{COL['Follow-up Date']}{r}"].number_format = 'yyyy-mm-dd'
        ws[f"{COL['Notes']}{r}"].alignment = Alignment(wrap_text=True, vertical="top")

    # Dropdowns
    for name, ref in list_refs.items():
        dv = DataValidation(type="list", formula1=f"={ref}", allow_blank=True)
        dv.error, dv.errorTitle = "Pick a value from the list (edit options on the Lists sheet).", "Invalid value"
        ws.add_data_validation(dv)
        dv.add(f"{COL[name]}2:{COL[name]}{MAX_ROW}")
    score = DataValidation(type="decimal", operator="between", formula1="0", formula2="1", allow_blank=True)
    score.error = "Enter a percentage between 0% and 100%."
    ws.add_data_validation(score)
    score.add(f"{COL['Match Score']}2:{COL['Match Score']}{MAX_ROW}")

    # Highlighting
    area = f"A2:{get_column_letter(len(COLUMNS))}{MAX_ROW}"
    status, follow = COL["Application Status"], COL["Follow-up Date"]
    ws.conditional_formatting.add(area, FormulaRule(
        formula=[f'AND(${follow}2<>"",${follow}2<=TODAY(),OR(${status}2="Applied",${status}2="Recruiter Screen",${status}2="Interviewing"))'],
        fill=PatternFill("solid", fgColor="FCE4D6")))
    ws.conditional_formatting.add(area, FormulaRule(
        formula=[f'${status}2="Offer"'], fill=PatternFill("solid", fgColor="E2EFDA")))
    ws.conditional_formatting.add(area, FormulaRule(
        formula=[f'OR(${status}2="Rejected",${status}2="Withdrawn",${status}2="Skipped")'],
        font=Font(color="808080")))
    ms = COL["Match Score"]
    ws.conditional_formatting.add(f"{ms}2:{ms}{MAX_ROW}", CellIsRule(
        operator="greaterThanOrEqual", formula=["0.8"], font=Font(bold=True, color="375623")))
    ws.conditional_formatting.add(f"{ms}2:{ms}{MAX_ROW}", CellIsRule(
        operator="between", formula=["0.0001", "0.6999"], font=Font(color="C00000")))

    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{MAX_ROW}"


def build_dashboard(wb):
    ws = wb.create_sheet("Dashboard", 0)
    ws.column_dimensions["A"].width = 34
    for letter in "BCDE":
        ws.column_dimensions[letter].width = 18
    ws["A1"] = "Application Dashboard"
    ws["A1"].font = Font(bold=True, size=16, color=NAVY)
    ws["A2"] = "Updates automatically from the Applications sheet."
    ws["A2"].font = Font(italic=True, color="808080")

    company, status = rng("Company"), rng("Application Status")
    applied = f"SUMPRODUCT(COUNTIF({status},{array_const(APPLIED)}))"
    interviewed = f"SUMPRODUCT(COUNTIF({status},{array_const(INTERVIEWED)}))"
    metrics = [
        ("Roles tracked", f"=COUNTA({company})", "0"),
        ("Applications submitted", f"={applied}", "0"),
        ("Interviews (screen or later)", f"={interviewed}", "0"),
        ("Interview conversion", f"=IFERROR({interviewed}/{applied},0)", "0%"),
        ("Offers", f'=COUNTIF({status},"Offer")', "0"),
        ("High-priority roles not yet applied",
         f'=COUNTIFS({rng("Priority")},"High",{status},"Not Applied")', "0"),
        ("Follow-ups due",
         f'=SUMPRODUCT(({rng("Follow-up Date")}<>"")*({rng("Follow-up Date")}<=TODAY())'
         f'*(({status}="Applied")+({status}="Recruiter Screen")+({status}="Interviewing")))', "0"),
        ("Average match score", f'=IFERROR(AVERAGEIF({rng("Match Score")},">0"),0)', "0%"),
        ("Average target salary (midpoint)",
         f'=IFERROR(SUMPRODUCT(({rng("Salary Min")}>0)*({rng("Salary Max")}>0),'
         f'({rng("Salary Min")}+{rng("Salary Max")})/2)'
         f'/SUMPRODUCT(({rng("Salary Min")}>0)*({rng("Salary Max")}>0)),0)', "$#,##0"),
    ]
    for r, (label, formula, fmt) in enumerate(metrics, start=4):
        ws.cell(r, 1, label).border = Border(bottom=THIN)
        cell = ws.cell(r, 2, formula)
        cell.number_format, cell.font, cell.border = fmt, Font(bold=True), Border(bottom=THIN)

    top = 4 + len(metrics) + 2
    ws.cell(top, 1, "Resume version performance").font = Font(bold=True, size=13, color=NAVY)
    headers = ["Resume version", "Applied", "Interviews", "Conversion", "Avg match score"]
    for c, h in enumerate(headers, start=1):
        cell = ws.cell(top + 1, c, h)
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
    version = rng("Resume Version")
    for i, v in enumerate(LISTS["Resume Version"]):
        r = top + 2 + i
        ws.cell(r, 1, v)
        ws.cell(r, 2, f"=SUMPRODUCT(COUNTIFS({version},A{r},{status},{array_const(APPLIED)}))")
        ws.cell(r, 3, f"=SUMPRODUCT(COUNTIFS({version},A{r},{status},{array_const(INTERVIEWED)}))")
        ws.cell(r, 4, f"=IFERROR(C{r}/B{r},0)").number_format = "0%"
        ws.cell(r, 5, f'=IFERROR(AVERAGEIFS({rng("Match Score")},{version},A{r},{rng("Match Score")},">0"),0)').number_format = "0%"

    top = top + 2 + len(LISTS["Resume Version"]) + 1
    ws.cell(top, 1, "Pipeline by status").font = Font(bold=True, size=13, color=NAVY)
    for c, h in enumerate(["Status", "Count"], start=1):
        cell = ws.cell(top + 1, c, h)
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
    for i, s in enumerate(LISTS["Application Status"]):
        r = top + 2 + i
        ws.cell(r, 1, s)
        ws.cell(r, 2, f"=COUNTIF({status},A{r})")


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    wb = Workbook()
    apps = wb.active
    list_refs = build_lists(wb)
    build_applications(apps, list_refs, with_example=True)
    build_dashboard(wb)
    wb.active = wb.sheetnames.index("Applications")
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
