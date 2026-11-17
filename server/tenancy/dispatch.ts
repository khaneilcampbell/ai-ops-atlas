// Tenant-scoped execution: the gate every organization's dispatch, retry, callback and agent
// context read goes through. It does not run anything itself and is not a second orchestrator: the
// existing orchestrator (src/execution) decides what to run, and this checks that the run is
// allowed for this organization, records the trusted tenant context, and counts it against quotas.
//
// Trust rules:
//   - the organization comes from the caller's verified membership (dispatch, retry) or from the
//     stored dispatch record (callbacks, agent context), never from a request body or an agent;
//   - every referenced workspace, workflow, task, agent and dependency must belong to that
//     organization and that workspace;
//   - each dispatch gets its own random callback key (only its hash is stored), so a worker holding
//     the shared callback token still can't complete or read another dispatch;
//   - callbacks are idempotent: a dispatch finishes once, and usage is deduplicated per dispatch.

import type { D1 } from "../live";
import { sameSecret } from "../usage";
import { reply } from "../http";
import { audit, changes, first, newId, nowIso, type Authorized, type OrgRow, type TenantEnv } from "./core";
import { acquireLease, consume, periodFor, recordUsage, releaseLease, usageProblem, type UsageInput } from "./metering";
import { getResourceIn, publicResource, validId, type ResourceKind, type Result } from "./repo";

export interface DispatchInput {
  workspaceId?: unknown;
  workflowId?: unknown;
  runId?: unknown;
  taskId?: unknown;
  agentId?: unknown;
  correlationId?: unknown;
}

/** What a worker receives. Every id in it was checked against the organization before it was issued. */
export interface TenantEnvelope {
  dispatchId: string;
  orgId: string;
  workspaceId: string;
  workflowId: string;
  runId: string;
  taskId: string;
  agentId: string;
  correlationId: string;
  attempt: number;
  /** Shown once, here. Only its hash is stored. */
  callbackKey: string;
}

interface DispatchRow {
  id: string;
  org_id: string;
  workspace_id: string;
  workflow_id: string;
  run_id: string;
  task_id: string;
  agent_id: string;
  correlation_id: string;
  attempt: number;
  state: "dispatched" | "succeeded" | "failed" | "cancelled";
  callback_key_hash: string;
  created_at: string;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const hashKey = async (k: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(k)));
const fail = (status: number, message: string) => ({ ok: false as const, status, message });

async function checkContext(db: D1, org: OrgRow, c: { workspaceId: string; workflowId: string; taskId: string; agentId: string }): Promise<string | null> {
  const ws = await first<{ status: string }>(db, "SELECT status FROM workspaces WHERE org_id = ? AND id = ?", org.id, c.workspaceId);
  if (!ws || ws.status !== "active") return "workspace";
  const load = async (kind: ResourceKind, id: string) => {
    const r = await getResourceIn(db, org.id, kind, id);
    return r && r.workspace_id === c.workspaceId ? (JSON.parse(r.body) as Record<string, unknown>) : null;
  };
  const [workflow, task, agent] = [await load("workflow", c.workflowId), await load("task", c.taskId), await load("agent", c.agentId)];
  if (!workflow) return "workflow";
  if (!task) return "task";
  if (!agent) return "agent";
  if (agent.enabled === false) return "agent_off";
  if (typeof task.agentId === "string" && task.agentId !== c.agentId) return "agent_mismatch";
  if (typeof task.workflowId === "string" && task.workflowId !== c.workflowId) return "workflow_mismatch";
  if (task.requiresApproval === true) {
    const approvals = Array.isArray(task.approvals) ? (task.approvals as { decision?: string }[]) : [];
    if (approvals[approvals.length - 1]?.decision !== "granted") return "approval";
  }
  for (const dep of Array.isArray(task.dependencyIds) ? task.dependencyIds : []) {
    const d = typeof dep === "string" ? await load("task", dep) : null;
    if (!d) return "dependency";
    if (d.status !== "completed") return "dependency_open";
  }
  return null;
}

const CONTEXT_MESSAGE: Record<string, string> = {
  workspace: "That workspace isn't active in this organization.",
  workflow: "That workflow isn't in this workspace.",
  task: "That task isn't in this workspace.",
  agent: "That agent isn't installed in this workspace.",
  agent_off: "That agent is switched off.",
  agent_mismatch: "The task is assigned to a different agent.",
  workflow_mismatch: "The task belongs to a different workflow.",
  approval: "The task needs a person's approval first.",
  dependency: "A dependency isn't in this workspace.",
  dependency_open: "A dependency hasn't completed yet.",
};

