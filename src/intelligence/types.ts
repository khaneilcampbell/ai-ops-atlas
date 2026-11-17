import type { Sensitivity } from "../registry/types";
import type { Actor, SensitiveCategory } from "../tasks/types";

// Agent intelligence: the records Atlas keeps about what agents know, what they may use, which
// model a step should get, the decisions they recommend, how good their work was and what should
// change. Everything is plain data checked by fixed rules (no model calls), and every record says
// where it came from and whether a person has verified it.

export const MEMORY_CATEGORIES = ["working", "project_knowledge", "operational", "human_approved"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_LABEL: Record<MemoryCategory, string> = {
  working: "Working memory",
  project_knowledge: "Project knowledge",
  operational: "Operational memory",
  human_approved: "Human-approved",
};

export const MEMORY_INFO: Record<MemoryCategory, string> = {
  working: "Active goals, task context, intermediate findings and dependencies. Expires by itself.",
  project_knowledge: "Approved architecture, product specs, repository facts, research and procedures.",
  operational: "Verified failure patterns, recovery steps, tool limits and strategies that worked.",
  human_approved: "Decisions, policies, business rules and preferences Khaneil approved.",
};

/** Who may read a record. `global` is only for Khaneil's policies and repository-wide knowledge. */
export interface MemoryScope {
  /** Atlas building (catalog project id), or "global". */
  project: string;
  /** Workflow definition id. Agents taking part in that workflow may read it across buildings. */
  workflowId?: string;
  /** Only these agents may read it, when set. */
  agentIds?: string[];
}

export interface SourceRef {
  kind: "repository" | "task" | "run" | "handoff" | "person" | "agent" | "external";
  /** A repository path, task id, run/node id, or an https link. Never content. */
  ref: string;
  url?: string;
}

export type Verification = "verified" | "unverified" | "disputed";

export interface ExpiryPolicy {
  /** ttl: deleted from use at `expiresAt`. review: shown as stale after `reviewAt`. none: kept until retired. */
  policy: "ttl" | "review" | "none";
  expiresAt?: string;
  reviewAt?: string;
}

export interface MemoryRecord {
  id: string;
  category: MemoryCategory;
  scope: MemoryScope;
  title: string;
  /** Short text, at most 2,000 characters. Long material stays behind `source`. */
  content: string;
  tags: string[];
  source: SourceRef;
  createdAt: string;
  updatedAt: string;
  createdBy: Actor;
  verification: Verification;
  verifiedBy?: string;
  verifiedAt?: string;
  sensitivity: Sensitivity;
  expiry: ExpiryPolicy;
  /** Text that reads like instructions to a model. Never handed to an agent until a person verifies it. */
  suspicious?: string;
  retiredAt?: string;
  retiredBy?: string;
  /** Records kept in the repository (seeded, version-controlled). Changed only by a pull request. */
  seeded?: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: Actor;
  action: "write" | "verify" | "retire" | "retrieve" | "refused" | "expire" | "decision" | "evaluate" | "feedback" | "proposal" | "version";
  /** Record ids touched, never content. */
  ids: string[];
  note?: string;
}

/** What one retrieval handed to an agent, kept so the Task Center can show the context used. */
export interface ContextRecord {
  key: string;
  taskId: string;
  attempt: number;
  runId?: string;
  nodeId?: string;
  agentId: string;
  at: string;
  query: string;
  items: { id: string; title: string; category: MemoryCategory; verification: Verification; stale: boolean; tokens: number; source: SourceRef }[];
  usedTokens: number;
  budgetTokens: number;
  dropped: Record<string, number>;
  capabilities: string[];
  route: { tier: ModelTierNumber; model: string | null; reason: string };
}

export type ModelTierNumber = 0 | 1 | 2;

export interface EvidenceRef {
  label: string;
  /** A memory id, artifact id or https link. */
  ref: string;
  url?: string;
  verification: Verification;
}

export interface DecisionRecord {
  id: string;
  agentId: string;
  runId?: string;
  taskId?: string;
  nodeId?: string;
  workflowId?: string;
  /** The recommendation itself, one or two sentences. No hidden reasoning is stored. */
  recommendation: string;
  summary: string;
  evidence: EvidenceRef[];
  constraints: string[];
  alternatives: string[];
  uncertainties: string[];
  confidence: "high" | "medium" | "low";
  impact: "low" | "medium" | "high";
  categories: SensitiveCategory[];
  /** Who must approve before it is acted on. Empty when no review is needed. */
  requiredApprovals: string[];
  review: "not_needed" | "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  outcome?: { state: "as_expected" | "worse" | "better" | "unknown"; note: string; at: string; by: string };
  createdAt: string;
  createdBy: Actor;
}

export interface EvaluationMetrics {
  /** 1 completed, 0 failed or cancelled. */
  completion: number | null;
  /** Share of attempts whose output passed the schema. */
  outputValid: number | null;
  /** Linked, checkable evidence against what the schema asks for. */
  evidence: number | null;
  /** 1 when the step ran only through tools it is authorised for. */
  toolSelection: number | null;
  /** 1 when approvals and budget rules held. */
  policy: number | null;
  /** 1 on the first attempt, 1/n after n attempts. */
  reliability: number | null;
  estimatedUsd: number;
  billedUsd: number;
  tokens: number;
  latencyMs: number | null;
}

export interface HumanRating {
  rating: 1 | 2 | 3 | 4 | 5;
  note: string;
  by: string;
  at: string;
}

export interface Evaluation {
  id: string;
  /** taskId:attempt. One evaluation per finished attempt. */
  key: string;
  taskId: string;
  attempt: number;
  runId?: string;
  nodeId?: string;
  agentId: string;
  workflowId?: string;
  workflowVersion?: number;
  promptVersion: string;
  model: string;
  taskType: string;
  at: string;
  metrics: EvaluationMetrics;
  /** 0 to 100 from the deterministic checks; null when nothing could be measured yet. */
  score: number | null;
  flags: string[];
  human?: HumanRating;
}

export interface Feedback {
  id: string;
  taskId: string;
  evaluationId?: string;
  agentId: string;
  rating: HumanRating["rating"];
  note: string;
  by: string;
  at: string;
}

export const PROPOSAL_KINDS = ["prompt", "knowledge_source", "workflow", "validation"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const PROPOSAL_LABEL: Record<ProposalKind, string> = { prompt: "Prompt", knowledge_source: "Knowledge source", workflow: "Workflow", validation: "Validation" };

export interface ImprovementProposal {
  id: string;
  agentId: string;
  kind: ProposalKind;
  title: string;
  change: string;
  rationale: string;
  /** Evaluation, feedback or decision ids that support it. */
  evidenceIds: string[];
  proposedBy: Actor;
  createdAt: string;
  state: "proposed" | "approved" | "rejected" | "applied" | "rolled_back";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  /** Version created when applied. */
  version?: number;
}

/** One entry in an agent's change history. Only a person creates one, and only from an approved proposal. */
export interface AgentVersion {
  id: string;
  agentId: string;
  kind: ProposalKind;
  version: number;
  proposalId: string;
  change: string;
  appliedBy: string;
  at: string;
  /** Where the change was actually made (an n8n version, a PR). Atlas can't edit prompts itself. */
  appliedIn: string;
  rolledBackAt?: string;
  rolledBackBy?: string;
}

export interface IntelligenceFile {
  version: 1;
  rev: number;
  memory: MemoryRecord[];
  decisions: DecisionRecord[];
  evaluations: Evaluation[];
  feedback: Feedback[];
  proposals: ImprovementProposal[];
  versions: AgentVersion[];
  contexts: ContextRecord[];
  audit: AuditEntry[];
}
