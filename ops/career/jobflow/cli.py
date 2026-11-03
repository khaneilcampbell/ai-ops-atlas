"""Command line for the workflow. Two human checkpoints are built in: nothing is
tailored until you run `tailor`, and nothing is ever submitted for you."""

import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

from . import tracker
from .database import CareerDatabase
from .models import JobAnalysis, TailoredResume

ROOT = Path(__file__).resolve().parent.parent
STATUSES = ["Not Applied", "Applied", "Recruiter Screen", "Interviewing", "Offer", "Rejected", "Withdrawn", "Skipped"]


def slugify(*parts):
    return re.sub(r"[^a-z0-9]+", "-", " ".join(parts).lower()).strip("-")[:80]


class Workspace:
    def __init__(self, data):
        self.data = Path(data)
        self.db_dir = self.data / "career-database"
        self.tracker = self.data / "application_tracker.xlsx"
        self.apps = self.data / "applications"

    def db(self):
        return CareerDatabase.load(self.db_dir)

    def app(self, slug):
        folder = self.apps / slug
        if not folder.is_dir():
            known = ", ".join(sorted(p.name for p in self.apps.glob("*") if p.is_dir())) or "none yet"
            raise SystemExit(f"No application '{slug}'. Known: {known}")
        return folder

    def update_tracker(self, fn, *args, **kwargs):
        if self.tracker.exists():
            fn(self.tracker, *args, **kwargs)
        else:
            print(f"(No tracker at {self.tracker}; run scripts/init_private.py to create one.)")


def cmd_analyze(ws, args, claude=None):
    from .fetch import fetch
    from .llm import Claude
    from .report import analysis_markdown

    posting, url = fetch(args.source)
    analysis = (claude or Claude(ws.db())).analyze(posting)
    folder = ws.apps / slugify(analysis.company, analysis.position)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "posting.txt").write_text(posting)
    (folder / "analysis.json").write_text(analysis.model_dump_json(indent=2))
    (folder / "meta.json").write_text(json.dumps({"url": url, "analyzed": date.today().isoformat()}, indent=2))
    (folder / "analysis.md").write_text(analysis_markdown(analysis, url))
    ws.update_tracker(tracker.from_analysis, analysis, url)
    if getattr(args, "json", False):  # one machine-readable line for n8n or other callers
        print(json.dumps({"slug": folder.name, "company": analysis.company, "position": analysis.position,
                          "match_score": analysis.match_score, "priority": analysis.priority,
                          "recommended_version": analysis.recommended_version, "report": str(folder / "analysis.md")}))
        return 0
    print(f"{analysis.company} · {analysis.position}: {analysis.match_score}% match, priority {analysis.priority}, "
          f"recommended version {analysis.recommended_version}")
    print(f"Report: {folder / 'analysis.md'}")
    print(f"Next: python -m jobflow tailor {folder.name}   (or: python -m jobflow status {folder.name} Skipped)")
    return 0


def _render(ws, folder, db, resume, analysis):
    from .render import build_docx, file_stem, to_pdf

    docx = build_docx(resume, db, folder / f"{file_stem(db, analysis.company, analysis.position)}.docx")
    pdf, pages = to_pdf(docx)
    print(f"Resume: {docx}" + (f" and {pdf.name} ({pages} page{'s' if pages != 1 else ''})" if pdf else " (install LibreOffice for the PDF)"))
    if pages and pages > 1:
        print("Warning: the resume runs past one page. Trim a bullet or project in resume.json and run render.")


def cmd_tailor(ws, args, claude=None):
    from . import verify
    from .llm import Claude
    from .report import review_markdown

    folder = ws.app(args.slug)
    analysis = JobAnalysis.model_validate_json((folder / "analysis.json").read_text())
    version = args.version or analysis.recommended_version
    strategy = (ROOT / "resume-versions" / f"{version}.md").read_text()
    db = ws.db()
    claude = claude or Claude(db)

    resume = claude.tailor(analysis, strategy)
    problems = verify.check(resume, db)
    review = claude.review(resume)

    (folder / "resume.json").write_text(resume.model_dump_json(indent=2))
    (folder / "review.md").write_text(review_markdown(resume, review, problems))
    _render(ws, folder, db, resume, analysis)
    meta = json.loads((folder / "meta.json").read_text())
    ws.update_tracker(tracker.from_analysis, analysis, meta.get("url"), version)

    blocking = problems or review.unsupported_claims
    print(f"Review: {folder / 'review.md'}  ({'needs changes' if blocking else 'ready for your approval'})")
    for p in problems:
        print(f"  - {p}")
    return 2 if blocking else 0


def cmd_render(ws, args):
    from . import verify

    folder = ws.app(args.slug)
    db = ws.db()
    resume = TailoredResume.model_validate_json((folder / "resume.json").read_text())
    analysis = JobAnalysis.model_validate_json((folder / "analysis.json").read_text())
    problems = verify.check(resume, db)
    for p in problems:
        print(f"  - {p}")
    _render(ws, folder, db, resume, analysis)
    return 2 if problems else 0


def cmd_status(ws, args):
    folder = ws.app(args.slug)
    a = JobAnalysis.model_validate_json((folder / "analysis.json").read_text())
    on = date.fromisoformat(args.date) if args.date else None
    ws.update_tracker(tracker.mark, a.company, a.position, args.status, on)
    print(f"{a.company} · {a.position}: {args.status}")
    return 0


def cmd_list(ws, args):
    for folder in sorted(p for p in ws.apps.glob("*") if (p / "analysis.json").exists()):
        a = JobAnalysis.model_validate_json((folder / "analysis.json").read_text())
        state = "tailored" if (folder / "resume.json").exists() else "analyzed"
        print(f"{folder.name:50} {a.match_score:>3}%  {a.priority:<6} {state}")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="jobflow", description=__doc__)
    parser.add_argument("--data", default=os.environ.get("JOBFLOW_DATA", ROOT / "private"),
                        help="Folder holding career-database/, application_tracker.xlsx and applications/ (default: private/)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("analyze", help="Fetch a posting and score it against the career database")
    p.add_argument("source", help="Job posting URL, or a .txt/.md/.html file")
    p.add_argument("--json", action="store_true", help="Print one JSON line instead of the summary (for n8n)")
    p = sub.add_parser("tailor", help="Tailor, fact-check and render a resume for an analyzed job")
    p.add_argument("slug")
    p.add_argument("--version", choices=list(tracker.VERSION_LABELS), help="Override the recommended resume version")
    p = sub.add_parser("render", help="Re-check and re-render resume.json after you edit it")
    p.add_argument("slug")
    p = sub.add_parser("status", help="Record an application status in the tracker")
    p.add_argument("slug")
    p.add_argument("status", choices=STATUSES)
    p.add_argument("--date", help="YYYY-MM-DD (default today, for Applied)")
    sub.add_parser("list", help="List analyzed applications")

    args = parser.parse_args(argv)
    ws = Workspace(args.data)
    handler = {"analyze": cmd_analyze, "tailor": cmd_tailor, "render": cmd_render,
               "status": cmd_status, "list": cmd_list}[args.command]
    try:
        return handler(ws, args)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 1
