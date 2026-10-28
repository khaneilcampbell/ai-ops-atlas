"""Tests for the committed templates and scripts. Uses no personal data."""

import json
import subprocess
import sys
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "career-database" / "templates"
FILES = ["profile", "experience", "skills", "projects", "education", "preferences", "accomplishments"]


def validate(folder):
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_database.py"), str(folder)],
        capture_output=True, text=True,
    )


def write_db(folder, **overrides):
    folder.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        (folder / f"{name}.json").write_text(json.dumps(overrides.get(name, {})))
    return folder


def test_every_template_exists_and_is_valid_json():
    for name in FILES:
        json.loads((TEMPLATES / f"{name}.json").read_text())


def test_validator_flags_unfinished_templates():
    result = validate(TEMPLATES)
    assert result.returncode == 1
    assert "is unfinished" in result.stdout


def test_validator_passes_a_complete_database(tmp_path):
    db = write_db(
        tmp_path / "db",
        experience={"positions": [{"id": "exp-1", "verified": True, "accomplishment_ids": ["acc-1"]}]},
        accomplishments={"accomplishments": [
            {"id": "acc-1", "verified": True, "metric": "40%", "metric_source": "Q3 report", "linked_to": "exp-1"},
        ]},
        skills={"skills": [{"name": "Python", "evidence": ["acc-1"]}]},
    )
    result = validate(db)
    assert result.returncode == 0, result.stdout


def test_validator_catches_unknown_references_and_unsourced_metrics(tmp_path):
    db = write_db(
        tmp_path / "db",
        experience={"positions": [{"id": "exp-1", "accomplishment_ids": ["acc-missing"]}]},
        accomplishments={"accomplishments": [{"id": "acc-1", "metric": "2x"}]},
    )
    result = validate(db)
    assert result.returncode == 1
    assert "references unknown acc-missing" in result.stdout
    assert "has a metric with no source" in result.stdout


def test_validator_reports_missing_and_invalid_files(tmp_path):
    db = write_db(tmp_path / "db")
    (db / "skills.json").unlink()
    (db / "profile.json").write_text("{not json")
    result = validate(db)
    assert result.returncode == 1
    assert "skills.json: missing" in result.stdout
    assert "profile.json: invalid JSON" in result.stdout


def test_tracker_builds_with_all_sheets(tmp_path):
    out = tmp_path / "tracker.xlsx"
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_tracker.py"), str(out)], check=True)
    wb = load_workbook(out)
    assert {"Applications", "Dashboard", "Lists"} <= set(wb.sheetnames)
    headers = [c.value for c in wb["Applications"][1]]
    assert headers[:2] == ["Company", "Position"]


def check_claims(manifest, folder, tmp_path):
    path = tmp_path / "claims.json"
    path.write_text(json.dumps(manifest))
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "check_claims.py"), str(path), str(folder)],
        capture_output=True, text=True,
    )


def claims_db(tmp_path):
    return write_db(
        tmp_path / "db",
        experience={"positions": [{
            "id": "exp-1", "employer": "Acme", "title": "IT Analyst",
            "start": "2021-03", "end": "present", "verified": True,
        }]},
        projects={"projects": [{"id": "proj-1", "name": "Lab", "verified": True}]},
        accomplishments={"accomplishments": [
            {"id": "acc-1", "linked_to": "exp-1", "result": "Backlog fell 40% in 3 months",
             "metric": "40%", "metric_source": "Q3 report", "verified": True},
            {"id": "acc-2", "linked_to": "exp-1", "result": "Draft", "verified": False},
        ]},
        skills={"skills": [
            {"name": "ServiceNow", "level": "proficient", "keywords": ["ITSM"]},
            {"name": "Go", "level": "familiar"},
        ]},
    )


def test_claims_pass_when_everything_traces_to_the_database(tmp_path):
    manifest = {
        "positions": [{"id": "exp-1", "employer": "Acme", "title": "IT Analyst", "start": "2021-03", "end": "present"}],
        "claims": [{"section": "experience", "text": "Cut the ticket backlog 40% in 3 months", "sources": ["acc-1"]}],
        "skills": ["ServiceNow", "itsm"],
    }
    result = check_claims(manifest, claims_db(tmp_path), tmp_path)
    assert result.returncode == 0, result.stdout


def test_claims_catch_invented_numbers_and_bad_sources(tmp_path):
    manifest = {"claims": [
        {"section": "experience", "text": "Cut the backlog 60%", "sources": ["acc-1"]},
        {"section": "summary", "text": "Automation specialist", "sources": []},
        {"section": "experience", "text": "Built a lab", "sources": ["proj-1"]},
        {"section": "experience", "text": "Drafted runbooks", "sources": ["acc-2", "acc-9"]},
    ]}
    result = check_claims(manifest, claims_db(tmp_path), tmp_path)
    assert result.returncode == 1
    assert "number 60 is not in any cited entry" in result.stdout
    assert "cites no source" in result.stdout
    assert "projects are not employment" in result.stdout
    assert "acc-2 is not verified yet" in result.stdout
    assert "unknown id acc-9" in result.stdout


def test_claims_catch_changed_titles_and_unlisted_skills(tmp_path):
    manifest = {
        "positions": [{"id": "exp-1", "employer": "Acme", "title": "Senior IT Analyst"}],
        "skills": ["Kubernetes", "Go"],
    }
    result = check_claims(manifest, claims_db(tmp_path), tmp_path)
    assert result.returncode == 1
    assert 'title is "Senior IT Analyst"' in result.stdout
    assert '"Kubernetes": not in skills.json' in result.stdout
    assert "level is familiar" in result.stdout
