// Phase 9 · Supervised autonomous operations: the data model. Everything here is derived from
// records Atlas already keeps (Task Center, execution ledger, n8n and GitHub reads, agent alerts,
// connected signals, executive goals) or arrives through the site's existing authenticated hooks.
// There is no second event bus and no scheduler: a round runs when those records change.

export const EVENT_SYSTEMS = ["github", "n8n", "cloudflare", "atlas", "agent", "integration", "budget", "goal"] as const;
export type EventSystem = (typeof EVENT_SYSTEMS)[number];

/**
 * How Atlas knows who sent an event. Each identity is a check that already exists elsewhere:
 * a signed GitHub webhook, a site route keyed with its own secret, a read Atlas made itself with
 * its own credential, or this device's own records. Anything else is refused.
 */
export const SOURCE_IDENTITIES = ["github-webhook", "github-api", "n8n-api", "agent-feed", "atlas-sync", "cloudflare-api", "atlas-local"] as const;
export type SourceIdentity = (typeof SOURCE_IDENTITIES)[number];

export const IDENTITY_LABEL: Record<SourceIdentity, string> = {
  "github-webhook": "GitHub webhook, signature checked with GITHUB_WEBHOOK_SECRET",
  "github-api": "Read by Atlas from the GitHub API with its own token",
  "n8n-api": "Read by the site from n8n with the read-only API key",
  "agent-feed": "Reported to /api/hooks/agents with AGENT_FEED_TOKEN",
  "atlas-sync": "Reported by the Mac app with the site sync key",
  "cloudflare-api": "Read by the site from Cloudflare",
  "atlas-local": "This device's own Atlas records",
};

export const EVENT_TYPES = [
  "workflow.failed",
  "repo.health_changed",
  "service.unhealthy",
  "task.failed",
  "task.stalled",
  "task.invalid_output",
  "agent.failing",
  "agent.silent",
  "agent.eval_failed",
  "agent.unauthorized",
  "integration.failing",
  "integration.stale",
  "budget.warning",
  "budget.exceeded",
  "goal.deadline",
  "goal.stale",
  "goal.blocked",
  "goal.agent_unavailable",
  "goal.dependency_failed",
  "goal.missing_deliverable",
] as const;
export type OpsEventType = (typeof EVENT_TYPES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };

/** A safe, flat payload: ids, counts and short text only. Never a raw external body. */
export type SafePayload = Record<string, string | number | boolean | null>;

export interface OpsEvent {
  id: string;
  system: EventSystem;
  type: OpsEventType;
  /** Catalog project id (building) when known. */
  project: string | null;
  /** Groups events about the same thing across systems (an agent, a run, an integration, a goal). */
  correlationId: string;
  at: string;
  severity: Severity;
  identity: SourceIdentity;
  /** What it is about: a workflow id, task id, integration id, agent id... */
  resource: string;
  /** The same failure seen twice has the same key. */
  dedupKey: string;
  payload: SafePayload;
  /** https link to the evidence in the source system, when there is one. */
  artifactUrl?: string;
}

export type IncidentState = "open" | "recovering" | "awaiting_approval" | "escalated" | "resolved" | "dismissed";
export const INCIDENT_STATE_LABEL: Record<IncidentState, string> = {
  open: "Open",
  recovering: "Recovering",
  awaiting_approval: "Waiting for Khaneil",
  escalated: "Escalated to Khaneil",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

/** Source-specific evidence kept for every system that reported the incident. */
export interface Evidence {
  system: EventSystem;
  identity: SourceIdentity;
  resource: string;
  type: OpsEventType;
  at: string;
  detail: string;
  url?: string;
}

export interface Incident {
  id: string;
  /** The correlation id the incident groups by. */
  key: string;
  title: string;
  severity: Severity;
  state: IncidentState;
  project: string | null;
  types: OpsEventType[];
  systems: EventSystem[];
  eventIds: string[];
  evidence: Evidence[];
  firstAt: string;
  lastAt: string;
  /** Events seen for it, repeats included. */
  count: number;
  /** Set when the same failure kept coming back (count over the repeat threshold within a day). */
  repeated: boolean;
  /** Related records across Atlas, by their existing ids. */
  taskIds: string[];
  runIds: string[];
  goalIds: string[];
  agentIds: string[];
  /** Plain words on what else this affects (goals, waiting steps). */
  impact: string[];
  /** The Task Center task made for it, when there is one. */
  incidentTaskId?: string;
  playbookId?: string;
  attemptIds: string[];
  escalation?: { at: string; reason: string };
  resolvedAt?: string;
  resolution?: string;
  /** True only when Atlas observed the condition clear after the source answered again. */
  verified?: boolean;
  reopened?: number;
}

export type AttemptOutcome = "dispatched" | "succeeded" | "failed" | "unknown" | "refused";

export interface RecoveryAttempt {
  id: string;
  incidentId: string;
  playbookId: string;
  number: number;
  /** Who started it: Khaneil, or Atlas under a policy. */
  actor: { kind: "person" | "system"; name: string };
  idempotencyKey: string;
  correlationId: string;
  outcome: AttemptOutcome;
  startedAt: string;
  finishedAt?: string;
  detail: string;
  /** pending until the source is observed again after the attempt. */
  verification?: { state: "pending" | "passed" | "failed"; at?: string; detail: string };
  /** When the next automatic try is allowed (bounded backoff). */
  nextRetryAt?: string;
  /** Model spend of the attempt. Every Phase 9 playbook is deterministic, so this stays 0. */
  modelUsd: number;
}

/** An owner-defined policy for one playbook. Only Khaneil changes these. */
export interface OpsPolicy {
  playbookId: string;
  /** Approved by Khaneil for automatic use (still needs autonomy level 3). Off by default. */
  enabled: boolean;
  /** Catalog project ids the policy covers; ["*"] for every project. */
  projects: string[];
  /** Optional UTC hour window [from, to) when automatic runs are allowed. */
  hours?: { from: number; to: number };
  /** Automatic attempts per incident before escalating. */
  maxRetries: number;
  /** Automatic attempts per hour across all incidents. */
  perHour: number;
  /** Model spend allowed per day for this policy. 0: no model calls. */
  modelBudgetUsd: number;
}

export interface OpsStop {
  active: boolean;
  at: string;
  by: string;
  reason: string;
  /** What the site answered when Atlas asked it to hold n8n step sends too. */
  site?: "confirmed" | "not_reached" | "not_available";
}

export const METRICS = ["events_received", "events_rejected", "events_duplicate", "incidents_created", "incidents_reopened", "tasks_created", "policies_evaluated", "actions_dispatched", "actions_refused", "recovery_attempts", "verifications_passed", "verifications_failed", "approvals_requested", "escalations", "stops", "resumes", "model_calls"] as const;
export type Metric = (typeof METRICS)[number];

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  correlationId?: string;
  detail?: string;
}

export interface OpsFile {
  version: 1;
  rev: number;
  stop: OpsStop | null;
  policies: Record<string, OpsPolicy>;
  events: OpsEvent[];
  incidents: Incident[];
  attempts: RecoveryAttempt[];
  /** Append-only, ids and short redacted text. Bounded. Never paused by the emergency stop. */
  audit: AuditEntry[];
  counters: Record<Metric, number>;
}
