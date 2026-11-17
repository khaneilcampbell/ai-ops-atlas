import type { Watch } from "../alerts/alerts";
import type { Catalog } from "../catalog/types";
import { goalSignals } from "../executive/signals";
import type { ExecutiveGoal } from "../executive/types";
import { budgetProblem, stepPolicy } from "../execution/policy";
import type { RunLedger } from "../execution/types";
import type { RepoState } from "../github/types";
import type { Evaluation } from "../intelligence/types";
import type { N8nSnapshot } from "../n8n/types";
import type { SignalRow } from "../observability/signals";
import { githubFailureEvents, n8nFailureEvents } from "../tasks/intake";
import { liveAttempt } from "../tasks/lifecycle";
import type { StoredTask } from "../tasks/types";
import type { WorkflowRun } from "../workflows/types";
import { makeEvent, safeText } from "./events";
import type { AuditEntry, EventSystem, Incident, OpsEvent } from "./types";

// Supervision, goal monitoring and integration health as normalized events, from records Atlas
// already keeps. Deterministic, no model calls, no new polling: it reads what the app holds.
// Each event's correlation id ties together reports about the same thing from different systems
// (an agent's GitHub run, its n8n run and its alert are one incident).

export interface DeriveInputs {
  now: number;
  catalog: Catalog;
  tasks: readonly StoredTask[];
  runs: readonly WorkflowRun[];
  ledgers: readonly RunLedger[];
  watches: readonly Watch[];
  /** Whether this device is reading the live agent feed right now (silence can only be judged then). */
  feedLive: boolean;
  signals: readonly SignalRow[] | null;
  n8n: N8nSnapshot | null;
  repos: Record<string, RepoState>;
  goals: readonly ExecutiveGoal[];
  evaluations: readonly Evaluation[];
  audit: readonly AuditEntry[];
}

export interface Derived {
  events: OpsEvent[];
  /** Correlation ids whose condition is present right now. */
  activeKeys: Set<string>;
  /** Systems that answered this round; only their incidents can be cleared. */
  observed: Set<EventSystem>;
}

const DAY = 86_400_000;
const APPROACHING_DAYS = 3;
const APPROVAL_WAIT_MS = DAY;
const EVAL_FLOOR = 50;

