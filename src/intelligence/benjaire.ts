import type { Catalog } from "../catalog/types";
import { schemaFor } from "../execution/handoff";
import { stepPolicy, spend } from "../execution/policy";
import type { RunLedger } from "../execution/types";
import type { StoredTask } from "../tasks/types";
import { BENJAIRE_LAUNCH } from "../workflows/benjaireLaunch";
import type { WorkflowNode, WorkflowRun } from "../workflows/types";
import { grantsFor } from "./capabilities";
import { evaluateStep } from "./evaluation";
import { agentAccess, intelId, type IntelligenceStore } from "./memory";
import { asContext, retrieve } from "./retrieval";
import { routeModel, type ModelRoute, type RouteRequest, type TaskType } from "./routing";
import type { ContextRecord, Evaluation, MemoryRecord, ModelTierNumber } from "./types";

// The Benjaire product research and launch workflow as the first user of agent intelligence.
// Each step gets: the knowledge it may read (retrieved within a budget), the tools it is granted,
// and a model route that matches the execution policy. Validated research outputs become working
// memory for the steps after them, so nobody researches the same thing twice, and each finished
// step is evaluated. Development, spending, publication and deployment stay behind Khaneil's
// approvals in the workflow itself (approve-scope, approve-launch).

export const WORKFLOW_ID = BENJAIRE_LAUNCH.id;

/** The seven agents that take part, by their registry titles. */
export const BENJAIRE_AGENTS: readonly { id: string; role: string }[] = [
  { id: "benjaire-product-lab-research", role: "Market Research Analyst" },
  { id: "benjaire-product-lab-customers", role: "Customer Insight Researcher" },
  { id: "benjaire-product-lab-competitors", role: "Competitor Analyst" },
  { id: "benjaire-product-lab-scoring", role: "Product Scoring Analyst" },
  { id: "benjaire-product-lab-brief", role: "Product Brief Writer" },
  { id: "benjaire-product-lab", role: "Product Lab Lead" },
  { id: "agent-operations-lead", role: "Agent Operations Lead" },
];

export interface StepProfile {
  taskType: TaskType;
  complexity: RouteRequest["complexity"];
  /** What the step looks up in memory. */
  query: string;
  tags: string[];
}

/** Task profile per step. Tiers line up with stepPolicy (checked by a test). */
export const STEP_PROFILES: Readonly<Record<string, StepProfile>> = {
  intake: { taskType: "routing", complexity: "low", query: "goal delegation approval budget agents", tags: ["policy", "approval"] },
  "market-research": { taskType: "research", complexity: "medium", query: "market research demand signals ideas product search limits", tags: ["research", "market"] },
  "customer-research": { taskType: "research", complexity: "medium", query: "customer personas pains reach channels product", tags: ["research", "customer"] },
  "competitor-analysis": { taskType: "research", complexity: "medium", query: "competitor prices review complaints product", tags: ["research", "competitor"] },
  scoring: { taskType: "scoring", complexity: "high", query: "scorecard scoring demand gap fit margin research findings", tags: ["scoring", "research"] },
  viability: { taskType: "decision", complexity: "low", query: "viability decision approval", tags: ["policy"] },
  parked: { taskType: "status_check", complexity: "low", query: "parked idea", tags: [] },
  brief: { taskType: "summary", complexity: "medium", query: "product brief audience scope scorecard sources", tags: ["brief"] },
  planning: { taskType: "planning", complexity: "high", query: "product plan effort risks audience approval development", tags: ["planning", "approval"] },
  "approve-scope": { taskType: "approval", complexity: "low", query: "approval development spend", tags: ["approval"] },
  develop: { taskType: "code", complexity: "high", query: "development repository build tests", tags: [] },
  quality: { taskType: "validation", complexity: "low", query: "quality tests", tags: [] },
  "approve-launch": { taskType: "approval", complexity: "low", query: "approval publish launch", tags: ["approval"] },
  publish: { taskType: "status_check", complexity: "low", query: "publish listing approval", tags: ["publish"] },
  monitor: { taskType: "summary", complexity: "low", query: "launch outcome monitor", tags: [] },
};

export const profileFor = (nodeId: string): StepProfile => STEP_PROFILES[nodeId] ?? { taskType: "summary", complexity: "medium", query: nodeId.replace(/-/g, " "), tags: [] };

