import type { Agent, Catalog } from "../catalog/types";
import { agentProblem, agentWorkflows } from "../tasks/registry";
import type { StoredTask, TaskEvent, WorkflowRef } from "../tasks/types";
import { downstream, topoOrder, upstream } from "./graph";
import type { ExecutionEvent, ExecutionEventType, NodeStatus, WorkflowDefinition, WorkflowNode, WorkflowRun } from "./types";

// Reading a workflow: who each node is (from the Agent Registry), what state it is in (simulated,
// or read from the Task Center), and the timeline. Everything here is pure and derived; there is
// no scheduler and nothing here starts or changes work.

export interface ResolvedNode {
  node: WorkflowNode;
  agent?: Agent;
  /** The registry title (e.g. "Product Lab Lead"), else the catalog name. */
  agentName?: string;
  /** The catalog name, when it differs from the registry title. */
  catalogName?: string;
  buildingId: string;
  buildingName: string;
  /** The room or desk the registry gives the agent, e.g. "Benjaire Marketing Agency, floor 2". */
  desk?: string;
  environment: string;
  workflows: WorkflowRef[];
  capabilities: string[];
  /** Why the registry entry can't take work (missing or retired), or null. */
  problem: string | null;
}

export function resolveNode(node: WorkflowNode, c: Catalog): ResolvedNode {
  const agent = node.agentId ? c.agents.find((a) => a.id === node.agentId) : undefined;
  const buildingId = agent?.projectId ?? node.buildingId ?? "";
  const building = c.projects.find((p) => p.id === buildingId);
  const title = agent?.registry?.title;
  return {
    node,
    agent,
    agentName: agent ? (title ?? agent.name) : undefined,
    catalogName: agent && title && title !== agent.name ? agent.name : undefined,
    buildingId,
    buildingName: building?.name ?? (buildingId || "Not documented"),
    desk: agent?.workplace ? `${agent.workplace.building}, floor ${agent.workplace.floor}` : undefined,
    environment: agent?.registry?.execution?.environment ?? agent?.runtime ?? (node.execution.kind === "manual" ? "A person, in Atlas" : "Not documented"),
    workflows: agent ? agentWorkflows(agent) : [],
    capabilities: agent ? [...new Set([...(agent.capabilities ?? []), ...(agent.registry?.responsibilities?.tasks ?? [])])] : [],
    problem: node.agentId ? agentProblem(agent) : null,
  };
}

export function resolveAll(d: WorkflowDefinition, c: Catalog): Map<string, ResolvedNode> {
  return new Map(d.nodes.map((n) => [n.id, resolveNode(n, c)]));
}

/** Nodes reached only through a decision branch that wasn't taken. */
export function skippedBy(d: WorkflowDefinition, taken: Record<string, "yes" | "no" | undefined>): Set<string> {
  const keep = d.edges.filter((e) => !e.branch || !taken[e.from] || taken[e.from] === e.branch);
  const roots = d.nodes.filter((n) => !d.edges.some((e) => e.to === n.id)).map((n) => n.id);
  const seen = new Set(roots);
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of keep) {
      if (e.from !== id || seen.has(e.to)) continue;
      seen.add(e.to);
      stack.push(e.to);
    }
  }
  return new Set(d.nodes.map((n) => n.id).filter((id) => !seen.has(id)));
}

// ---------------------------------------------------------------------------------------------
// Simulation: saved definition + mock states. Makes no calls and writes nothing.

export interface SimOptions {
  /** Which way each decision goes. */
  branches: Record<string, "yes" | "no">;
  /** Let the simulation pass unconfigured steps as if a person did them, instead of stopping there. */
  manualStandIn: boolean;
}

export interface SimState {
  step: number;
  maxStep: number;
  status: Map<string, NodeStatus>;
  events: ExecutionEvent[];
  /** The unconfigured node the simulation stopped at, if any. */
  haltedAt: string | null;
}

const SIM_BASE = Date.parse("2026-01-05T14:00:00Z");
const SIM_TICK = 15 * 60_000;
const simAt = (i: number) => new Date(SIM_BASE + i * SIM_TICK).toISOString();

/** Groups of nodes that become active together, in order. */
export function simPhases(d: WorkflowDefinition, o: SimOptions): { phases: string[][]; haltedAt: string | null; skipped: Set<string> } {
  const skipped = skippedBy(d, o.branches);
  const done = new Set<string>();
  const phases: string[][] = [];
  const order = topoOrder(d) ?? [];
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  for (;;) {
    const ready = order.filter((id) => !done.has(id) && !skipped.has(id) && upstream(d, id).every((u) => done.has(u) || skipped.has(u)));
    if (!ready.length) return { phases, haltedAt: null, skipped };
    const halt = o.manualStandIn ? undefined : ready.find((id) => byId.get(id)!.unconfigured);
    if (halt) {
      const runnable = ready.filter((id) => !byId.get(id)!.unconfigured);
      if (runnable.length) {
        phases.push(runnable);
        runnable.forEach((id) => done.add(id));
        continue;
      }
      return { phases, haltedAt: halt, skipped };
    }
    phases.push(ready);
    ready.forEach((id) => done.add(id));
  }
}

