"""Tests for the jobflow pipeline. Claude is replaced by fakes, so no API key or network is needed."""

import json
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
from docx import Document
from openpyxl import load_workbook

from jobflow import cli, fetch, llm, render, tracker, verify
from jobflow.database import CareerDatabase
from jobflow.models import JobAnalysis, QualityReview, RequirementMatch, TailoredResume

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE_DB = ROOT / "examples" / "career-database"
POSTING = ROOT / "examples" / "job-posting.txt"


@pytest.fixture
def db():
    return CareerDatabase.load(EXAMPLE_DB)


def analysis(**overrides):
    base = dict(
        company="Example Corp", position="IT Support Engineer", industry="Technology", location="New York, NY",
        work_arrangement="hybrid", salary_min=95000, salary_max=120000,
        responsibilities=["Run the service desk"], required_qualifications=["ServiceNow"], preferred_qualifications=[],
        technical_tools=["ServiceNow", "Okta"], keywords=["ITSM"], top_competencies=["ServiceNow"] * 5,
        requirements_match=[RequirementMatch(requirement="ServiceNow", evidence_ids=["exp-acme"], alignment="strong", note="")],
        match_score=82, score_reasoning="Close fit.", strongest_qualifications=["ServiceNow"],
        missing_qualifications=["Jamf"], concerns=[], priority="high", recommended_version="enterprise-technology",
        interview_questions=["Q1", "Q2", "Q3"],
    )
    return JobAnalysis(**{**base, **overrides})


def resume(**overrides):
    base = dict(
        summary="IT support specialist with five years of service desk experience.",
        experience=[
            dict(employer="Acme University", title="Service Desk Analyst", location="New York, NY | Hybrid",
                 start="2022-03", end="present",
                 bullets=["Resolve about 150 ServiceNow tickets a month with a 98% quality score."]),
            dict(employer="City Hospital", title="IT Support Intern", location="New York, NY",
                 start="2021-06", end="2021-08", bullets=[]),
        ],
        projects=[dict(name="Home SOC Lab", subtitle="github.com/example/soc-lab", dates="Jan – Mar 2025",
                       bullets=["Built Splunk alerts for failed logons."])],
        skills=[dict(label="IT Service Management", items=["ServiceNow", "ITSM"]),
                dict(label="Identity", items=["Okta (SSO)", "Active Directory"])],
        changes=["Led with ServiceNow"], confirm=[],
    )
    return TailoredResume(**{**base, **overrides})


# --- verify -----------------------------------------------------------------

def test_clean_resume_passes(db):
    assert verify.check(resume(), db) == []


def test_invented_title_wrong_dates_and_dropped_role_are_caught(db):
    r = resume(experience=[dict(employer="Acme University", title="Senior Service Desk Engineer",
                                location="", start="2022-03", end="present", bullets=[])])
    problems = verify.check(r, db)
    assert any("Senior Service Desk Engineer" in p for p in problems)
    assert any("City Hospital" in p and "dropped" in p for p in problems)

    r = resume()
    r.experience[0].start = "2021-01"
    assert any("Dates for" in p for p in verify.check(r, db))


def test_invented_metric_and_unknown_skill_are_caught(db):
    r = resume()
    r.experience[0].bullets = ["Cut ticket backlog by 40% across 3,000 users."]
    r.skills[0].items.append("Kubernetes")
    problems = verify.check(r, db)
    assert any("'40%'" in p for p in problems)
    assert any("'3000'" in p for p in problems)
    assert any("Kubernetes" in p for p in problems)


def test_unknown_project_is_caught(db):
    r = resume(projects=[dict(name="Quantum Ticket Router", subtitle="", dates="2025", bullets=[])])
    assert any("Quantum Ticket Router" in p for p in verify.check(r, db))


# --- render -----------------------------------------------------------------

def test_render_docx_is_black_and_complete(db, tmp_path):
    path = render.build_docx(resume(), db, tmp_path / "r.docx")
    doc = Document(path)
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "ALEX RIVERA" in text
    assert "Mar 2022 – Present" in text
    assert "City Hospital, IT Support Intern" in text  # title-only line for a role without bullets
    assert "CompTIA Security+" in text
    colors = {str(r.font.color.rgb) for p in doc.paragraphs for r in p.runs if r.font.color.type is not None}
    assert colors <= {"000000"}


def test_file_stem_follows_naming_convention(db):
    assert render.file_stem(db, "Example Corp", "IT Support Engineer") == "Alex_Rivera_Example_Corp_IT_Support_Engineer_Resume"


@pytest.mark.skipif(not shutil.which("soffice"), reason="LibreOffice not installed")
def test_pdf_fits_one_page(db, tmp_path):
    pdf, pages = render.to_pdf(render.build_docx(resume(), db, tmp_path / "r.docx"))
    assert pdf.exists() and pages == 1


# --- tracker ----------------------------------------------------------------

@pytest.fixture
def tracker_file(tmp_path):
    path = tmp_path / "tracker.xlsx"
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_tracker.py"), str(path)], check=True, capture_output=True)
    return path


def rows(path):
    ws = load_workbook(path)["Applications"]
    header = [c.value for c in ws[1]]
    return [dict(zip(header, r)) for r in ws.iter_rows(min_row=2, values_only=True) if r[0]]