/** The model route for a step, with its remaining budget and what the agent may reach. */
export function routeForStep(node: Pick<WorkflowNode, "id" | "kind" | "execution" | "agentId">, task: Pick<StoredTask, "usage"> | undefined, catalog: Catalog): ModelRoute {
  const p = profileFor(node.id);
  const pol = stepPolicy(node);
  if (pol.tier === "none") return routeModel({ taskType: p.taskType === "code" ? "validation" : (["routing", "decision", "approval", "status_check", "validation", "db_query"] as TaskType[]).includes(p.taskType) ? p.taskType : "status_check" });
  const s = task ? spend(task) : { billedUsd: 0, estimatedUsd: 0 };
  const grants = node.agentId ? grantsFor(node.agentId).map((c) => c.id) : [];
  const availableTiers: ModelTierNumber[] = [...(grants.includes("model.light") ? [1 as const] : []), ...(grants.includes("model.advanced") ? [1 as const, 2 as const] : [])];
  const acc = node.agentId ? agentAccess(catalog, node.agentId) : null;
  return routeModel({ taskType: p.taskType, complexity: p.complexity, sensitivity: acc?.clearance, budgetRemainingUsd: Math.max(0, pol.capUsd - s.billedUsd - s.estimatedUsd), availableTiers });
}

export interface StepContext {
  note: string;
  items: ReturnType<typeof asContext>["items"];
  capabilities: string[];
  route: { tier: ModelTierNumber; model: string | null; maxInputTokens: number; maxOutputTokens: number; cache: boolean };
  outputSchema: string;
  budgetTokens: number;
}

/**
 * Retrieves context for one step, records what was handed over (audited), and returns the part
 * that travels in the handoff envelope. Returns undefined for steps without an agent.
 */
export function buildStepContext(store: IntelligenceStore, run: WorkflowRun, nodeId: string, task: StoredTask, attempt: number): StepContext | undefined {
  const node = run.snapshot.nodes.find((n) => n.id === nodeId);
  if (!node?.agentId) return undefined;
  const catalog = store.cat();
  const acc = agentAccess(catalog, node.agentId);
  const p = profileFor(nodeId);
  const now = Date.parse(store.at());
  const res = retrieve(store.memory(), acc, { text: `${p.query} ${node.title}`, tags: p.tags }, now);
  const route = routeForStep(node, task, catalog);
  const caps = grantsFor(node.agentId).map((c) => c.id);
  const actor = { kind: "agent" as const, id: node.agentId, name: node.agentId };
  const rec: ContextRecord = {
    key: `${task.id}:${attempt}`,
    taskId: task.id,
    attempt,
    runId: run.id,
    nodeId,
    agentId: node.agentId,
    at: store.at(),
    query: p.query,
    items: res.items.map((i) => ({ id: i.id, title: i.title, category: i.category, verification: i.verification, stale: i.stale, tokens: i.tokens, source: i.source })),
    usedTokens: res.usedTokens,
    budgetTokens: res.budgetTokens,
    dropped: res.dropped,
    capabilities: caps,
    route: { tier: route.tier, model: route.model, reason: route.reasons.join("; ") },
  };
  store.update((f, at) => store.audit({ ...f, contexts: [...f.contexts.filter((c) => c.key !== rec.key), rec] }, actor, "retrieve", rec.items.map((i) => i.id), at, `${nodeId} · ${res.usedTokens}/${res.budgetTokens} tokens`));
  const c = asContext(res.items);
  return { note: c.note, items: c.items, capabilities: caps, route: { tier: route.tier, model: route.model, maxInputTokens: route.maxInputTokens, maxOutputTokens: route.maxOutputTokens, cache: route.cache }, outputSchema: schemaFor(nodeId).id, budgetTokens: res.budgetTokens };
}

const RESEARCH_STEPS = new Set(["market-research", "customer-research", "competitor-analysis", "scoring"]);