function activeStatus(n: WorkflowNode): NodeStatus {
  return n.kind === "approval" || n.kind === "decision" ? "awaiting_approval" : "running";
}

/**
 * The simulated state after `step` steps. Step 0 is the preview (nothing started); each later
 * step starts the next group of ready nodes and finishes the group before it.
 */
export function simulate(d: WorkflowDefinition, o: SimOptions, step: number, names: (id: string) => string): SimState {
  const { phases, haltedAt, skipped } = simPhases(d, o);
  const maxStep = phases.length + 1;
  const s = Math.max(0, Math.min(step, maxStep));
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const status = new Map<string, NodeStatus>(d.nodes.map((n) => [n.id, n.unconfigured ? "unconfigured" : "not_started"]));
  const events: ExecutionEvent[] = [];
  const ev = (nodeId: string, i: number, type: ExecutionEventType, text: string, extra: Partial<ExecutionEvent> = {}) =>
    events.push({ id: `sim-${i}-${nodeId}-${type}-${extra.fromNodeId ?? ""}`, nodeId, at: simAt(i), type, text, simulated: true, ...extra });

  for (let i = 0; i < Math.min(s, phases.length); i++) {
    const finished = i < s - 1;
    for (const id of phases[i]) {
      const n = byId.get(id)!;
      for (const u of upstream(d, id)) if (!skipped.has(u)) ev(id, i, "handoff", `${names(u)} handed off to ${names(id)}`, { fromNodeId: u });
      if (n.kind === "approval" || n.kind === "decision") ev(id, i, "approval_requested", n.kind === "approval" ? `Waiting for Khaneil's approval: ${n.title}` : `Waiting for Khaneil's decision: ${n.title}`);
      else if (n.kind === "outcome") ev(id, i, "completed", `Outcome reached: ${n.title}`);
      else ev(id, i, "started", n.unconfigured ? `${n.title} done by hand (unconfigured step, simulated stand-in)` : `${names(id)} started ${n.title.toLowerCase()}`);
      if (finished || n.kind === "outcome") {
        status.set(id, n.unconfigured ? "unconfigured" : "completed");
        if (n.kind === "approval") ev(id, i + 1, "approved", `Approved by Khaneil (simulated): ${n.title}`);
        else if (n.kind === "decision") {
          const b = o.branches[id] ?? "yes";
          ev(id, i + 1, "completed", `Decided: ${b === "yes" ? "go ahead" : "park the idea"} (simulated)`);
          for (const t of downstream(d, id)) if (skipped.has(t)) ev(t, i + 1, "skipped", `${byId.get(t)!.title}: branch not taken`);
        } else if (n.kind !== "outcome") ev(id, i + 1, "completed", `${n.title} completed (simulated)`);
      } else status.set(id, n.unconfigured ? "unconfigured" : activeStatus(n));
    }
  }
  if (s === maxStep && haltedAt) ev(haltedAt, phases.length, "waiting", `Stopped: ${byId.get(haltedAt)!.title} is unconfigured, so nothing after it can run.`);
  if (s >= 1) for (const id of skipped) if (status.get(id) === "not_started") status.set(id, "skipped");
  events.sort((a, b) => a.at.localeCompare(b.at));
  return { step: s, maxStep, status, events, haltedAt: s === maxStep ? haltedAt : null };
}

// ---------------------------------------------------------------------------------------------
// Live: read everything from the Task Center records the run points at. Nothing is inferred
// beyond what those records say.

/** Which way a live decision went, from what happened to the tasks on each branch. */
export function liveBranches(d: WorkflowDefinition, run: WorkflowRun, tasks: ReadonlyMap<string, StoredTask>): Record<string, "yes" | "no" | undefined> {
  const out: Record<string, "yes" | "no" | undefined> = {};
  for (const n of d.nodes) {
    if (n.kind !== "decision") continue;
    const dec = tasks.get(run.nodeTasks[n.id] ?? "");
    if (dec?.status !== "completed") continue;
    const yes = d.edges.filter((e) => e.from === n.id && e.branch === "yes").map((e) => tasks.get(run.nodeTasks[e.to] ?? ""));
    if (yes.some((t) => t && t.status !== "cancelled" && t.status !== "blocked" && t.status !== "queued")) out[n.id] = "yes";
    else if (yes.length && yes.every((t) => t?.status === "cancelled")) out[n.id] = "no";
  }
  return out;
}

