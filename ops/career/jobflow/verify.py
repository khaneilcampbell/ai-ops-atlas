"""Deterministic fact checks on a tailored resume. These run in code, not in the
model, so "never invent titles, dates or metrics" is enforced, not just requested."""

import re

from .database import CareerDatabase
from .models import TailoredResume

NUMBER = re.compile(r"(?<![\w.])\$?\d[\d,]*(?:\.\d+)?\s?(?:%|[kKmM]\b|\+)?")


def _numbers(text):
    return {m.group().replace(",", "").replace(" ", "").lower() for m in NUMBER.finditer(text)}


def _norm(text):
    return re.sub(r"\s+", " ", text).strip().lower()


def check(resume: TailoredResume, db: CareerDatabase):
    """Return a list of human-readable problems. An empty list means every check passed."""
    problems = []

    positions = {(_norm(p["employer"]), _norm(p["title"])): p for p in db.positions}
    used = set()
    for e in resume.experience:
        key = (_norm(e.employer), _norm(e.title))
        p = positions.get(key)
        if not p:
            problems.append(f"Experience '{e.title}, {e.employer}' is not in experience.json (title and employer must match exactly)")
            continue
        used.add(key)
        if (e.start, e.end) != (p["start"], p["end"]):
            problems.append(f"Dates for '{e.title}, {e.employer}' are {e.start} – {e.end}; experience.json says {p['start']} – {p['end']}")
        if p.get("verified") is False:
            problems.append(f"'{e.title}, {e.employer}' is not verified in experience.json")
    for key, p in positions.items():
        if key not in used:
            problems.append(f"Position '{p['title']}, {p['employer']}' was dropped; keep every role so there are no unexplained gaps")

    project_names = {_norm(p["name"]): p for p in db.projects}
    for pr in resume.projects:
        match = next((p for n, p in project_names.items() if _norm(pr.name) in n or n in _norm(pr.name)), None)
        if not match:
            problems.append(f"Project '{pr.name}' is not in projects.json")
        elif match.get("verified") is False:
            problems.append(f"Project '{pr.name}' is not verified in projects.json")

    source = _numbers(db.full_text())
    text_blocks = [("summary", resume.summary)]
    text_blocks += [(f"{e.employer} bullet {i + 1}", b) for e in resume.experience for i, b in enumerate(e.bullets)]
    text_blocks += [(f"{p.name} bullet {i + 1}", b) for p in resume.projects for i, b in enumerate(p.bullets)]
    for where, text in text_blocks:
        for n in sorted(_numbers(text) - source):
            # Years like "2022" and small counts written as words are fine; flag only figures absent from the database.
            if re.fullmatch(r"(19|20)\d\d", n):
                continue
            problems.append(f"{where}: '{n}' does not appear anywhere in the career database")

    vocab = db.skill_vocabulary()
    for group in resume.skills:
        for item in group.items:
            base = re.sub(r"\s*\(.*\)", "", item).strip().lower()
            if item.lower() not in vocab and base not in vocab:
                problems.append(f"Skill '{item}' ({group.label}) is not in skills.json or any tool list")

    return problems
