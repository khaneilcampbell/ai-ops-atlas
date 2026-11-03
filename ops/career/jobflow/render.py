"""Render a TailoredResume as an ATS-safe DOCX (single column, standard headings,
all text black) and, when LibreOffice is installed, a PDF."""

import re
import shutil
import subprocess
from pathlib import Path

from docx import Document
from docx.enum.text import WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

from .database import CareerDatabase
from .models import TailoredResume

FONT, SIZE = "Calibri", 10
BLACK = RGBColor(0, 0, 0)
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def month(value):
    m = re.fullmatch(r"(\d{4})-(\d{2})(?:-\d{2})?", value or "")
    if m:
        return f"{MONTHS[int(m[2]) - 1]} {m[1]}"
    return "Present" if (value or "").lower() == "present" else value


def file_stem(db: CareerDatabase, company: str, position: str):
    """FirstName_LastName_Company_Position_Resume"""
    name = db.profile.get("name", {})
    parts = [name.get("first", ""), name.get("last", ""), company, position, "Resume"]
    return "_".join(re.sub(r"[^A-Za-z0-9]+", "_", p).strip("_") for p in parts if p)


class _Doc:
    def __init__(self):
        self.doc = Document()
        style = self.doc.styles["Normal"]
        style.font.name, style.font.size, style.font.color.rgb = FONT, Pt(SIZE), BLACK
        style.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        s = self.doc.sections[0]
        s.page_width, s.page_height = Inches(8.5), Inches(11)
        s.left_margin = s.right_margin = Inches(0.6)
        s.top_margin = s.bottom_margin = Inches(0.45)

    def para(self, text="", bold=False, size=SIZE, center=False, before=0, after=0):
        p = self.doc.add_paragraph()
        pf = p.paragraph_format
        pf.space_before, pf.space_after, pf.line_spacing = Pt(before), Pt(after), 1.0
        if center:
            p.alignment = 1
        if text:
            self.run(p, text, bold, size)
        return p

    @staticmethod
    def run(p, text, bold=False, size=SIZE):
        r = p.add_run(text)
        r.bold, r.font.size, r.font.color.rgb = bold, Pt(size), BLACK
        return r

    def heading(self, text):
        p = self.para(text.upper(), bold=True, size=10.5, before=5, after=1)
        border = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        for k, v in (("val", "single"), ("sz", "6"), ("space", "1"), ("color", "000000")):
            bottom.set(qn(f"w:{k}"), v)
        border.append(bottom)
        p._p.get_or_add_pPr().append(border)

    def split_line(self, left, right, bold=True, before=0):
        p = self.para(before=before)
        p.paragraph_format.tab_stops.add_tab_stop(Inches(7.3), WD_TAB_ALIGNMENT.RIGHT)
        self.run(p, left, bold)
        self.run(p, "\t" + right)

    def bullet(self, text):
        p = self.doc.add_paragraph(style="List Bullet")
        pf = p.paragraph_format
        pf.space_before = pf.space_after = Pt(0)
        pf.line_spacing = 1.0
        pf.left_indent, pf.first_line_indent = Inches(0.2), Inches(-0.15)
        self.run(p, text)


def build_docx(resume: TailoredResume, db: CareerDatabase, path: Path):
    d = _Doc()
    prof = db.profile
    name = prof.get("name", {})
    links = prof.get("links", {})
    d.para(f"{name.get('first', '')} {name.get('last', '')}".upper(), bold=True, size=18, center=True)
    d.para("  |  ".join(x for x in (prof.get("location"), prof.get("email"), prof.get("phone")) if x), center=True)
    d.para("  |  ".join(v for v in (links.get("linkedin"), links.get("github"), links.get("portfolio")) if v),
           center=True, after=2)

    d.heading("Summary")
    d.para(resume.summary)

    d.heading("Professional Experience")
    for i, e in enumerate(resume.experience):
        dates = f"{month(e.start)} – {month(e.end)}"
        if e.bullets:
            d.split_line(e.employer, e.location, before=0 if i == 0 else 4)
            d.split_line(e.title, dates, bold=False)
            for b in e.bullets:
                d.bullet(b)
        else:
            d.split_line(f"{e.employer}, {e.title}", f"{e.location}  |  {dates}", before=2)

    if resume.projects:
        d.heading("AI & Technical Projects")
        for i, p in enumerate(resume.projects):
            d.split_line(f"{p.name}  |  {p.subtitle}" if p.subtitle else p.name, p.dates, before=0 if i == 0 else 3)
            for b in p.bullets:
                d.bullet(b)

    d.heading("Skills")
    for g in resume.skills:
        p = d.para()
        d.run(p, g.label + ": ", bold=True)
        d.run(p, ", ".join(g.items))

    edu = db.education
    certs = [c["name"] for c in edu.get("certifications", []) if c.get("status", "earned") == "earned"]
    if certs:
        d.heading("Certifications")
        d.para("  |  ".join(certs))
    training = edu.get("training", [])
    if training:
        d.heading("Professional Development")
        for t in training:
            d.para(f"{t['name']}  |  {t['provider']}")
    if edu.get("degrees"):
        d.heading("Education")
        for g in edu["degrees"]:
            d.para("  |  ".join(x for x in (g.get("institution"), g.get("degree"), g.get("field")) if x))

    path.parent.mkdir(parents=True, exist_ok=True)
    d.doc.core_properties.author = f"{name.get('first', '')} {name.get('last', '')}".strip()
    d.doc.save(path)
    return path


def to_pdf(docx_path: Path):
    """Convert with LibreOffice. Returns (pdf_path, page_count) or (None, None) if it isn't installed."""
    office = shutil.which("soffice") or shutil.which("libreoffice")
    if not office:
        return None, None
    subprocess.run([office, "--headless", "--convert-to", "pdf", "--outdir", str(docx_path.parent), str(docx_path)],
                   check=True, capture_output=True, timeout=180)
    pdf = docx_path.with_suffix(".pdf")
    pages = len(re.findall(rb"/Type\s*/Page[^s]", pdf.read_bytes()))
    return pdf, pages
