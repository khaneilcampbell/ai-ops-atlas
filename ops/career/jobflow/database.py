"""Load the career database (the JSON files described in career-database/templates)."""

import json
from dataclasses import dataclass
from pathlib import Path

FILES = ["profile", "experience", "skills", "projects", "education", "preferences", "accomplishments"]


@dataclass
class CareerDatabase:
    data: dict

    @classmethod
    def load(cls, folder):
        folder = Path(folder)
        missing = [n for n in FILES if not (folder / f"{n}.json").exists()]
        if missing:
            raise FileNotFoundError(f"{folder} is missing: {', '.join(m + '.json' for m in missing)}")
        return cls({n: json.loads((folder / f"{n}.json").read_text()) for n in FILES})

    @property
    def profile(self):
        return self.data["profile"]

    @property
    def positions(self):
        return self.data["experience"].get("positions", [])

    @property
    def projects(self):
        return self.data["projects"].get("projects", [])

    @property
    def skills(self):
        return self.data["skills"].get("skills", [])

    @property
    def education(self):
        return self.data["education"]

    @property
    def preferences(self):
        return self.data["preferences"]

    def skill_vocabulary(self):
        """Every skill name, keyword and tool the database supports, lowercased."""
        words = set()
        for s in self.skills:
            words.add(s["name"].lower())
            words.update(k.lower() for k in s.get("keywords", []))
        for p in self.positions:
            words.update(t.lower() for t in p.get("tools", []))
        for p in self.projects:
            words.update(t.lower() for t in p.get("technologies", []))
        return words

    def to_prompt(self):
        """Stable JSON for the prompt. sort_keys keeps the text byte-identical between
        runs so the prompt cache can be reused across jobs."""
        return json.dumps(self.data, indent=1, sort_keys=True, ensure_ascii=False)

    def full_text(self):
        return json.dumps(self.data, ensure_ascii=False)
