#!/usr/bin/env python3
"""
build_docs.py — Project Intelligence Hub document builder

Renders a project's Markdown sources into styled DOCX files. The DOCX files
are the documents you read; they open in Pages, Word, Preview and Google Docs.

Usage:
    python3 build_docs.py <project_dir>

<project_dir> must contain Source/project.json and Source/*.md.
Output: one .docx per Markdown file, written to <project_dir>/ (beside Source/).
Requires pandoc (2.9+) and python-docx. Reads no network resources.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

# ── Design tokens ────────────────────────────────────────────────────────────
BODY_FONT = "Helvetica Neue"
HEAD_FONT = "Avenir Next"
MONO_FONT = "Menlo"
INK = RGBColor(0x0F, 0x17, 0x2A)
BODY = RGBColor(0x1F, 0x29, 0x37)
MUTED = RGBColor(0x6B, 0x72, 0x80)
ACCENT = RGBColor(0x1E, 0x3A, 0x8A)
RULE_HEX = "C7D2EC"
HEADER_FILL = "E8EDF8"


def set_font(style, name, size=None, color=None, bold=None):
    style.font.name = name
    rpr = style.element.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.append(fonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        fonts.set(qn(attr), name)
    for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:cstheme", "w:eastAsiaTheme"):
        if fonts.get(qn(attr)) is not None:
            del fonts.attrib[qn(attr)]
    if size:
        style.font.size = Pt(size)
    if color is not None:
        style.font.color.rgb = color
    if bold is not None:
        style.font.bold = bold


def bottom_rule(paragraph_or_style, color=RULE_HEX, size=6, space=4):
    el = getattr(paragraph_or_style, "element", None)
    if el is None:
        el = paragraph_or_style._p
    ppr = el.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(size))
    bottom.set(qn("w:space"), str(space))
    bottom.set(qn("w:color"), color)
    pbdr.append(bottom)
    ppr.append(pbdr)


def make_reference_doc(path):
    raw = subprocess.run(
        ["pandoc", "--print-default-data-file", "reference.docx"],
        check=True, capture_output=True,
    ).stdout
    Path(path).write_bytes(raw)
    doc = Document(path)
    # Index by display name: python-docx's own lookup lowercases built-in
    # names ("heading 1") and misses the capitalized names pandoc uses.
    st = {s.name: s for s in doc.styles}

    for name in ("Normal", "Body Text", "First Paragraph", "Compact"):
        if name in st:
            set_font(st[name], BODY_FONT, 10.5, BODY)
            pf = st[name].paragraph_format
            pf.space_after = Pt(6) if name != "Compact" else Pt(2)
            pf.line_spacing = 1.25

    set_font(st["Title"], HEAD_FONT, 26, INK, True)
    st["Title"].paragraph_format.space_after = Pt(4)
    if "Subtitle" in st:
        set_font(st["Subtitle"], HEAD_FONT, 12, MUTED, False)

    heads = {"Heading 1": (17, INK, 18, 6), "Heading 2": (13, ACCENT, 14, 4),
             "Heading 3": (11, INK, 10, 3), "Heading 4": (10.5, MUTED, 8, 2)}
    for name, (size, color, before, after) in heads.items():
        if name in st:
            set_font(st[name], HEAD_FONT, size, color, True)
            pf = st[name].paragraph_format
            pf.space_before = Pt(before)
            pf.space_after = Pt(after)
            pf.keep_with_next = True
    bottom_rule(st["Heading 1"])

    for name in ("Source Code", "Verbatim Char"):
        if name in st:
            set_font(st[name], MONO_FONT, 8.5, INK)
    if "Source Code" in st:
        st["Source Code"].paragraph_format.left_indent = Inches(0.15)
    if "Hyperlink" in st:
        st["Hyperlink"].font.color.rgb = ACCENT
    if "Block Text" in st:
        set_font(st["Block Text"], BODY_FONT, 10.5, BODY)
        st["Block Text"].paragraph_format.left_indent = Inches(0.2)
    if "Image Caption" in st:
        set_font(st["Image Caption"], BODY_FONT, 9, MUTED)

    for section in doc.sections:
        section.left_margin = section.right_margin = Inches(0.9)
        section.top_margin = section.bottom_margin = Inches(0.85)
    doc.save(path)


def add_page_field(paragraph):
    run = paragraph.add_run()
    for kind, text in (("begin", None), (None, "PAGE"), ("end", None)):
        if kind:
            fc = OxmlElement("w:fldChar")
            fc.set(qn("w:fldCharType"), kind)
            run._r.append(fc)
        else:
            it = OxmlElement("w:instrText")
            it.set(qn("xml:space"), "preserve")
            it.text = text
            run._r.append(it)
    run.font.size = Pt(8)
    run.font.color.rgb = MUTED


def style_tables(doc):
    for table in doc.tables:
        tbl = table._tbl
        tblpr = tbl.tblPr
        borders = OxmlElement("w:tblBorders")
        for edge in ("top", "bottom", "insideH"):
            el = OxmlElement(f"w:{edge}")
            el.set(qn("w:val"), "single")
            el.set(qn("w:sz"), "4")
            el.set(qn("w:color"), RULE_HEX)
            borders.append(el)
        for edge in ("left", "right", "insideV"):
            el = OxmlElement(f"w:{edge}")
            el.set(qn("w:val"), "nil")
            borders.append(el)
        tblpr.append(borders)
        width = OxmlElement("w:tblW")
        width.set(qn("w:w"), "5000")
        width.set(qn("w:type"), "pct")
        for old in tblpr.findall(qn("w:tblW")):
            tblpr.remove(old)
        tblpr.append(width)
        for r, row in enumerate(table.rows):
            for cell in row.cells:
                if r == 0:
                    tcpr = cell._tc.get_or_add_tcPr()
                    shd = OxmlElement("w:shd")
                    shd.set(qn("w:val"), "clear")
                    shd.set(qn("w:color"), "auto")
                    shd.set(qn("w:fill"), HEADER_FILL)
                    tcpr.append(shd)
                for p in cell.paragraphs:
                    p.paragraph_format.space_after = Pt(2)
                    p.paragraph_format.space_before = Pt(2)
                    for run in p.runs:
                        run.font.size = Pt(9)
                        if r == 0:
                            run.font.bold = True
                            run.font.color.rgb = INK


def add_header_footer(doc, header_text, footer_text):
    for section in doc.sections:
        hp = section.header.paragraphs[0]
        hp.text = ""
        run = hp.add_run(header_text.upper())
        run.font.size = Pt(7.5)
        run.font.color.rgb = ACCENT
        run.font.name = HEAD_FONT
        bottom_rule(hp, size=4, space=6)
        fp = section.footer.paragraphs[0]
        fp.text = ""
        fp.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = fp.add_run(footer_text + "   ·   Page ")
        run.font.size = Pt(8)
        run.font.color.rgb = MUTED
        add_page_field(fp)


def build(project_dir):
    project_dir = Path(project_dir)
    src = project_dir / "Source"
    meta = json.loads((src / "project.json").read_text())
    out = project_dir
    with tempfile.TemporaryDirectory() as tmp:
        ref = Path(tmp) / "reference.docx"
        make_reference_doc(ref)
        for md in sorted(src.glob("[0-9][0-9] *.md")):
            target = out / (md.stem + ".docx")
            subprocess.run(
                ["pandoc", str(md), "-f", "markdown", "-t", "docx",
                 "--reference-doc", str(ref), "--resource-path", str(src),
                 "-o", str(target)],
                check=True,
            )
            doc = Document(target)
            style_tables(doc)
            add_header_footer(
                doc,
                f"Project Intelligence Hub  ·  {meta['id']}  ·  {meta['name']}",
                f"{md.stem[3:]}  ·  Last verified {meta['last_verified']}",
            )
            doc.save(target)
            print(f"built {target}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: build_docs.py <project_dir>")
    build(sys.argv[1])