async function issue(db: D1, a: Authorized, ids: { workspaceId: string; workflowId: string; runId: string; taskId: string; agentId: string; correlationId: string }, attempt: number, now: number): Promise<Result<TenantEnvelope>> {
  const problem = await checkContext(db, a.org, ids);
  if (problem) {
    await audit(db, { orgId: a.org.id, actor: a.userId, action: "dispatch.refused", target: `task/${ids.taskId}`, outcome: "denied", correlationId: ids.correlationId, detail: { reason: problem } }, now);
    return fail(problem === "approval" || problem === "dependency_open" || problem === "agent_off" ? 409 : 422, CONTEXT_MESSAGE[problem]);
  }
  const tokenBudget = await consume(db, a.org, "monthly_model_tokens", 0, now, a.userId);
  if (!tokenBudget.ok || tokenBudget.used >= tokenBudget.limit) return fail(429, "This organization has used its monthly model token budget.");
  const daily = await consume(db, a.org, "daily_tasks", 1, now, a.userId);
  if (!daily.ok) return fail(429, daily.message);
  const dispatchId = newId("dsp");
  const lease = await acquireLease(db, a.org, dispatchId, now);
  if (!lease.ok) {
    await audit(db, { orgId: a.org.id, actor: a.userId, action: "quota.exceeded", target: "concurrent_executions", outcome: "denied", correlationId: ids.correlationId, detail: { limit: lease.limit } }, now);
    return fail(429, `This organization already has ${lease.limit} execution${lease.limit === 1 ? "" : "s"} running. Try again when one finishes.`);
  }
  const callbackKey = newId("cbk") + newId("x");
  const at = nowIso(now);
  await db
    .prepare("INSERT INTO tenant_dispatch (id, org_id, workspace_id, workflow_id, run_id, task_id, agent_id, correlation_id, attempt, state, requested_by, callback_key_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'dispatched', ?, ?, ?, ?)")
    .bind(dispatchId, a.org.id, ids.workspaceId, ids.workflowId, ids.runId, ids.taskId, ids.agentId, ids.correlationId, attempt, a.userId, await hashKey(callbackKey), at, at)
    .run();
  await recordUsage(db, a.org.id, [{ resourceType: "task_execution", quantity: 1, unit: "task", measurement: "metered", dedupKey: `dispatch:${dispatchId}`, correlationId: ids.correlationId }], now);
  await audit(db, { orgId: a.org.id, actor: a.userId, action: "dispatch.issued", target: `task/${ids.taskId}`, outcome: "allowed", correlationId: ids.correlationId, detail: { attempt } }, now);
  return { ok: true, value: { dispatchId, orgId: a.org.id, ...ids, attempt, callbackKey } };
}

export async function authorizeDispatch(db: D1, a: Authorized, input: DispatchInput, now: number): Promise<Result<TenantEnvelope>> {
  const { workspaceId, workflowId, runId, taskId, agentId } = input;
  if (![workspaceId, workflowId, runId, taskId, agentId].every(validId)) return fail(400, "workspaceId, workflowId, runId, taskId and agentId are required.");
  const correlationId = validId(input.correlationId) ? input.correlationId : newId("cor");
  return issue(db, a, { workspaceId: workspaceId as string, workflowId: workflowId as string, runId: runId as string, taskId: taskId as string, agentId: agentId as string, correlationId }, 1, now);
}

/** A retry keeps the original tenant context, read from the stored dispatch, and checks it all again. */
export async function retryDispatch(db: D1, a: Authorized, dispatchId: string, now: number): Promise<Result<TenantEnvelope>> {
  const d = await first<DispatchRow>(db, "SELECT * FROM tenant_dispatch WHERE org_id = ? AND id = ?", a.org.id, dispatchId);
  if (!d) return fail(404, "No such dispatch.");
  if (d.state !== "failed") return fail(409, "Only a failed dispatch can be retried.");
  return issue(db, a, { workspaceId: d.workspace_id, workflowId: d.workflow_id, runId: d.run_id, taskId: d.task_id, agentId: d.agent_id, correlationId: d.correlation_id }, d.attempt + 1, now);
}

async function dispatchFromWorker(db: D1, env: TenantEnv, req: Request, dispatchId: unknown): Promise<{ ok: true; d: DispatchRow } | { ok: false; res: Response }> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const expected = env.TENANT_CALLBACK_TOKEN ?? "";
  if (expected.length < 32 || !sameSecret(token, expected)) return { ok: false, res: reply(401, { message: "Callback key doesn't match." }) };
  if (!validId(dispatchId)) return { ok: false, res: reply(400, { message: "dispatchId is required." }) };
  const d = await first<DispatchRow>(db, "SELECT * FROM tenant_dispatch WHERE id = ?", dispatchId);
  const key = req.headers.get("x-atlas-dispatch-key") ?? "";
  // Unknown dispatch and wrong per-dispatch key look the same to the caller.
  if (!d || !sameSecret(await hashKey(key), d.callback_key_hash)) return { ok: false, res: reply(404, { message: "No such dispatch." }) };
  return { ok: true, d };
}