export function liveStatus(d: WorkflowDefinition, run: WorkflowRun, tasks: ReadonlyMap<string, StoredTask>): Map<string, NodeStatus> {
  const skipped = skippedBy(d, liveBranches(d, run, tasks));
  const out = new Map<string, NodeStatus>();
  for (const id of topoOrder(d) ?? d.nodes.map((n) => n.id)) {
    const n = d.nodes.find((x) => x.id === id)!;
    if (skipped.has(id)) {
      out.set(id, "skipped");
      continue;
    }
    const taskId = run.nodeTasks[id];
    if (taskId) {
      out.set(id, tasks.get(taskId)?.status ?? "no_task");
      continue;
    }
    if (n.kind === "outcome") {
      const ups = upstream(d, id);
      out.set(id, ups.length && ups.every((u) => out.get(u) === "completed") ? "completed" : "not_started");
      continue;
    }
    out.set(id, n.unconfigured ? "unconfigured" : run.errors[id] ? "no_task" : "not_started");
  }
  return out;
}

function eventFor(e: TaskEvent): { type: ExecutionEventType; text: string } | null {
  switch (e.type) {
    case "created":
      return { type: "queued", text: "Task created in the Task Center" };
    case "approval_requested":
      return { type: "approval_requested", text: "Approval requested" };
    case "approval_granted":
      return { type: "approved", text: `Approved by ${e.actor.name}` };
    case "approval_rejected":
      return { type: "rejected", text: `Approval rejected by ${e.actor.name}` };
    case "execution_started":
      return { type: "started", text: "Run started" };
    case "execution_completed":
      return { type: "completed", text: "Run completed" };
    case "execution_failed":
      return { type: "failed", text: "Run failed" };
    case "retry_requested":
      return { type: "retry", text: "Retry requested" };
    case "dependency_blocked":
      return { type: "waiting", text: "Waiting on earlier steps" };
    case "status_changed": {
      const from = e.meta?.from;
      const to = e.meta?.to;
      if (from === "blocked" && to === "queued") return { type: "handoff", text: "Earlier steps completed; ready to start" };
      if (to === "running") return { type: "started", text: `Started by ${e.actor.name}` };
      if (to === "completed") return { type: "completed", text: `Marked completed by ${e.actor.name}` };
      if (to === "failed") return { type: "failed", text: "Failed" };
      if (to === "cancelled") return { type: "cancelled", text: `Cancelled by ${e.actor.name}` };
      if (to === "awaiting_approval") return { type: "approval_requested", text: "Waiting for approval" };
      return null;
    }
    default:
      return null;
  }
}

/** The run's timeline, built from each linked task's own history. Newest last. */
export function liveEvents(run: WorkflowRun, tasks: ReadonlyMap<string, StoredTask>): ExecutionEvent[] {
  const out: ExecutionEvent[] = [];
  for (const [nodeId, taskId] of Object.entries(run.nodeTasks)) {
    const t = tasks.get(taskId);
    if (!t) continue;
    for (const e of t.events) {
      const m = eventFor(e);
      if (m) out.push({ id: e.id, nodeId, at: e.at, type: m.type, text: m.text, actor: e.actor.name, simulated: false });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------------------------

export interface BuildingActivity {
  buildingId: string;
  buildingName: string;
  nodeIds: string[];
  active: number;
  waiting: number;
  done: number;
  failed: number;
  unconfigured: number;
}

const ACTIVE = new Set<NodeStatus>(["running", "queued"]);
const WAITING = new Set<NodeStatus>(["awaiting_approval", "blocked"]);

/** Per building: the workflow's steps there and how they stand. */
export function buildingActivity(d: WorkflowDefinition, resolved: ReadonlyMap<string, ResolvedNode>, status: ReadonlyMap<string, NodeStatus>): BuildingActivity[] {
  const by = new Map<string, BuildingActivity>();
  for (const n of d.nodes) {
    const r = resolved.get(n.id);
    if (!r?.buildingId) continue;
    if (!by.has(r.buildingId)) by.set(r.buildingId, { buildingId: r.buildingId, buildingName: r.buildingName, nodeIds: [], active: 0, waiting: 0, done: 0, failed: 0, unconfigured: 0 });
    const b = by.get(r.buildingId)!;
    b.nodeIds.push(n.id);
    const s = status.get(n.id) ?? "not_started";
    if (ACTIVE.has(s)) b.active++;
    else if (WAITING.has(s)) b.waiting++;
    else if (s === "completed") b.done++;
    else if (s === "failed") b.failed++;
    if (n.unconfigured) b.unconfigured++;
  }
  return [...by.values()];
}
