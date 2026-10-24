"""Check the career database before you rely on it.

    python scripts/validate_database.py                     # checks private/career-database
    python scripts/validate_database.py career-database/templates

Reports invalid JSON, unfinished TODO placeholders, entries still marked
"verified": false, accomplishments with a metric but no source, and
references to ids that don't exist. Exits non-zero if anything needs attention.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ["profile", "experience", "skills", "projects", "education", "preferences", "accomplishments"]


def walk(node, path=""):
    """Yield (path, value) for every leaf string."""
    if isinstance(node, dict):
        for k, v in node.items():
            if not k.startswith("_"):
                yield from walk(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "private" / "career-database"
    if not folder.is_dir():
        sys.exit(f"{folder} not found. Run: python scripts/init_private.py")

    data, problems = {}, []
    for name in FILES:
        f = folder / f"{name}.json"
        if not f.exists():
            problems.append(f"{name}.json: missing")
            continue
        try:
            data[name] = json.loads(f.read_text())
        except json.JSONDecodeError as e:
            problems.append(f"{name}.json: invalid JSON ({e})")
            continue
        for path, value in walk(data[name]):
            if "TODO" in value or value in ("YYYY-MM", "YYYY-MM or present"):
                problems.append(f"{name}.json: {path} is unfinished")

    def entries(name, key):
        return data.get(name, {}).get(key, [])

    for name, key in [("experience", "positions"), ("projects", "projects"), ("accomplishments", "accomplishments")]:
        for e in entries(name, key):
            if e.get("verified") is False:
                problems.append(f"{name}.json: {e.get('id', '?')} not yet verified")

    for a in entries("accomplishments", "accomplishments"):
        if a.get("metric") and not a.get("metric_source", "").strip():
            problems.append(f"accomplishments.json: {a.get('id')} has a metric with no source")

    ids = {e.get("id") for n, k in [("experience", "positions"), ("projects", "projects"),
                                     ("accomplishments", "accomplishments")] for e in entries(n, k)}
    for p in entries("experience", "positions"):
        for ref in p.get("accomplishment_ids", []):
            if ref not in ids:
                problems.append(f"experience.json: {p.get('id')} references unknown {ref}")
    for a in entries("accomplishments", "accomplishments"):
        if a.get("linked_to") and a["linked_to"] not in ids:
            problems.append(f"accomplishments.json: {a.get('id')} linked to unknown {a['linked_to']}")
    for s in entries("skills", "skills"):
        for ref in s.get("evidence", []):
            if ref not in ids:
                problems.append(f"skills.json: {s.get('name')} cites unknown evidence {ref}")

    if problems:
        print(f"{len(problems)} item(s) need attention in {folder}:\n")
        print("\n".join(f"  - {p}" for p in problems))
        sys.exit(1)
    print(f"Career database in {folder} is complete and verified.")


if __name__ == "__main__":
    main()
