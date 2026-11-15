// Atlas Task Center: the task model. Tasks are plain data; every change goes through the
// lifecycle rules in lifecycle.ts and is saved by a TaskRepository (store.ts).

export const TASK_STATUSES = ["queued", "running", "blocked", "awaiting_approval", "completed", "failed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SOURCES = ["manual", "agent", "n8n", "github", "system"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/** Kinds of action that always need a person's approval before they run. */
export const SENSITIVE_CATEGORIES = ["production_deploy", "repository_change", "customer_message", "financial", "destructive", "infrastructure"] as const;
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

/** Who did something. A person can approve; an agent, a workflow or Atlas itself never can. */
export type Actor =
  | { kind: "person"; id: string; name: string }
  | { kind: "agent"; id: string; name: string }
  | { kind: "system"; id: string; name: string }
  | { kind: "n8n"; id: string; name: string }
  | { kind: "github"; id: string; name: string };

/** Where the work runs. `manual` means a person does it and records the outcome. */
export type WorkflowKind = "n8n" | "github" | "manual";

export interface WorkflowRef {
  kind: WorkflowKind;
  /** n8n workflow id, or the GitHub workflow file name. Empty for manual work. */
  id: string;
  label: string;
  repository?: string;
  url?: string;
}

export type AttemptState = "requested" | "running" | "succeeded" | "failed" | "cancel_requested" | "cancelled" | "unknown";

/** One try at running a task. The idempotency key stops the same attempt being sent twice. */
export interface ExecutionAttempt {
  id: string;
  number: number;
  idempotencyKey: string;
  state: AttemptState;
  executor: WorkflowKind;
  requestedAt: string;
  requestedBy: Actor;
  startedAt?: string;
  finishedAt?: string;
  /** GitHub run id or n8n execution id, once the external system confirms one. */
  externalId?: string;
  externalUrl?: string;
  /** The Mac app's audit log id for a GitHub write. */
  auditId?: string;
  error?: string;
}

export type ApprovalDecision = "requested" | "granted" | "rejected";

export interface ApprovalRecord {
  id: string;
  decision: ApprovalDecision;
  at: string;
  actor: Actor;
  reason?: string;
  /** Which attempt number the decision covers: approval is per run, never standing. */
  forAttempt: number;
}

/** Model usage a provider reported for a run. Never estimated by another model call. */
export interface AiUsage {
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** "estimated" is worked out from published prices; "billed" comes from the provider's invoice. */
  cost?: { usd: number; basis: "estimated" | "billed" };
  durationMs?: number;
  attemptId?: string;
  recordedAt: string;
}

export interface TaskArtifact {
  id: string;
  label: string;
  url: string;
  kind: "link" | "github_run" | "n8n_execution" | "pull_request" | "file";
  at: string;
}

export const EVENT_TYPES = [
  "created",
  "edited",
  "assigned",
  "status_changed",
  "approval_requested",
  "approval_granted",
  "approval_rejected",
  "execution_started",
  "execution_completed",
  "execution_failed",
  "retry_requested",
  "cancellation_requested",
  "external_confirmed",
  "dependency_blocked",
] as const;
export type TaskEventType = (typeof EVENT_TYPES)[number];

/** An append-only history entry. Metadata holds ids and short text only, never secrets or payloads. */
export interface TaskEvent {
  id: string;
  taskId: string;
  at: string;
  actor: Actor;
  type: TaskEventType;
  meta?: Record<string, string | number | boolean | null>;
}

export interface AtlasTask {
  id: string;
  title: string;
  description: string;
  objective?: string;

  status: TaskStatus;
  priority: TaskPriority;

  agentId?: string;
  buildingId?: string;
  workflowId?: string;

  source: TaskSource;

  parentTaskId?: string;
  dependencyIds: string[];

  requiresApproval: boolean;

  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;

  result?: unknown;
  error?: string;
}

/** A task as stored: the core model plus everything recorded about it. */
export interface StoredTask extends AtlasTask {
  /** Bumped on every write; a write that names an older revision is refused (compare-and-set). */
  rev: number;
  createdBy: Actor;
  /** Names kept from the moment of assignment, so history still reads after an agent retires. */
  agentName?: string;
  buildingName?: string;
  workflow?: WorkflowRef;
  categories: SensitiveCategory[];
  maxAttempts: number;
  attempts: ExecutionAttempt[];
  approvals: ApprovalRecord[];
  artifacts: TaskArtifact[];
  usage: AiUsage[];
  /** Set when a stop was asked for but the external system has not confirmed it yet. */
  cancelRequestedAt?: string;
  /** Automated intake key: a second event with the same key never makes a second task. */
  intakeKey?: string;
  events: TaskEvent[];
  /** How many older events were dropped to keep history bounded. */
  eventsTrimmed: number;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Queued",
  running: "Running",
  blocked: "Blocked",
  awaiting_approval: "Awaiting approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };

export const SOURCE_LABEL: Record<TaskSource, string> = { manual: "Manual", agent: "Agent", n8n: "n8n", github: "GitHub", system: "Atlas" };

export const CATEGORY_LABEL: Record<SensitiveCategory, string> = {
  production_deploy: "Production deployment",
  repository_change: "Repository change",
  customer_message: "Customer-facing message",
  financial: "Financial transaction",
  destructive: "Destructive operation",
  infrastructure: "Critical infrastructure",
};

export const KHANEIL: Actor = { kind: "person", id: "khaneil", name: "Khaneil" };
export const ATLAS: Actor = { kind: "system", id: "atlas", name: "Atlas" };
