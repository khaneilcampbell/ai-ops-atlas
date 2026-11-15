import type { Actor, AiUsage, WorkflowKind } from "../tasks/types";

// Workflow execution: the records the orchestrator keeps next to the Task Center. Tasks stay the
// single source of status, attempts and approvals; the ledger only adds what tasks don't hold:
// validated handoffs between steps, processed event ids, dispatch keys, waivers, the run's start
// authorisation and the business outcome. Workflow Intelligence reads both, never a copy.

export const ENVELOPE_VERSION = 1;

/** A pointer to something a step produced. Large outputs live behind the link, never in the record. */
export interface ArtifactRef {
  id: string;
  label: string;
  /** https only. */
  url: string;
  kind: "document" | "sheet" | "github_run" | "pull_request" | "n8n_execution" | "link";
  bytes?: number;
}

/** The structured result a step hands to the steps after it. Values are short; documents are artifacts. */
export type OutputValue = string | number | boolean | string[];
export interface StepOutput {
  /** Which output schema the producer says it wrote. */
  schema: string;
  fields: Record<string, OutputValue>;
  artifacts: ArtifactRef[];
}

/** The standard envelope every handoff between two steps travels in. */
export interface HandoffEnvelope {
  envelopeVersion: typeof ENVELOPE_VERSION;
  runId: string;
  /** The receiving step's Task Center task. */
  taskId: string;
  nodeId: string;
  sourceAgentIds: string[];
  destinationAgentId: string | null;
  inputSchema: string;
  outputSchema: string;
  /** Upstream outputs, validated, keyed by node id. A waived step appears with `waived: true` and no fields. */
  inputs: Record<string, { schema: string; fields: Record<string, OutputValue>; artifacts: ArtifactRef[]; waived?: boolean; unverified?: boolean }>;
  artifacts: ArtifactRef[];
  /** Same for every message of one run, for tracing across systems. */
  correlationId: string;
  /** Task id + attempt number: the receiving system must treat a repeat as the same request. */
  idempotencyKey: string;
  /** The attempt this send belongs to; reports must name it. */
  attemptId?: string;
  at: string;
}

/** A recorded handoff: what a step produced and whether it passed its schema. */
export interface HandoffRecord {
  nodeId: string;
  taskId: string;
  attempt: number;
  at: string;
  /** validated: passed the schema. unverified: completed outside the orchestrator with no structured output. waived: a person waived it. */
  state: "validated" | "unverified" | "waived";
  output?: StepOutput;
  by: string;
  reason?: string;
}

export interface ValidationFailure {
  nodeId: string;
  attempt: number;
  at: string;
  errors: string[];
}

/** What an executing system reports back. Only accepted for the step's live attempt. */
export interface ExecutionReport {
  /** Unique per report from the sender; a repeat id is ignored. */
  eventId: string;
  runId: string;
  nodeId: string;
  attemptId: string;
  kind: "started" | "succeeded" | "failed";
  source: Actor;
  externalId?: string;
  externalUrl?: string;
  output?: StepOutput;
  error?: string;
  /** Transient failures (timeouts, 5xx) may be retried automatically when the adapter is safe to repeat. */
  transient?: boolean;
  /** Only what the provider reported. Never filled in by Atlas. */
  usage?: Omit<AiUsage, "recordedAt" | "attemptId">;
  at: string;
}

export interface BusinessOutcome {
  state: "achieved" | "not_achieved" | "too_early";
  note: string;
  /** Metrics with where they came from, e.g. Stripe. "achieved" needs at least one. */
  metrics: { name: string; value: number; source: string }[];
  recordedAt: string;
  recordedBy: string;
}

export interface RunLedger {
  runId: string;
  rev: number;
  /** Who authorised execution, and when. Unset until a person starts the run. */
  startedBy?: string;
  startedAt?: string;
  handoffs: Record<string, HandoffRecord>;
  validationFailures: ValidationFailure[];
  /** Report ids already applied (bounded). */
  processedEvents: string[];
  /** Idempotency keys already sent to an adapter. A key in here is never sent again. */
  dispatched: string[];
  /** Steps whose last attempt's fate is unknown and need a person to check the outside system first. */
  needsReconcile: Record<string, string>;
  /** Earliest time each step may be retried automatically (bounded backoff). */
  retryAfter: Record<string, string>;
  outcome?: BusinessOutcome;
  cancelledAt?: string;
}

export type RunStatus = "not_started" | "running" | "waiting_on_person" | "blocked" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export interface DispatchResult {
  /** accepted: the system took it. refused: it was not sent (safe to try again). unknown: it may have been sent. */
  state: "accepted" | "refused" | "unknown";
  externalId?: string;
  externalUrl?: string;
  error?: string;
}

/** What the outside system says about an attempt Atlas lost track of. */
export type ExternalStatus = { state: "running" } | { state: "succeeded"; output?: StepOutput } | { state: "failed"; error: string } | { state: "not_found" } | { state: "unknown" };

export interface AdapterAvailability {
  ok: boolean;
  /** When not ok: exactly what has to be connected for Atlas to run it. */
  need?: string;
}

export interface ExecutionAdapter {
  kind: WorkflowKind | "simulated";
  /** True when running the step changes something outside Atlas (sends, writes, charges). */
  sideEffects: boolean;
  /** True when the receiving system honours the idempotency key, so a repeat can't act twice. */
  idempotent: boolean;
  /** True when a person must press start (e.g. Touch ID); the orchestrator never dispatches these on its own. */
  personStarts: boolean;
  available(nodeId: string, agentId: string | undefined): AdapterAvailability;
  dispatch(env: HandoffEnvelope): Promise<DispatchResult>;
  /** Asks the outside system about one attempt. Absent when the system can't be asked. */
  status?(attempt: { id: string; externalId?: string; requestedAt: string; idempotencyKey: string }, step: { nodeId: string; agentId?: string }): Promise<ExternalStatus>;
}
