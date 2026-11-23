// The n8n workflow contracts between the Atlas site and n8n. Public on purpose: no secret here.
//
//   ATLAS_EXECUTIVE_DISPATCH  Atlas -> n8n "Atlas · Executive Dispatch" webhook (header key
//                             N8N_BRIDGE_TOKEN). n8n checks the envelope and runs the mapped route.
//   ATLAS_WORKFLOW_RESULT     n8n -> POST /api/hooks/executive-result (key N8N_BRIDGE_CALLBACK_TOKEN)
//   ATLAS_EXECUTIVE_ERROR     same endpoint, kind "failed": diagnostics for a failed run
//   ATLAS_EXECUTIVE_SCHEDULE  n8n "Atlas · Executive Schedule" -> POST /api/hooks/executive-tick:
//                             reconciliation only; it never creates goals or tasks.
//
// A result is accepted only for an attempt the site sent: same task, attempt, correlation id and
// idempotency key, plus the one-time nonce sent with that attempt. Each event id is stored once.

export const DISPATCH_VERSION = 1;

export interface WorkflowRoute {
  route: string;
  workflow: string;
  workflowId: string | null;
  webhookPath: string;
  timeoutSeconds: number;
  maxAttempts: number;
  maxSearches: number;
  /** The result schema the route's output must match (Atlas verifies it before anything counts). */
  resultSchema: string;
  /** Runs inside the Atlas site (no n8n, no model), through the same claim, attempt and result path. */
  local?: boolean;
}

/** Capability -> n8n workflow. Only these run outside Atlas; everything else is in-process or refused. */
export const WORKFLOW_ROUTES: Readonly<Record<string, WorkflowRoute>> = {
  "research.opportunity_report": {
    route: "opportunity-report",
    workflow: "Atlas · Executive Dispatch",
    // n8n workflow id of the draft created 2026-11-22 (docs/executive-agent.md).
    workflowId: "uNF4qBQDwVb37ygb",
    webhookPath: "atlas-executive-dispatch",
    timeoutSeconds: 300,
    maxAttempts: 3,
    maxSearches: 5,
    resultSchema: "opportunity-report/1",
  },
  // Engineering Division (Phase 2). n8n starts the repository's runner workflow; the runner's report
  // job posts the result to /api/hooks/engineering-result. n8n drafts created 2026-11-23
  // (docs/engineering-division.md); unpublished until Khaneil says so.
  "engineering.implement_fix": {
    route: "engineering-repair",
    workflow: "Atlas · Engineering Dispatch",
    workflowId: "IAtPkKS8fhFFsRWP",
    webhookPath: "atlas-engineering-dispatch",
    timeoutSeconds: 55 * 60,
    maxAttempts: 2,
    maxSearches: 0,
    resultSchema: "engineering-change/1",
  },
  "qa.verify_change": {
    route: "qa-validation",
    workflow: "Atlas QA (inside Atlas)",
    workflowId: null,
    webhookPath: "",
    timeoutSeconds: 120,
    // QA looks again about every 5 minutes while the checks run on the branch: about 20 minutes in all.
    // (5 is the database's limit on attempts.)
    maxAttempts: 5,
    maxSearches: 0,
    resultSchema: "qa-report/1",
    local: true,
  },
  "engineering.deliver_pr": {
    route: "pr-delivery",
    workflow: "Atlas · GitHub PR Delivery",
    workflowId: "1k0B7tA9PACRgOMI",
    webhookPath: "atlas-github-pr-delivery",
    timeoutSeconds: 300,
    maxAttempts: 2,
    maxSearches: 0,
    resultSchema: "pr-delivery/1",
  },
};

export interface DispatchEnvelope {
  contract: "ATLAS_EXECUTIVE_DISPATCH";
  version: 1;
  route: string;
  goalId: string;
  taskId: string;
  attempt: number;
  correlationId: string;
  idempotencyKey: string;
  nonce: string;
  deadlineAt: string;
  inputs: Record<string, string>;
  limits: { maxSearches: number; maxOutputTokens: number };
}

export interface ResultBody {
  contract: "ATLAS_WORKFLOW_RESULT" | "ATLAS_EXECUTIVE_ERROR";
  version: 1;
  eventId: string;
  taskId: string;
  attempt: number;
  correlationId: string;
  idempotencyKey: string;
  nonce: string;
  executionId: string;
  kind: "succeeded" | "failed";
  report?: unknown;
  /** Route-specific output (engineering-change/1, qa-report/1, pr-delivery/1). */
  artifact?: unknown;
  searched?: string[];
  error?: string;
  transient?: boolean;
  usage?: { model: string; inputTokens: number; outputTokens: number; webSearches: number; costUsd?: number };
  at: string;
}

