// Atlas Engineering Division (Phase 2): the shared data model for the Engineering and QA agents.
// Used by the site's server code (server/engineering/, server/executive/engine.ts), the tests and
// the Engineering Operations panel, so the browser and the server agree on one shape. No secrets.
//
// The division extends the Atlas Executive; it is not a second orchestrator. Every engineering job is
// an Executive goal with a fixed plan (implement -> QA -> deliver -> report), every step is an
// Executive task with a Task Center record, and every state change is in the Atlas database.

export const ENGINEER_AGENT_ID = "atlas-engineer";
export const QA_AGENT_ID = "atlas-qa";
export const MONITOR_ACTOR = "atlas-github-monitor";

/** The engineering lifecycle from Khaneil's Phase 2 directive, plus the side states. */
export const ENGINEERING_PHASES = [
  "TASK_ASSIGNED",
  "CONTEXT_COLLECTED",
  "IMPLEMENTATION_PLANNED",
  "POLICY_CHECKED",
  "WORKSPACE_PREPARED",
  "CODE_MODIFIED",
  "VALIDATION_STARTED",
  "VALIDATION_COMPLETED",
  "QA_REVIEW_REQUESTED",
  "PR_READY",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "AWAITING_APPROVAL",
] as const;
export type EngineeringPhase = (typeof ENGINEERING_PHASES)[number];

/** The main line, in order. The runner reports the middle part with the times its jobs ran. */
export const PHASE_ORDER: readonly EngineeringPhase[] = ENGINEERING_PHASES.slice(0, 10);
export const SIDE_PHASES: ReadonlySet<EngineeringPhase> = new Set(["BLOCKED", "FAILED", "CANCELLED", "AWAITING_APPROVAL"]);
export const TERMINAL_PHASES: ReadonlySet<EngineeringPhase> = new Set(["FAILED", "CANCELLED", "PR_READY"]);

export const PHASE_LABEL: Record<EngineeringPhase, string> = {
  TASK_ASSIGNED: "Assigned",
  CONTEXT_COLLECTED: "Logs and context collected",
  IMPLEMENTATION_PLANNED: "Fix planned",
  POLICY_CHECKED: "Change checked against the rules",
  WORKSPACE_PREPARED: "Clean workspace ready",
  CODE_MODIFIED: "Code changed",
  VALIDATION_STARTED: "Checks running",
  VALIDATION_COMPLETED: "Checks finished",
  QA_REVIEW_REQUESTED: "With QA",
  PR_READY: "Ready for review",
  BLOCKED: "Blocked",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  AWAITING_APPROVAL: "Waiting for your approval",
};

/** What an agent's desk shows, derived from real phases only. */
export type Activity = "IDLE" | "INVESTIGATING" | "CODING" | "TESTING" | "REVIEWING" | "BLOCKED";

export const QA_OUTCOMES = ["PASS", "FAIL", "BLOCKED", "NEEDS_REVIEW"] as const;
export type QaOutcome = (typeof QA_OUTCOMES)[number];

/** The failure kinds Atlas may try to repair on its own. Everything else goes to Khaneil. */
export const SUPPORTED_CATEGORIES = ["lint", "typecheck", "test"] as const;
export type SupportedCategory = (typeof SUPPORTED_CATEGORIES)[number];
export type FailureCategory = SupportedCategory | "build" | "visual" | "rust" | "security" | "release" | "infrastructure" | "unknown";

export const CATEGORY_LABEL: Record<FailureCategory, string> = {
  lint: "Lint",
  typecheck: "Type check",
  test: "Unit tests",
  build: "Build",
  visual: "Screenshot checks",
  rust: "Desktop shell (Rust)",
  security: "Security or dependency audit",
  release: "Signing or release",
  infrastructure: "Runner or network",
  unknown: "Not recognised",
};

export type IncidentStatus = "detected" | "assigned" | "awaiting_approval" | "repairing" | "pr_open" | "resolved" | "escalated" | "failed" | "ignored";
export const OPEN_INCIDENT_STATUSES: readonly IncidentStatus[] = ["detected", "assigned", "awaiting_approval", "repairing"];

