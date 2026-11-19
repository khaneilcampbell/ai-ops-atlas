import { validArtifact } from "./handoff";
import type { ExecutionReport, HandoffEnvelope, StepOutput } from "./types";

// The n8n bridge contract, shared by the site (server/n8nBridge.ts) and the app. This file is in a
// public repository on purpose: it holds no secret. The webhook is protected by a secret only the
// site and n8n hold, not by its path.
//
// Only research and planning steps can be started, through one restricted n8n workflow that has no
// email, Notion, shop or publish tools. Approvals, development and publication never go this way;
// the site refuses any other step even when called directly.

export const BRIDGE_STEPS = ["market-research", "customer-research", "competitor-analysis", "scoring", "brief", "planning"] as const;
export type BridgeStep = (typeof BRIDGE_STEPS)[number];
export const isBridgeStep = (s: unknown): s is BridgeStep => typeof s === "string" && (BRIDGE_STEPS as readonly string[]).includes(s);

/** n8n webhook path of the restricted step runner workflow. */
export const STEP_RUNNER_PATH = "atlas-step-runner";
export const MAX_ENVELOPE_BYTES = 64_000;
export const MAX_REPORT_BYTES = 64_000;
/** At most this many steps sent to n8n in 24 hours, whoever asks. */
export const DAILY_DISPATCH_CAP = 20;
/** Reports and dispatch records are deleted after this long. */
export const KEEP_DAYS = 30;

const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Checks the envelope the app asks the site to send. Shape only; the step must be allow-listed. */
export function dispatchProblem(body: unknown): string | null {
  if (!obj(body)) return "The body must be a handoff envelope.";
  const e = body as Partial<HandoffEnvelope>;
  if (e.envelopeVersion !== 1) return "Unknown envelope version.";
  if (!isBridgeStep(e.nodeId)) return `Step ${String(e.nodeId)} can't be started from Atlas. Only research and planning steps can.`;
  for (const k of ["runId", "taskId", "attemptId", "idempotencyKey", "correlationId", "outputSchema", "inputSchema", "at"] as const) if (!str(e[k], 300)) return `Missing ${k}.`;
  if (!/^[\w:-]{3,120}$/.test(e.idempotencyKey!)) return "Bad idempotency key.";
  if (Number.isNaN(Date.parse(e.at!))) return "Bad timestamp.";
  if (!obj(e.inputs)) return "Inputs must be an object.";
  if (!Array.isArray(e.artifacts) || e.artifacts.some((a) => !validArtifact(a))) return "Artifacts must be https links.";
  return null;
}

/** What the step runner posts back. The site fills in the source; anything else in the body is dropped. */
export interface StepReportBody {
  eventId: string;
  idempotencyKey: string;
  runId: string;
  nodeId: BridgeStep;
  attemptId: string;
  kind: "started" | "succeeded" | "failed";
  executionId?: string;
  output?: StepOutput;
  error?: string;
  transient?: boolean;
  usage?: { model: string; provider: string; inputTokens?: number; outputTokens?: number; totalTokens?: number; cost?: { usd: number; basis: "estimated" | "billed" }; durationMs?: number };
  at: string;
}

const num = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0);

/** The cleaned report, or why it's refused. Output fields are re-validated by the orchestrator. */
export function parseStepReport(body: unknown): { ok: true; report: StepReportBody } | { ok: false; error: string } {
  if (!obj(body)) return { ok: false, error: "Not an object." };
  const b = body;
  if (!str(b.eventId, 120) || !str(b.idempotencyKey, 120) || !str(b.runId, 120) || !str(b.attemptId, 120)) return { ok: false, error: "Missing eventId, idempotencyKey, runId or attemptId." };
  if (!isBridgeStep(b.nodeId)) return { ok: false, error: "Unknown step." };
  if (b.kind !== "started" && b.kind !== "succeeded" && b.kind !== "failed") return { ok: false, error: "kind must be started, succeeded or failed." };
  if (!str(b.at, 40) || Number.isNaN(Date.parse(b.at))) return { ok: false, error: "Bad timestamp." };
  if (b.error !== undefined && !str(b.error, 1000)) return { ok: false, error: "error must be short text." };
  if (b.executionId !== undefined && !str(String(b.executionId), 60)) return { ok: false, error: "Bad executionId." };
  let usage: StepReportBody["usage"];
  if (b.usage !== undefined) {
    const u = b.usage as Record<string, unknown>;
    const cost = u?.cost as Record<string, unknown> | undefined;
    if (!obj(u) || !str(u.model, 80) || !str(u.provider, 40) || ![u.inputTokens, u.outputTokens, u.totalTokens, u.durationMs].every(num)) return { ok: false, error: "Bad usage." };
    if (cost !== undefined && (!obj(cost) || !num(cost.usd) || (cost.basis !== "estimated" && cost.basis !== "billed"))) return { ok: false, error: "Bad usage cost." };
    usage = {
      model: u.model,
      provider: u.provider,
      ...(u.inputTokens !== undefined ? { inputTokens: u.inputTokens as number } : {}),
      ...(u.outputTokens !== undefined ? { outputTokens: u.outputTokens as number } : {}),
      ...(u.totalTokens !== undefined ? { totalTokens: u.totalTokens as number } : {}),
      ...(u.durationMs !== undefined ? { durationMs: u.durationMs as number } : {}),
      ...(cost ? { cost: { usd: cost.usd as number, basis: cost.basis as "estimated" | "billed" } } : {}),
    };
  }
  const o = b.output as Record<string, unknown> | undefined;
  const output = o && obj(o) ? ({ schema: String(o.schema ?? ""), fields: obj(o.fields) ? o.fields : {}, artifacts: Array.isArray(o.artifacts) ? o.artifacts : [] } as StepOutput) : undefined;
  return {
    ok: true,
    report: {
      eventId: b.eventId,
      idempotencyKey: b.idempotencyKey,
      runId: b.runId,
      nodeId: b.nodeId,
      attemptId: b.attemptId,
      kind: b.kind,
      at: new Date(b.at).toISOString(),
      ...(b.executionId !== undefined ? { executionId: String(b.executionId) } : {}),
      ...(output ? { output } : {}),
      ...(typeof b.error === "string" ? { error: b.error } : {}),
      ...(b.transient === true ? { transient: true } : {}),
      ...(usage ? { usage } : {}),
    },
  };
}

export const N8N_SOURCE = { kind: "n8n", id: "atlas-step-runner", name: "n8n step runner" } as const;

/** A stored report as the orchestrator takes it. The source is always the step runner, set here, never by the sender. */
export function toExecutionReport(r: StepReportBody): ExecutionReport {
  return {
    eventId: r.eventId,
    runId: r.runId,
    nodeId: r.nodeId,
    attemptId: r.attemptId,
    kind: r.kind,
    source: { ...N8N_SOURCE },
    at: r.at,
    ...(r.executionId ? { externalId: r.executionId } : {}),
    ...(r.output ? { output: r.output } : {}),
    ...(r.error ? { error: r.error } : {}),
    ...(r.transient ? { transient: true } : {}),
    ...(r.usage ? { usage: r.usage } : {}),
  };
}
