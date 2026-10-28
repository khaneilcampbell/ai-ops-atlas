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