export const MAX_RESULT_BYTES = 96_000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const count = (v: unknown, max: number) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict parse of an untrusted result body. Unknown fields are dropped. */
export function parseResult(raw: unknown): { ok: true; value: ResultBody } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "Not an object." };
  if (raw.contract !== "ATLAS_WORKFLOW_RESULT" && raw.contract !== "ATLAS_EXECUTIVE_ERROR") return { ok: false, error: "Unknown contract." };
  if (raw.version !== 1) return { ok: false, error: "Unknown version." };
  if (!str(raw.eventId, 200) || !str(raw.correlationId, 120) || !str(raw.idempotencyKey, 128) || !str(raw.nonce, 128)) return { ok: false, error: "Missing eventId, correlationId, idempotencyKey or nonce." };
  if (typeof raw.taskId !== "string" || !UUID.test(raw.taskId)) return { ok: false, error: "Bad taskId." };
  if (!count(raw.attempt, 10) || (raw.attempt as number) < 1) return { ok: false, error: "Bad attempt." };
  if (!str(String(raw.executionId ?? ""), 60)) return { ok: false, error: "Missing executionId." };
  if (raw.kind !== "succeeded" && raw.kind !== "failed") return { ok: false, error: "kind must be succeeded or failed." };
  if (raw.contract === "ATLAS_EXECUTIVE_ERROR" && raw.kind !== "failed") return { ok: false, error: "An error report must be kind failed." };
  if (!str(raw.at, 40) || Number.isNaN(Date.parse(raw.at))) return { ok: false, error: "Bad timestamp." };
  if (raw.error !== undefined && !str(raw.error, 1000)) return { ok: false, error: "error must be short text." };
  let usage: ResultBody["usage"];
  if (raw.usage !== undefined) {
    const u = raw.usage;
    if (!isObj(u) || !str(u.model, 80) || !count(u.inputTokens, 5_000_000) || !count(u.outputTokens, 1_000_000) || !count(u.webSearches, 50)) return { ok: false, error: "Bad usage." };
    const reported = typeof u.costUsd === "number" && Number.isFinite(u.costUsd) && u.costUsd >= 0 && u.costUsd < 100 ? { costUsd: u.costUsd } : {};
    usage = { model: u.model, inputTokens: u.inputTokens as number, outputTokens: u.outputTokens as number, webSearches: u.webSearches as number, ...reported };
  }
  const searched = Array.isArray(raw.searched) ? raw.searched.filter((x): x is string => typeof x === "string" && x.length <= 2000).slice(0, 100) : [];
  return {
    ok: true,
    value: {
      contract: raw.contract,
      version: 1,
      eventId: raw.eventId,
      taskId: raw.taskId.toLowerCase(),
      attempt: raw.attempt as number,
      correlationId: raw.correlationId,
      idempotencyKey: raw.idempotencyKey,
      nonce: raw.nonce,
      executionId: String(raw.executionId),
      kind: raw.kind,
      ...(raw.report !== undefined ? { report: raw.report } : {}),
      ...(raw.artifact !== undefined ? { artifact: raw.artifact } : {}),
      searched,
      ...(typeof raw.error === "string" ? { error: raw.error } : {}),
      ...(raw.transient === true ? { transient: true } : {}),
      ...(usage ? { usage } : {}),
      at: new Date(raw.at).toISOString(),
    },
  };
}

/** Model prices for cost estimates (USD per million tokens; web search per search). Basis: estimated. */
export const PRICES: Readonly<Record<string, { inputPerM: number; outputPerM: number }>> = {
  "claude-sonnet-5-5": { inputPerM: 2, outputPerM: 10 },
  "claude-haiku-5-5": { inputPerM: 0.1, outputPerM: 0.5 },
  "claude-opus-5-5": { inputPerM: 4, outputPerM: 20 },
};
export const WEB_SEARCH_USD = 0.01;

/** Estimated cost of a reported run. Unknown models count at the highest listed price (never zero). */
export function estimateCost(u: NonNullable<ResultBody["usage"]>): number {
  // Claude Code reports its own cost for the run; a reported figure is used when it is higher than the estimate.
  const p = PRICES[u.model] ?? PRICES[`claude-${u.model}-5-5`] ?? PRICES["claude-opus-5-5"];
  const usd = Math.max((u.inputTokens * p.inputPerM + u.outputTokens * p.outputPerM) / 1_000_000 + u.webSearches * WEB_SEARCH_USD, u.costUsd ?? 0);
  return Math.round(usd * 10_000) / 10_000;
}
