import type { Agent, Project } from "../catalog/types";
import type { AutonomyLevel, Category, Classification, Confidence, Kpi, Risk, Sensitivity, TriggerType } from "./types";

/**
 * A complete, normalized registry profile. Built from any manifest version: atlas/v1 agents
 * (no registry block) migrate to a profile whose undocumented fields are null, so the UI can
 * label them "Not documented" instead of guessing.
 */
export interface AgentProfile {
  id: string;
  title: string;
  originalName: string | null;
  suggestedTitle: string | null;
  summary: string;
  category: Category;
  subcategory: string | null;
  classification: Classification;
  confidence: Confidence | null;
  evidence: string | null;
  project: { id: string; name: string };
  repository: string;
  repositoryUrl: string;
  framework: string;
  model: string | null;
  runtime: string | null;
  version: string | null;
  mission: { purpose: string; problem: string | null; outcomes: string[]; beneficiaries: string[] };
  responsibilities: { tasks: string[]; tools: string[]; inputs: string[]; outputs: string[]; dependencies: string[]; limitations: string[] };
  goals: { objective: string | null; reviewFrequency: string | null; kpis: Kpi[] };
  execution: { trigger: string | null; triggerType: TriggerType | null; schedule: string | null; environment: string | null; stages: string[]; liveSource: string | null };
  governance: {
    autonomy: AutonomyLevel | null;
    autonomyNote: string | null;
    permissions: string[];
    capabilities: string[];
    dataSensitivity: Sensitivity | null;
    approval: string | null;
    credentialOwner: string | null;
    risk: Risk | null;
    auditLog: string | null;
  };
  cost: { budget: string | null; notes: string | null };
  docs: { source: string | null; technical: string | null; runbook: string | null; knownIssues: string[]; improvements: string[]; lastReview: string | null };
  /** Manifest version the profile came from. */
  schema: "v1" | "v2";
}

export function toProfile(agent: Agent, project: Project | undefined): AgentProfile {
  const reg = agent.registry;
  const nn = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);
  const liveSource = agent.observe?.githubWorkflow ? `GitHub Actions: ${agent.observe.githubWorkflow}` : agent.observe?.atlasIntel ? "Atlas run log" : null;
  return {
    id: agent.id,
    title: agent.name,
    originalName: nn(agent.originalName),
    suggestedTitle: nn(reg?.suggestedTitle),
    summary: reg?.summary ?? agent.purpose,
    category: reg?.category ?? "uncategorized",
    subcategory: nn(reg?.subcategory),
    classification: reg?.classification?.type ?? "unclassified",
    confidence: nn(reg?.classification?.confidence),
    evidence: nn(reg?.classification?.evidence),
    project: { id: agent.projectId, name: project?.name ?? agent.projectId },
    repository: agent.repository,
    repositoryUrl: `https://github.com/${agent.repository}`,
    framework: agent.framework,
    model: nn(agent.model),
    runtime: nn(agent.runtime),
    version: nn(reg?.version),
    // A v1 purpose is the best documented statement of why an agent exists.
    mission: {
      purpose: reg?.mission?.purpose ?? agent.purpose,
      problem: nn(reg?.mission?.problem),
      outcomes: reg?.mission?.outcomes ?? [],
      beneficiaries: reg?.mission?.beneficiaries ?? [],
    },
    responsibilities: {
      tasks: reg?.responsibilities?.tasks ?? agent.capabilities ?? [],
      tools: reg?.responsibilities?.tools ?? [],
      inputs: reg?.responsibilities?.inputs ?? [],
      outputs: reg?.responsibilities?.outputs ?? [],
      dependencies: reg?.responsibilities?.dependencies ?? [],
      limitations: reg?.responsibilities?.limitations ?? [],
    },
    goals: { objective: nn(reg?.goals?.objective), reviewFrequency: nn(reg?.goals?.reviewFrequency), kpis: reg?.goals?.kpis ?? [] },
    execution: {
      trigger: nn(agent.trigger),
      triggerType: nn(reg?.execution?.triggerType),
      schedule: nn(reg?.execution?.schedule),
      environment: reg?.execution?.environment ?? agent.runtime ?? null,
      stages: reg?.execution?.stages ?? [],
      liveSource,
    },
    governance: {
      autonomy: nn(reg?.governance?.autonomy),
      autonomyNote: nn(reg?.governance?.autonomyNote),
      permissions: agent.permissions ?? [],
      capabilities: agent.capabilities ?? [],
      dataSensitivity: nn(reg?.governance?.dataSensitivity),
      approval: nn(reg?.governance?.approval),
      credentialOwner: nn(reg?.governance?.credentialOwner),
      risk: nn(reg?.governance?.risk),
      auditLog: nn(reg?.governance?.auditLog),
    },
    cost: { budget: nn(reg?.cost?.budget), notes: nn(reg?.cost?.notes) },
    docs: {
      source: nn(agent.source),
      technical: nn(reg?.docs?.technical),
      runbook: nn(reg?.docs?.runbook),
      knownIssues: reg?.docs?.knownIssues ?? [],
      improvements: reg?.docs?.improvements ?? [],
      lastReview: reg?.docs?.lastReview ?? null,
    },
    schema: reg ? "v2" : "v1",
  };
}

/** The fields a complete profile documents, with whether each one is filled in. */
export function documentationChecks(p: AgentProfile): { key: string; label: string; ok: boolean }[] {
  return [
    { key: "classification", label: "Classification", ok: p.classification !== "unclassified" },
    { key: "category", label: "Functional category", ok: p.category !== "uncategorized" },
    { key: "mission", label: "Problem it solves", ok: !!p.mission.problem },
    { key: "outcomes", label: "Expected outcomes", ok: p.mission.outcomes.length > 0 },
    { key: "tasks", label: "Responsibilities", ok: p.responsibilities.tasks.length > 0 },
    { key: "io", label: "Inputs and outputs", ok: p.responsibilities.inputs.length > 0 && p.responsibilities.outputs.length > 0 },
    { key: "trigger", label: "Trigger type", ok: !!p.execution.triggerType },
    { key: "goals", label: "Goals and KPIs", ok: !!p.goals.objective && p.goals.kpis.length > 0 },
    { key: "autonomy", label: "Autonomy level", ok: p.governance.autonomy !== null },
    { key: "permissions", label: "Permissions", ok: p.governance.permissions.length > 0 },
    { key: "risk", label: "Risk classification", ok: !!p.governance.risk },
    { key: "owner", label: "Credential owner", ok: !!p.governance.credentialOwner },
    { key: "runbook", label: "Runbook", ok: !!p.docs.runbook },
    { key: "review", label: "Last review date", ok: !!p.docs.lastReview },
  ];
}

export function documentationScore(p: AgentProfile): { done: number; total: number; missing: string[] } {
  const checks = documentationChecks(p);
  return { done: checks.filter((c) => c.ok).length, total: checks.length, missing: checks.filter((c) => !c.ok).map((c) => c.label) };
}
