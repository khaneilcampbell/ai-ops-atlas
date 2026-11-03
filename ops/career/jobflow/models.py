"""Structured shapes for everything Claude returns. Claude's output is parsed
straight into these models, so a malformed response fails loudly."""

from typing import Literal

from pydantic import BaseModel, Field

Alignment = Literal["strong", "developing", "partial", "gap"]
Priority = Literal["high", "medium", "low", "skip"]
Version = Literal["ai-solutions", "enterprise-technology", "security-automation"]
WorkArrangement = Literal["hybrid", "remote", "onsite", "unconfirmed"]


class RequirementMatch(BaseModel):
    requirement: str
    evidence_ids: list[str] = Field(description="Career database ids that support this requirement")
    alignment: Alignment
    note: str


class JobAnalysis(BaseModel):
    company: str
    position: str
    industry: str
    location: str
    work_arrangement: WorkArrangement
    salary_min: int | None = Field(description="Annual base in USD, or null if not posted")
    salary_max: int | None
    responsibilities: list[str]
    required_qualifications: list[str]
    preferred_qualifications: list[str]
    technical_tools: list[str]
    keywords: list[str]
    top_competencies: list[str] = Field(description="The five most important competencies")
    requirements_match: list[RequirementMatch]
    match_score: int = Field(description="Estimated resume alignment, 0-100")
    score_reasoning: str
    strongest_qualifications: list[str]
    missing_qualifications: list[str]
    concerns: list[str]
    priority: Priority
    recommended_version: Version
    interview_questions: list[str] = Field(description="Three likely interview questions")


class ExperienceEntry(BaseModel):
    employer: str
    title: str
    location: str
    start: str = Field(description="Exactly as in experience.json, e.g. 2022-07")
    end: str = Field(description="Exactly as in experience.json, e.g. present")
    bullets: list[str]


class ProjectEntry(BaseModel):
    name: str
    subtitle: str = Field(description="URL or label shown after the name, e.g. 'Independent Project'")
    dates: str
    bullets: list[str]


class SkillGroup(BaseModel):
    label: str
    items: list[str]


class TailoredResume(BaseModel):
    summary: str
    experience: list[ExperienceEntry]
    projects: list[ProjectEntry]
    skills: list[SkillGroup]
    changes: list[str] = Field(description="What changed versus the base version, and why")
    confirm: list[str] = Field(description="Anything the candidate must confirm before using this resume")


class ReviewFinding(BaseModel):
    location: str = Field(description="Section and bullet the finding refers to")
    claim: str
    problem: str
    suggested_rewrite: str


class QualityReview(BaseModel):
    unsupported_claims: list[ReviewFinding]
    confirm_items: list[str]
    writing_fixes: list[str]
    verdict: Literal["ready", "needs_changes"]