def test_tracker_adds_then_updates_one_row(tracker_file):
    tracker.from_analysis(tracker_file, analysis(), "https://example.com/job")
    tracker.from_analysis(tracker_file, analysis(match_score=75, priority="medium"), "https://example.com/job")
    matching = [r for r in rows(tracker_file) if r["Company"] == "Example Corp"]
    assert len(matching) == 1
    row = matching[0]
    assert row["Match Score"] == 0.75 and row["Priority"] == "Medium"
    assert row["Resume Version"] == "Enterprise Technology" and row["Application Status"] == "Not Applied"


def test_marking_applied_sets_follow_up(tracker_file):
    tracker.from_analysis(tracker_file, analysis())
    tracker.mark(tracker_file, "Example Corp", "IT Support Engineer", "Applied", date(2026, 11, 2))
    row = next(r for r in rows(tracker_file) if r["Company"] == "Example Corp")
    assert row["Application Status"] == "Applied"
    assert row["Application Date"].date() == date(2026, 11, 2)
    assert row["Follow-up Date"].date() == date(2026, 11, 9)


# --- fetch ------------------------------------------------------------------

def test_html_to_text_keeps_structure_and_drops_scripts():
    text = fetch.html_to_text("<script>x()</script><h2>Role</h2><ul><li>One</li><li>Two</li></ul>")
    assert "x()" not in text
    assert "- One" in text and "- Two" in text


def test_greenhouse_urls_use_the_public_api():
    assert fetch.greenhouse_api_url("https://job-boards.greenhouse.io/anthropic/jobs/4979585008") == (
        "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs/4979585008?pay_transparency=true")
    assert fetch.greenhouse_api_url("https://example.com/careers/1") is None


def test_fetch_reads_local_files():
    text, url = fetch.fetch(str(POSTING))
    assert "IT Support Engineer" in text and url is None


# --- llm --------------------------------------------------------------------

class FakeClient:
    def __init__(self, output, stop_reason="end_turn"):
        self.calls = []
        self.output, self.stop_reason = output, stop_reason
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self.parse))

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason=self.stop_reason, parsed_output=self.output,
                               stop_details=SimpleNamespace(explanation="declined"))


def test_analyze_request_shape(db):
    client = FakeClient(analysis())
    result = llm.Claude(db, client=client).analyze("posting text")
    call = client.calls[0]
    assert result.company == "Example Corp"
    assert call["model"] == llm.MODEL and call["output_format"] is JobAnalysis
    assert call["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in call["betas"]
    assert call["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert "Alex" in call["system"][-1]["text"]  # career database is in the cached block
    assert "posting text" in call["messages"][0]["content"]


def test_refusal_raises(db):
    with pytest.raises(llm.RefusedError):
        llm.Claude(db, client=FakeClient(None, stop_reason="refusal")).analyze("x")


def test_database_prompt_is_stable(db):
    assert db.to_prompt() == CareerDatabase.load(EXAMPLE_DB).to_prompt()


# --- end to end -------------------------------------------------------------

class FakeClaude:
    def __init__(self, tailored):
        self.tailored = tailored

    def analyze(self, posting):
        assert "Example Corp" in posting
        return analysis()

    def tailor(self, a, strategy):
        assert "Enterprise Technology" in strategy
        return self.tailored

    def review(self, r):
        return QualityReview(unsupported_claims=[], confirm_items=[], writing_fixes=[], verdict="ready")


@pytest.fixture
def workspace(tmp_path, tracker_file):
    data = tmp_path / "data"
    shutil.copytree(EXAMPLE_DB, data / "career-database")
    shutil.copy(tracker_file, data / "application_tracker.xlsx")
    return cli.Workspace(data)


def test_analyze_tailor_and_apply(workspace, capsys):
    claude = FakeClaude(resume())
    assert cli.cmd_analyze(workspace, SimpleNamespace(source=str(POSTING)), claude) == 0
    slug = "example-corp-it-support-engineer"
    folder = workspace.apps / slug
    assert json.loads((folder / "analysis.json").read_text())["match_score"] == 82
    assert "82%" in (folder / "analysis.md").read_text()

    assert cli.cmd_tailor(workspace, SimpleNamespace(slug=slug, version=None), claude) == 0
    assert (folder / "Alex_Rivera_Example_Corp_IT_Support_Engineer_Resume.docx").exists()
    assert "Ready for your approval" in (folder / "review.md").read_text()

    assert cli.cmd_status(workspace, SimpleNamespace(slug=slug, status="Applied", date="2026-11-02")) == 0
    row = next(r for r in rows(workspace.tracker) if r["Company"] == "Example Corp")
    assert row["Application Status"] == "Applied"


def test_tailor_flags_invented_facts(workspace):
    bad = resume()
    bad.experience[0].bullets = ["Saved $2M by automating everything."]
    claude = FakeClaude(bad)
    cli.cmd_analyze(workspace, SimpleNamespace(source=str(POSTING)), claude)
    slug = "example-corp-it-support-engineer"
    assert cli.cmd_tailor(workspace, SimpleNamespace(slug=slug, version=None), claude) == 2
    assert "$2m" in (workspace.apps / slug / "review.md").read_text().lower()


def test_analyze_json_output(workspace, capsys):
    cli.cmd_analyze(workspace, SimpleNamespace(source=str(POSTING), json=True), FakeClaude(resume()))
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out["slug"] == "example-corp-it-support-engineer" and out["priority"] == "high"