/** POST /api/hooks/tenant-callback: a worker reports a dispatch's result. */
export async function receiveCallback(db: D1, env: TenantEnv, req: Request, now: number): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 64_000) return reply(413, { message: "Payload too large." });
    body = JSON.parse(text);
  } catch {
    return reply(400, { message: "Body isn't JSON." });
  }
  const found = await dispatchFromWorker(db, env, req, body.dispatchId);
  if (!found.ok) return found.res;
  const d = found.d;
  for (const k of ["orgId", "organizationId", "workspaceId", "taskId", "agentId"] as const) {
    const stored = { orgId: d.org_id, organizationId: d.org_id, workspaceId: d.workspace_id, taskId: d.task_id, agentId: d.agent_id }[k];
    if (k in body && body[k] !== stored) {
      await audit(db, { orgId: d.org_id, actor: "worker", action: "callback.tenant_mismatch", target: d.id, outcome: "denied", correlationId: d.correlation_id, detail: { field: k } }, now);
      return reply(409, { message: "The callback doesn't match the dispatch it names." });
    }
  }
  if (body.state !== "succeeded" && body.state !== "failed") return reply(400, { message: "state must be succeeded or failed." });
  if (d.state !== "dispatched") return reply(200, { stored: false, duplicate: true, state: d.state });
  const r = await db.prepare("UPDATE tenant_dispatch SET state = ?, updated_at = ? WHERE id = ? AND state = 'dispatched'").bind(body.state, nowIso(now), d.id).run();
  if (changes(r) === 0) return reply(200, { stored: false, duplicate: true });
  await releaseLease(db, d.org_id, d.id);
  const reported = Array.isArray(body.usage) ? (body.usage as Partial<UsageInput>[]) : [];
  const usage: UsageInput[] = reported
    .filter((u) => !usageProblem(u))
    .map((u) => ({ ...(u as UsageInput), dedupKey: `${d.id}:${u.dedupKey}`, correlationId: d.correlation_id }));
  usage.push({ resourceType: "execution_seconds", quantity: Math.max(0, Math.round((now - Date.parse(d.created_at)) / 1000)), unit: "second", measurement: "metered", dedupKey: `${d.id}:duration`, correlationId: d.correlation_id });
  const tokens = usage.filter((u) => u.resourceType === "model_input_tokens" || u.resourceType === "model_output_tokens").reduce((s, u) => s + u.quantity, 0);
  const added = await recordUsage(db, d.org_id, usage, now);
  // Tokens already spent can't be refused, but they count against the monthly budget, and
  // authorizeDispatch refuses new work once the budget is used up.
  if (tokens > 0) await db.prepare("INSERT INTO quota_counters (org_id, metric, period, used) VALUES (?, 'monthly_model_tokens', ?, ?) ON CONFLICT (org_id, metric, period) DO UPDATE SET used = used + excluded.used").bind(d.org_id, periodFor("monthly_model_tokens", now), tokens).run();
  if (body.state === "failed") await audit(db, { orgId: d.org_id, actor: "worker", action: "execution.failed", target: d.id, outcome: "error", correlationId: d.correlation_id }, now);
  return reply(200, { stored: true, usageAdded: added });
}

const CONTEXT_KINDS = new Set<ResourceKind>(["task", "workflow", "memory", "artifact", "project"]);

/**
 * GET /api/hooks/tenant-context?dispatch=&kind=&id=: what an agent may read while its dispatch is
 * running. Only records in the dispatch's own organization and workspace; anything else is a 404.
 */
export async function agentContext(db: D1, env: TenantEnv, req: Request, now: number): Promise<Response> {
  const url = new URL(req.url);
  const found = await dispatchFromWorker(db, env, req, url.searchParams.get("dispatch"));
  if (!found.ok) return found.res;
  const d = found.d;
  if (d.state !== "dispatched") return reply(409, { message: "This dispatch has finished." });
  const kind = url.searchParams.get("kind") as ResourceKind;
  const id = url.searchParams.get("id");
  if (!CONTEXT_KINDS.has(kind) || !validId(id)) return reply(400, { message: "kind and id are required." });
  const r = await getResourceIn(db, d.org_id, kind, id);
  if (!r || r.workspace_id !== d.workspace_id) {
    await audit(db, { orgId: d.org_id, actor: `agent:${d.agent_id}`, action: "context.denied", target: `${kind}/${id}`, outcome: "denied", correlationId: d.correlation_id }, now);
    return reply(404, { message: "No such record." });
  }
  return reply(200, publicResource(r));
}