/** Hard limits. The engine, the runner and QA each enforce their part in code. */
export const ENGINEERING_LIMITS = {
  /** QA sends a failed change back at most this many times; then Khaneil gets it. */
  maxRepairIterations: 2,
  /** One open engineering job per repository (no conflicting writes). */
  openJobsPerRepo: 1,
  /** New automatic repair jobs across all repositories in 24 hours. */
  dailyAutoJobs: 3,
  /** Highest model spend for one implementation run, USD (the runner also caps turns and time). */
  implementCapUsd: 1,
  /** A whole engineering goal, USD: three implementation runs at most. */
  goalBudgetUsd: 3.5,
  /** The change the runner may produce. */
  maxFilesChanged: 10,
  maxLinesChanged: 400,
  /** Claude Code turns per run. */
  maxTurns: 30,
  /** Only failures this recent are picked up by the reconciliation sweep. */
  reconcileWindowHours: 6,
  /** Minutes the whole runner may take before the Executive treats the attempt as stalled. */
  runnerTimeoutMinutes: 55,
} as const;

/** The branch prefix every engineering change uses. The runner refuses to push anything else. */
export const BRANCH_PREFIX = "atlas-eng/";

export interface FailedJob {
  name: string;
  steps: string[];
  url: string | null;
}

/** A CI failure as Atlas recorded it (atlas.eng_incidents). */
export interface IncidentView {
  id: string;
  repo: string;
  workflowName: string;
  workflowPath: string | null;
  runId: number;
  runUrl: string | null;
  headSha: string;
  branch: string;
  category: FailureCategory;
  supported: boolean;
  failedJobs: FailedJob[];
  status: IncidentStatus;
  decision: string | null;
  source: "webhook" | "reconcile" | "fixture";
  goalId: string | null;
  ownerTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationClaim {
  name: string;
  command: string;
  passed: boolean;
}

/** One implementation attempt (atlas.eng_executions). */
export interface ExecutionView {
  id: string;
  goalId: string;
  taskId: string;
  taskRecordId: string | null;
  incidentId: string | null;
  repo: string;
  attempt: number;
  repairIteration: number;
  phase: EngineeringPhase;
  runner: string;
  runnerRunId: string | null;
  runnerUrl: string | null;
  baseSha: string;
  headSha: string | null;
  branch: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  turns: number | null;
  filesChanged: string[];
  /** What the runner reported. Not trusted: QA reads the real check results from GitHub. */
  claimedValidation: ValidationClaim[];
  qaOutcome: QaOutcome | null;
  qaReport: QaReport | null;
  prUrl: string | null;
  prNumber: number | null;
  failureCategory: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QaCheck {
  name: string;
  passed: boolean;
  /** Where the evidence came from: "github" (read by Atlas) or "rule" (Atlas's own check of the diff). */
  source: "github" | "rule";
  detail?: string;
}

export interface QaReport {
  schema: "qa-report/1";
  outcome: QaOutcome;
  checkedAt: string;
  runId: string;
  headSha: string | null;
  checks: QaCheck[];
  /** Plain feedback for the next engineering attempt (only on FAIL). */
  feedback: string[];
  securityRelevant: string[];
  dependencyChanges: string[];
}

export interface RepoView {
  repo: string;
  defaultBranch: string;
  autoRepair: boolean;
  lastSeenSha: string | null;
  lastCheckedAt: string | null;
}

export interface EngineeringAgentView {
  id: string;
  name: string;
  status: string;
  activity: Activity;
  currentTaskId: string | null;
}

/** What the Engineering Operations panel reads (GET /api/executive/engineering). */
export interface EngineeringOverview {
  configured: { database: boolean; n8n: boolean; github: boolean; runnerCallback: boolean; enabled: boolean };
  agents: EngineeringAgentView[];
  repos: RepoView[];
  incidents: IncidentView[];
  executions: ExecutionView[];
  spend: { last30Usd: number; runs30: number; inputTokens30: number; outputTokens30: number };
}
