"""The three Claude calls in the pipeline: analyze a posting, tailor a resume, review it.

Every call returns a validated Pydantic model (structured outputs), so the rest of the
pipeline never parses free text. The career database sits in a cached system block,
so analyzing several jobs in a row only pays for it once per cache window.
"""

import os
from pathlib import Path

import anthropic

from .database import CareerDatabase
from .models import JobAnalysis, QualityReview, TailoredResume

ROOT = Path(__file__).resolve().parent.parent
MODEL = os.environ.get("JOBFLOW_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("JOBFLOW_EFFORT", "high")


class RefusedError(RuntimeError):
    pass


class Claude:
    def __init__(self, db: CareerDatabase, client=None, model=MODEL, effort=EFFORT):
        self.db = db
        self.client = client or anthropic.Anthropic()
        self.model = model
        self.effort = effort
        self.system = [
            {"type": "text", "text": (ROOT / "prompts" / "system.md").read_text()},
            {"type": "text", "text": "<career_database>\n" + db.to_prompt() + "\n</career_database>",
             "cache_control": {"type": "ephemeral"}},
        ]

    def _ask(self, prompt, schema):
        response = self.client.beta.messages.parse(
            model=self.model,
            max_tokens=16000,
            # If a safety classifier declines, the API retries on a fallback model in the same call.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": self.effort},
            system=self.system,
            messages=[{"role": "user", "content": prompt}],
            output_format=schema,
        )
        if response.stop_reason == "refusal":
            raise RefusedError(getattr(response.stop_details, "explanation", None) or "Claude declined this request")
        if response.parsed_output is None:
            raise RuntimeError(f"No structured output (stop_reason={response.stop_reason})")
        return response.parsed_output

    def analyze(self, posting: str) -> JobAnalysis:
        prefs = self.db.preferences.get("priority_rules", {})
        return self._ask(
            "Analyze this job posting against the career database.\n"
            "Extract the requirements, match each one to evidence, estimate a match score (0-100) and explain it.\n"
            f"Priority rules: high if score >= {prefs.get('high_priority_if_match_score_at_least', 80)}, "
            f"apply if score >= {prefs.get('apply_if_match_score_at_least', 70)}, otherwise low or skip. "
            "Also weigh the candidate's preferences (location, work arrangement, salary).\n"
            "Recommend the resume version whose strategy fits best and give three likely interview questions.\n\n"
            f"<job_posting>\n{posting}\n</job_posting>",
            JobAnalysis,
        )

    def tailor(self, analysis: JobAnalysis, strategy: str, base_resume: str | None = None) -> TailoredResume:
        base = f"<base_resume>\n{base_resume}\n</base_resume>\n" if base_resume else ""
        return self._ask(
            "Write a one-page tailored resume for this job using the resume version strategy below.\n"
            "Lead with the evidence for the top competencies, reuse accomplishment bullet drafts where they fit, "
            "and leave alone anything that already fits. Three to five bullets for the current role, "
            "one or two per project, three to four projects at most, five or six skill groups.\n"
            "List every change you made and anything the candidate must confirm.\n\n"
            f"<job_analysis>\n{analysis.model_dump_json(indent=1)}\n</job_analysis>\n"
            f"<version_strategy>\n{strategy}\n</version_strategy>\n{base}",
            TailoredResume,
        )

    def review(self, resume: TailoredResume) -> QualityReview:
        return self._ask(
            (ROOT / "prompts" / "quality-review.md").read_text().split("---", 1)[-1]
            .replace("{{CAREER_DATABASE_JSON}}", "(see the career database in the system prompt)")
            .replace("{{TAILORED_RESUME}}", resume.model_dump_json(indent=1)),
            QualityReview,
        )