const iso = (n: number) => new Date(n).toISOString();
const agentKey = (id: string) => `agent:${id}`;
/** Names and other free text made safe for an id field. */
const slug = (s: string) => s.replace(/[^A-Za-z0-9._:/@#-]+/g, "-").slice(0, 120) || "unknown";

export function deriveEvents(i: DeriveInputs): Derived {
  const out: OpsEvent[] = [];
  const at = iso(i.now);
  const push = (e: Parameters<typeof makeEvent>[0]) => out.push(makeEvent(e));
  const agentOf = (id?: string) => (id ? i.catalog.agents.find((a) => a.id === id) : undefined);
  const observed = new Set<EventSystem>(["atlas", "budget", "goal"]);

  // Workflow failures: the latest run of each catalog agent's n8n or GitHub workflow.
  if (i.n8n?.state === "ok") {
    observed.add("n8n");
    for (const x of n8nFailureEvents(i.n8n, i.catalog.agents, i.now)) {
      push({ system: "n8n", type: "workflow.failed", project: x.buildingId ?? null, correlationId: x.agentId ? agentKey(x.agentId) : `n8n:${x.workflow?.id}`, at: i.n8n.fetchedAt, severity: "high", identity: "n8n-api", resource: `n8n:${x.workflow?.id ?? "unknown"}`, dedupKey: x.key, payload: { title: safeText(x.title, 140), detail: x.description, agentId: x.agentId ?? null }, ...(x.workflow?.url?.startsWith("https://") ? { artifactUrl: x.workflow.url } : {}) });
    }
  }
  const loaded = Object.values(i.repos).some((r) => r?.kind === "ok" || (r?.kind === "error" && r.data));
  if (loaded) observed.add("github");
  for (const x of githubFailureEvents(i.catalog.agents, i.repos, i.now)) {
    push({ system: "github", type: "workflow.failed", project: x.buildingId ?? null, correlationId: x.agentId ? agentKey(x.agentId) : `github:${x.workflow?.id}`, at, severity: "high", identity: "github-api", resource: `github:${x.workflow?.repository ?? ""}/${x.workflow?.id ?? ""}`, dedupKey: x.key, payload: { title: safeText(x.title, 140), detail: x.description, agentId: x.agentId ?? null }, ...(x.workflow?.url?.startsWith("https://") ? { artifactUrl: x.workflow.url } : {}) });
  }

  // Agent supervision: alerts already computed from each agent's live source.
  if (i.feedLive) observed.add("agent");
  for (const w of i.watches) {
    if (w.state !== "failing" && w.state !== "silent") continue;
    push({ system: "agent", type: w.state === "failing" ? "agent.failing" : "agent.silent", project: w.agent.projectId ?? null, correlationId: agentKey(w.agent.id), at: w.since ?? at, severity: w.state === "failing" ? "high" : "medium", identity: w.agent.observe?.agentFeed ? "agent-feed" : "github-api", resource: w.agent.id, dedupKey: w.key ?? `${w.agent.id}:${w.state}`, payload: { title: `${w.agent.name}: ${w.state === "failing" ? "latest run failed" : "stopped reporting"}`, detail: w.detail, agentId: w.agent.id } });
  }
  for (const ev of i.evaluations) {
    if (ev.score === null || ev.score >= EVAL_FLOOR || i.now - Date.parse(ev.at) > DAY) continue;
    push({ system: "agent", type: "agent.eval_failed", project: agentOf(ev.agentId)?.projectId ?? null, correlationId: `eval:${ev.agentId}`, at: ev.at, severity: "low", identity: "atlas-local", resource: ev.agentId, dedupKey: `eval:${ev.key}`, payload: { title: `${agentOf(ev.agentId)?.name ?? ev.agentId}: evaluation ${ev.score}/100`, detail: ev.flags.slice(0, 3).join("; ") || "Below the evaluation floor", agentId: ev.agentId, taskId: ev.taskId, ...(ev.runId ? { runId: ev.runId } : {}) } });
  }
  for (const a of i.audit) {
    if (a.action !== "policy_refused_agent") continue;
    const who = slug(a.actor);
    push({ system: "atlas", type: "agent.unauthorized", project: null, correlationId: `unauthorized:${who}`, at: a.at, severity: "critical", identity: "atlas-local", resource: who, dedupKey: `unauth:${a.at}:${who}`, payload: { title: `${a.actor} tried an action its policy doesn't allow`, detail: a.detail ?? "" } });
  }

  // Task supervision: failures, runs past their timeout, outputs that failed their schema, step budgets.
  const runOf = new Map<string, { run: WorkflowRun; nodeId: string }>();
  for (const r of i.runs) for (const [nodeId, taskId] of Object.entries(r.nodeTasks)) runOf.set(taskId, { run: r, nodeId });
  for (const t of i.tasks) {
    const rn = runOf.get(t.id);
    const key = rn ? `run:${rn.run.id}` : `task:${t.id}`;
    const base = { project: t.buildingId ?? null, identity: "atlas-local" as const, resource: t.id, payload: { taskId: t.id, ...(rn ? { runId: rn.run.id } : {}), ...(t.agentId ? { agentId: t.agentId } : {}) } };
    if (t.status === "failed") push({ ...base, system: "atlas", type: "task.failed", correlationId: key, at: t.updatedAt, severity: "medium", dedupKey: `task-failed:${t.id}:${t.attempts.length}`, payload: { ...base.payload, title: safeText(`Task failed: ${t.title}`, 140), detail: t.error ?? "No error recorded", attempt: t.attempts.length } });
    const live = liveAttempt(t);
    if (live && live.executor !== "manual") {
      const node = rn?.run.snapshot.nodes.find((n) => n.id === rn.nodeId);
      const timeout = node ? stepPolicy(node).timeoutMs : live.executor === "github" ? 2 * 3_600_000 : 6 * 3_600_000;
      const started = Date.parse(live.startedAt ?? live.requestedAt);
      if (live.state === "unknown" || i.now - started > timeout) push({ ...base, system: "atlas", type: "task.stalled", correlationId: key, at: iso(Math.min(i.now, started + timeout)), severity: "medium", dedupKey: `task-stalled:${t.id}:${live.id}`, payload: { ...base.payload, title: safeText(`Stalled: ${t.title}`, 140), detail: live.state === "unknown" ? "The outside system's answer was unclear; it may or may not have run." : `No report for longer than its ${Math.round(timeout / 3_600_000)} h timeout.`, attempt: live.number, executor: live.executor } });
    }
    if (rn) {
      const node = rn.run.snapshot.nodes.find((n) => n.id === rn.nodeId);
      const over = node ? budgetProblem(t, stepPolicy(node)) : null;
      if (over && (t.status === "queued" || t.status === "running" || t.status === "failed")) push({ ...base, system: "budget", type: "budget.exceeded", correlationId: `budget:${t.id}`, at, severity: "high", dedupKey: `step-budget:${t.id}:${t.usage.length}`, payload: { ...base.payload, title: safeText(`Step budget used: ${t.title}`, 140), detail: over } });
    }
  }
  for (const l of i.ledgers) {
    const latest = l.validationFailures[l.validationFailures.length - 1];
    if (!latest || i.now - Date.parse(latest.at) > DAY) continue;
    const r = i.runs.find((x) => x.id === l.runId);
    const taskId = r?.nodeTasks[latest.nodeId];
    push({ system: "atlas", type: "task.invalid_output", project: null, correlationId: `run:${l.runId}`, at: latest.at, severity: "medium", identity: "atlas-local", resource: taskId ?? latest.nodeId, dedupKey: `invalid:${l.runId}:${latest.nodeId}:${latest.attempt}`, payload: { title: `Output failed its schema: ${latest.nodeId}`, detail: latest.errors.slice(0, 2).join("; "), runId: l.runId, ...(taskId ? { taskId } : {}) } });
  }

  // Connected signals: failing and stale feeds Atlas reads.
  if (i.signals) {
    observed.add("integration");
    for (const s of i.signals) {
      if (s.state !== "failing" && s.state !== "stale") continue;
      // A bucket per 30 minutes, so a feed that stays down counts again for the transient threshold.
      const bucket = Math.floor(i.now / (30 * 60_000));
      push({ system: "integration", type: s.state === "failing" ? "integration.failing" : "integration.stale", project: null, correlationId: `integration:${s.id}`, at: s.at ?? at, severity: s.state === "failing" ? "medium" : "low", identity: "atlas-local", resource: s.id, dedupKey: `signal:${s.id}:${s.state}:${bucket}`, payload: { title: `${s.label}: ${s.state === "failing" ? "failing" : "answering late"}`, detail: s.detail } });
    }
  }

  // Goal monitoring: only deadlines, budgets and criteria Khaneil set. Reuses Phase 8 goal signals.
  const taskMap = new Map(i.tasks.map((t) => [t.id, t]));
  for (const g of i.goals) {
    const key = `goal:${g.id}`;
    const base = { system: "goal" as const, project: g.projectId || null, correlationId: key, identity: "atlas-local" as const, resource: g.id };
    if (g.deadline && ["draft", "planned", "approved", "running", "review"].includes(g.state)) {
      const end = Date.parse(`${g.deadline}T23:59:59Z`);
      if (end > i.now && end - i.now <= APPROACHING_DAYS * DAY) push({ ...base, type: "goal.deadline", at, severity: "medium", dedupKey: `goal-due:${g.id}:${g.deadline}`, payload: { title: safeText(`Deadline in ${Math.ceil((end - i.now) / DAY)} days: ${g.objective}`, 140), detail: `You set ${g.deadline}; the goal is ${g.state}.`, goalId: g.id } });
    }
    for (const s of goalSignals(g, i.runs, taskMap, i.catalog, i.now)) {
      const t = s.taskId ? taskMap.get(s.taskId) : undefined;
      const map = { overdue: "goal.deadline", failed: "goal.dependency_failed", missing_dependency: "goal.dependency_failed", unavailable_agent: "goal.agent_unavailable", budget_exceeded: "budget.exceeded", budget_warning: "budget.warning", stale: "goal.stale", pending_approval: "goal.blocked", unconfigured: null } as const;
      const type = map[s.kind];
      if (!type) continue;
      if (type === "goal.blocked") {
        const asked = [...(t?.events ?? [])].reverse().find((e) => e.type === "approval_requested");
        if (!asked || i.now - Date.parse(asked.at) < APPROVAL_WAIT_MS) continue;
      }
      push({ ...base, system: type.startsWith("budget") ? "budget" : "goal", type, at, severity: s.severity, dedupKey: s.key, payload: { title: safeText(`${s.title}: ${g.objective}`, 140), detail: s.detail, goalId: g.id, ...(s.taskId ? { taskId: s.taskId } : {}) } });
    }
    // Missing deliverables: a finished step that produced no structured output.
    for (const r of i.runs.filter((x) => g.runIds.includes(x.id))) {
      const l = i.ledgers.find((x) => x.runId === r.id);
      for (const [nodeId, h] of Object.entries(l?.handoffs ?? {})) {
        const n = r.snapshot.nodes.find((x) => x.id === nodeId);
        if (h.state !== "unverified" || n?.kind !== "agent") continue;
        push({ ...base, type: "goal.missing_deliverable", at: h.at, severity: "medium", dedupKey: `deliverable:${r.id}:${nodeId}:${h.attempt}`, payload: { title: safeText(`${n.title} finished with no output: ${g.objective}`, 140), detail: h.reason ?? "Completed outside the orchestrator with no structured output.", goalId: g.id, runId: r.id, taskId: h.taskId } });
      }
    }
  }

  return { events: out, activeKeys: new Set(out.map((e) => e.correlationId)), observed };
}

/** What an incident touches beyond itself: goals relying on its agents or project, and steps waiting on its tasks. */
export function impactOf(inc: Pick<Incident, "agentIds" | "project" | "taskIds" | "goalIds">, goals: readonly ExecutiveGoal[], tasks: readonly StoredTask[]): { impact: string[]; goalIds: string[] } {
  const affected = goals.filter((g) => !["completed", "not_achieved", "cancelled"].includes(g.state) && (inc.goalIds.includes(g.id) || (g.plan?.definition.nodes ?? []).some((n) => n.agentId && inc.agentIds.includes(n.agentId)) || (!!inc.project && g.projectId === inc.project && inc.agentIds.length > 0)));
  const waiting = tasks.filter((t) => t.status === "blocked" && t.dependencyIds.some((d) => inc.taskIds.includes(d)));
  const impact = [...affected.map((g) => `Goal: ${safeText(g.objective, 80)}`), ...waiting.map((t) => `Waiting step: ${safeText(t.title, 80)}`)].slice(0, 8);
  return { impact, goalIds: affected.map((g) => g.id) };
}
