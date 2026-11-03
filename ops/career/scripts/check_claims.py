"""Fact-check a tailored resume's claims against the career database.

    python scripts/check_claims.py private/applications/acme-analyst/claims.json
    python scripts/check_claims.py claims.json career-database/templates

The tailoring workflow ends with a claims manifest (see the Claims manifest
section of prompts/resume-tailoring-assistant.md). This script is the gate
before you approve the resume: the AI's own review can miss things, this
check can't be talked out of a rule.

Fails when:
  - a claim cites no source, an unknown id, or an entry still "verified": false
  - a claim contains a number (40%, $2M, 120 tickets) not found in any cited entry
  - an Experience claim cites a project (independent work framed as employment)
  - a position's employer, title or dates differ from experience.json
  - a listed skill is missing from skills.json or is only "familiar"

Exits 0 when every claim checks out, 1 otherwise.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
POSITION_FIELDS = ["employer", "title", "start", "end"]


def load(folder, name):
    f = folder / f"{name}.json"
    return json.loads(f.read_text()) if f.exists() else {}


def strings(node):
    """Every leaf string in an entry, so numbers can be matched against it."""
    if isinstance(node, dict):
        for k, v in node.items():
            if not k.startswith("_"):
                yield from strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from strings(v)
    elif isinstance(node, (str, int, float)) and not isinstance(node, bool):
        yield str(node)


def numbers(text):
    return {n.replace(",", "") for n in NUMBER.findall(text)}


def check(manifest, folder):
    experience = load(folder, "experience").get("positions", [])
    projects = load(folder, "projects").get("projects", [])
    accomplishments = load(folder, "accomplishments").get("accomplishments", [])
    education = load(folder, "education")
    skills = load(folder, "skills").get("skills", [])

    entries = {e.get("id"): e for e in experience + projects + accomplishments if e.get("id")}
    for e in education.get("degrees", []) + education.get("certifications", []):
        if isinstance(e, dict) and e.get("id"):
            entries[e["id"]] = e
    project_ids = {p.get("id") for p in projects}
    problems = []

    for i, claim in enumerate(manifest.get("claims", []), 1):
        text = claim.get("text", "").strip()
        label = f'claim {i} ("{text[:60]}")'
        sources = claim.get("sources") or []
        if not sources:
            problems.append(f"{label}: cites no source")
            continue
        unknown = [s for s in sources if s not in entries]
        for s in unknown:
            problems.append(f"{label}: cites unknown id {s}")
        cited = [entries[s] for s in sources if s in entries]
        for e in cited:
            if e.get("verified") is False:
                problems.append(f"{label}: {e['id']} is not verified yet")
        if claim.get("section", "").lower() == "experience":
            for s in sources:
                if s in project_ids:
                    problems.append(f"{label}: Experience bullet cites project {s} (projects are not employment)")
        if cited:
            known = set().union(*(numbers(s) for e in cited for s in strings(e)))
            for n in sorted(numbers(text) - known):
                problems.append(f"{label}: number {n} is not in any cited entry")

    by_id = {p.get("id"): p for p in experience}
    for p in manifest.get("positions", []):
        record = by_id.get(p.get("id"))
        if record is None:
            problems.append(f"position {p.get('id', '?')}: not in experience.json")
            continue
        for field in POSITION_FIELDS:
            if field in p and str(p[field]).strip() != str(record.get(field, "")).strip():
                problems.append(
                    f"position {p['id']}: {field} is \"{p[field]}\" but experience.json says \"{record.get(field, '')}\""
                )

    names = {}
    for s in skills:
        for n in [s.get("name", "")] + s.get("keywords", []):
            names[n.strip().lower()] = s
    for skill in manifest.get("skills", []):
        record = names.get(skill.strip().lower())
        if record is None:
            problems.append(f'skill "{skill}": not in skills.json')
        elif record.get("level") == "familiar":
            problems.append(f'skill "{skill}": level is familiar, which is not featured on a resume')

    return problems


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    manifest_path = Path(sys.argv[1])
    folder = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "private" / "career-database"
    if not folder.is_dir():
        sys.exit(f"{folder} not found. Run: python scripts/init_private.py")
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"Could not read {manifest_path}: {e}")

    problems = check(manifest, folder)
    total = len(manifest.get("claims", []))
    if problems:
        print(f"{len(problems)} problem(s) in {manifest_path}. Fix these before approving:\n")
        print("\n".join(f"  - {p}" for p in problems))
        sys.exit(1)
    print(f"All {total} claim(s) in {manifest_path} trace to verified database entries.")


if __name__ == "__main__":
    main()