/** A short working-memory note from a validated research handoff: field values and artifact links only. */
export function findingFromHandoff(run: WorkflowRun, nodeId: string, h: RunLedger["handoffs"][string]): { title: string; content: string; tags: string[] } | null {
  if (!RESEARCH_STEPS.has(nodeId) || h.state !== "validated" || !h.output) return null;
  const node = run.snapshot.nodes.find((n) => n.id === nodeId);
  const parts = Object.entries(h.output.fields).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.slice(0, 10).join("; ") : String(v)}`);
  const links = h.output.artifacts.map((a) => `${a.label} <${a.url}>`);
  return { title: `${node?.title ?? nodeId} findings (run ${run.id.slice(-6)})`, content: [...parts, ...(links.length ? [`Artifacts: ${links.join(", ")}`] : [])].join("\n").slice(0, 2000), tags: ["research", "finding", nodeId] };
}

/**
 * After each orchestrator round: turns validated research handoffs into working memory (once) and
 * evaluates every finished step attempt (once). Idempotent, deterministic, no model calls.
 */
export function recordRunIntelligence(store: IntelligenceStore, run: WorkflowRun, ledger: RunLedger, tasks: ReadonlyMap<string, StoredTask>): { findings: number; evaluations: number } {
  const catalog = store.cat();
  const file = store.snapshot();
  const haveSource = new Set(file.memory.map((m) => `${m.source.kind}:${m.source.ref}`));
  const haveEval = new Set(file.evaluations.map((e) => e.key));
  const notes: MemoryRecord[] = [];
  const evals: Evaluation[] = [];
  const at = store.at();
  for (const [nodeId, h] of Object.entries(ledger.handoffs)) {
    const ref = `${run.id}/${nodeId}`;
    if (haveSource.has(`handoff:${ref}`)) continue;
    const f = findingFromHandoff(run, nodeId, h);
    if (!f) continue;
    const t = Date.parse(at);
    notes.push({
      id: intelId("mem"),
      category: "working",
      scope: { project: "benjaire-site", workflowId: run.definitionId },
      title: f.title,
      content: f.content,
      tags: f.tags,
      source: { kind: "handoff", ref },
      createdAt: at,
      updatedAt: at,
      createdBy: { kind: "system", id: "atlas", name: "Atlas" },
      // Passing the schema doesn't make it true: unverified until Khaneil checks it.
      verification: "unverified",
      sensitivity: "internal",
      expiry: { policy: "ttl", expiresAt: new Date(t + 30 * 86_400_000).toISOString() },
    });
  }
  for (const [nodeId, taskId] of Object.entries(run.nodeTasks)) {
    const task = tasks.get(taskId);
    const node = run.snapshot.nodes.find((n) => n.id === nodeId);
    if (!task || !node?.agentId) continue;
    const key = `${task.id}:${task.attempts.length}`;
    if (haveEval.has(key)) continue;
    const agent = catalog.agents.find((a) => a.id === node.agentId);
    const route = routeForStep(node, task, catalog);
    const e = evaluateStep(
      {
        task,
        agentId: node.agentId,
        nodeId,
        runId: run.id,
        workflowId: run.definitionId,
        workflowVersion: run.definitionVersion,
        promptVersion: agent?.registry?.version ?? "Not documented",
        taskType: profileFor(nodeId).taskType,
        routedTier: route.tier,
        handoff: ledger.handoffs[nodeId],
        failures: ledger.validationFailures,
        capUsd: stepPolicy(node).capUsd,
      },
      at,
    );
    if (e) evals.push(e);
  }
  if (!notes.length && !evals.length) return { findings: 0, evaluations: 0 };
  const sys = { kind: "system" as const, id: "atlas", name: "Atlas" };
  store.update((f, when) => {
    const seenE = new Set(f.evaluations.map((e) => e.key));
    const seenS = new Set(f.memory.map((m) => `${m.source.kind}:${m.source.ref}`));
    const addN = notes.filter((n) => !seenS.has(`${n.source.kind}:${n.source.ref}`));
    const addE = evals.filter((e) => !seenE.has(e.key));
    let next = { ...f, memory: [...f.memory, ...addN], evaluations: [...f.evaluations, ...addE] };
    if (addN.length) next = store.audit(next, sys, "write", addN.map((n) => n.id), when, "research findings from validated handoffs");
    if (addE.length) next = store.audit(next, sys, "evaluate", addE.map((e) => e.id), when);
    return next;
  });
  return { findings: notes.length, evaluations: evals.length };
}
