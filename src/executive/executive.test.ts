import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import type { Catalog } from "../catalog/types";
import { manualAdapter, output, simulatedAdapter } from "../execution/adapters";
import { LedgerStore } from "../execution/ledger";
import { Orchestrator } from "../execution/orchestrator";
import { IntelligenceStore } from "../intelligence/memory";
import { liveOutputs } from "../outputs/live";
import { beginAttempt, decideApproval, requestApproval, retry, updateAttempt } from "../tasks/lifecycle";
import { byId, LocalTaskRepository, memoryBackend, TaskService } from "../tasks/store";
import { ATLAS, KHANEIL, type Actor, type StoredTask } from "../tasks/types";
import { BENJAIRE_LAUNCH } from "../workflows/benjaireLaunch";
import { liveStatus } from "../workflows/engine";
import { RunStore } from "../workflows/runs";
import { authorizeAction, ROUTINES, setLevelProblem, type ActionRequest } from "./autonomy";
import { briefingText, buildBriefing } from "./briefing";
import { approvePlan, delegate, draftGoal, editGoal, executiveWorkflows, goalBudget, goalStatus, planGoal, reviewOutcome, syncGoal } from "./coordinator";
import { executiveContext } from "./context";
import { buildPlan, validatePlan } from "./plan";
import { executiveAttention, goalSignals } from "./signals";
import { ExecutiveStore, parseExecutive, redact } from "./store";
import { matchTemplate, TEMPLATES } from "./templates";
import type { ExecutiveGoal } from "./types";

// Phase 8 executive goal coordination on the real Task Center, run store, ledger and orchestrator,
// with a stand-in for n8n. Nothing outside is called: no deploys, spending or messages.

const AT = "2026-11-17T12:00:00.000Z";
const NOW = Date.parse(AT);
const AGENT: Actor = { kind: "agent", id: "agent-operations-lead", name: "Agent Operations Lead" };

function app(clock = { t: NOW }) {
  const now = () => new Date(clock.t).toISOString();
  const svc = new TaskService(new LocalTaskRepository(memoryBackend()), now);
  const runs = new RunStore(memoryBackend());
  return { svc, runs, now, clock };
}

function goalFor(objective: string, extra: Partial<Parameters<typeof draftGoal>[0]> = {}, level: 0 | 1 | 2 | 3 = 1): ExecutiveGoal {
  const d = draftGoal({ objective, ...extra }, KHANEIL, AT, catalog, level);
  if (!d.ok) throw new Error(d.error);
  return d.goal;
}

function planned(objective: string, extra: Partial<Parameters<typeof draftGoal>[0]> = {}) {
  const p = planGoal(goalFor(objective, extra), KHANEIL, AT);
  if (!p.ok) throw new Error(p.error);
  return p.goal;
}

function approved(objective: string, extra: Partial<Parameters<typeof draftGoal>[0]> = {}) {
  const a = approvePlan(planned(objective, extra), KHANEIL, AT, catalog, null);
  if (!a.ok) throw new Error(a.error);
  return a.goal;
}

/** Runs a task through a manual attempt to the given end. */
function finish(svc: TaskService, id: string, end: "succeeded" | "failed" = "succeeded") {
  const all = byId(svc.repo.list());
  const t = all.get(id)!;
  let cur = t;
  if (t.status === "awaiting_approval" || (t.requiresApproval && t.status === "queued")) {
    if (t.status === "queued") svc.apply(id, (x, _a, at) => requestApproval(x, KHANEIL, at));
    cur = (svc.apply(id, (x, _a, at) => decideApproval(x, "granted", KHANEIL, at)) as { task: StoredTask }).task;
  }
  const b = svc.apply(cur.id, (x, a, at) => beginAttempt(x, a, "manual", KHANEIL, at, null));
  if (!b.ok) throw new Error(b.error);
  const attempt = b.task.attempts[b.task.attempts.length - 1];
  const r = svc.apply(cur.id, (x, _a, at) => updateAttempt(x, attempt.id, end === "succeeded" ? { state: "succeeded", result: { ok: true } } : { state: "failed", error: "Mock failure" }, KHANEIL, at));
  if (!r.ok) throw new Error(r.error);
}

describe("1. goal creation", () => {
  it("captures every field, invents no deadline or budget, and only Khaneil can create", () => {
    const g = goalFor("Research a profitable digital product for Benjaire");
    expect(g.id).toMatch(/^goal_/);
    expect(g.deadline).toBeUndefined();
    expect(g.budgetUsd).toBeUndefined();
    expect(g.projectId).toBe("benjaire-site");
    expect(g.successCriteria.length).toBeGreaterThan(0);
    expect(g.state).toBe("draft");
    expect(g.autonomy).toBe(1);
    expect(g.createdAt).toBe(AT);
    const full = goalFor("Prepare a weekly operational briefing", { priority: "high", deadline: "2026-12-01", budgetUsd: 2, constraints: ["Read only"], requiredApprovals: ["customer_message"], successCriteria: ["Every number sourced"] });
    expect(full).toMatchObject({ priority: "high", deadline: "2026-12-01", budgetUsd: 2, constraints: ["Read only"], requiredApprovals: ["customer_message"], successCriteria: ["Every number sourced"] });
    expect(draftGoal({ objective: "x" }, AGENT, AT, catalog, 1).ok).toBe(false);
    expect(draftGoal({ objective: "  " }, KHANEIL, AT, catalog, 1).ok).toBe(false);
    expect(draftGoal({ objective: "x", deadline: "soon" }, KHANEIL, AT, catalog, 1).ok).toBe(false);
    expect(draftGoal({ objective: "x", budgetUsd: -1 }, KHANEIL, AT, catalog, 1).ok).toBe(false);
    expect(draftGoal({ objective: "x", projectId: "not-a-building" }, KHANEIL, AT, catalog, 1).ok).toBe(false);
  });

  it("allows manual edits before execution and sends an approved plan back for review", () => {
    const g = approved("Review the health of my GitHub repositories");
    const e = editGoal(g, { priority: "critical", budgetUsd: 1 }, KHANEIL, AT, catalog);
    expect(e.ok && e.goal.state).toBe("planned");
    expect(e.ok && e.goal.planApprovedAt).toBeUndefined();
    expect(editGoal(g, { priority: "low" }, AGENT, AT, catalog).ok).toBe(false);
    expect(editGoal({ ...g, state: "running" }, { priority: "low" }, KHANEIL, AT, catalog).ok).toBe(false);
  });

  it("matches every directive example to a deterministic template", () => {
    const cases: [string, string][] = [
      ["Research a profitable digital product for Benjaire", "product-research"],
      ["Review the health of my GitHub repositories", "repo-health"],
      ["Identify unfinished Atlas development tasks", "atlas-unfinished"],
      ["Summarize current business priorities", "business-priorities"],
      ["Prepare a weekly operational briefing", "operational-briefing"],
      ["Investigate a failed automation", "failed-automation"],
      ["Create an implementation plan for a project", "implementation-plan"],
      ["Identify, validate and prepare an AI automation product for Benjaire", "product-research"],
      ["Review my repositories and identify critical technical work", "repo-health"],
    ];
    for (const [text, id] of cases) expect([text, matchTemplate(text)?.template.id]).toEqual([text, id]);
    expect(matchTemplate("Plant tomatoes")).toBeNull();
  });
});

describe("2. plan schema validation", () => {
  it("every template validates against the real registry", () => {
    for (const t of TEMPLATES) {
      const p = buildPlan({ id: "goal_x", objective: t.name }, AT, t.id);
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      const v = validatePlan(p.plan, {}, catalog);
      expect([t.id, v.problems]).toEqual([t.id, []]);
    }
  });

  it("rejects broken structure, missing completion criteria and unknown agents", () => {
    const p = buildPlan({ id: "g", objective: "Review the health of my GitHub repositories" }, AT);
    if (!p.ok) throw new Error(p.error);
    const cyc = { ...p.plan, definition: { ...p.plan.definition, edges: [...p.plan.definition.edges, { id: "loop", from: "report", to: "intake" }] } };
    expect(validatePlan(cyc, {}, catalog).ok).toBe(false);
    const noCriteria = { ...p.plan, steps: p.plan.steps.filter((s) => s.nodeId !== "report") };
    expect(validatePlan(noCriteria, {}, catalog).problems.join()).toMatch(/completion criteria/);
    const ghost = { ...p.plan, definition: { ...p.plan.definition, nodes: p.plan.definition.nodes.map((n) => (n.id === "report" ? { ...n, agentId: "invented-agent" } : n)) } };
    expect(validatePlan(ghost, {}, catalog).problems.join()).toMatch(/isn't a registered agent/);
  });

  it("an unmatched goal gets no plan, only the model router's cost for Khaneil to decide", () => {
    const r = planGoal(goalFor("Plant tomatoes"), KHANEIL, AT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.route?.tier).toBeGreaterThan(0);
      expect(r.route?.estimatedUsd).toBeGreaterThan(0);
    }
  });
});

describe("3. agent capability matching", () => {
  it("uses existing registry agents only, coordinated by Agent Operations Lead", () => {
    const ids = new Set(catalog.agents.map((a) => a.id));
    for (const t of TEMPLATES) {
      const d = t.build("g");
      for (const n of d.nodes) if (n.agentId) expect([t.id, n.agentId, ids.has(n.agentId)]).toEqual([t.id, n.agentId, true]);
      expect(d.nodes.find((n) => n.id === "intake")?.agentId).toBe("agent-operations-lead");
    }
    const product = buildPlan({ id: "g", objective: "Identify, validate and prepare an AI automation product for Benjaire" }, AT);
    expect(product.ok && product.plan.definition).toBe(BENJAIRE_LAUNCH);
    const repo = buildPlan({ id: "g", objective: "Review my repositories" }, AT);
    const agents = repo.ok ? repo.plan.definition.nodes.map((n) => n.agentId).filter(Boolean) : [];
    expect(agents).toEqual(expect.arrayContaining(["repo-intelligence", "atlas-ci", "atlas-health-monitor", "atlas-release-manager"]));
  });

  it("a paused or retired agent can't silently receive work", () => {
    const p = buildPlan({ id: "g", objective: "Review the health of my GitHub repositories" }, AT);
    if (!p.ok) throw new Error(p.error);
    const paused: Catalog = { ...catalog, agents: catalog.agents.map((a) => (a.id === "atlas-ci" ? { ...a, status: "paused" } : a)) };
    const v = validatePlan(p.plan, {}, paused);
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toMatch(/paused/);
    const retired: Catalog = { ...catalog, agents: catalog.agents.map((a) => (a.id === "repo-intelligence" ? { ...a, status: "retired" } : a)) };
    expect(validatePlan(p.plan, {}, retired).problems.join()).toMatch(/retired/);
  });
});

describe("4. dependency planning", () => {
  it("parallel research, a conditional branch, review checkpoints and sequencing", () => {
    const p = buildPlan({ id: "g", objective: "Review the health of my GitHub repositories" }, AT);
    if (!p.ok) throw new Error(p.error);
    const v = validatePlan(p.plan, {}, catalog);
    expect(v.steps.find((s) => s.nodeId === "repo-status")?.parallelWith).toEqual(expect.arrayContaining(["ci-health", "app-health"]));
    expect(p.plan.definition.edges.filter((e) => e.from === "confirmed").map((e) => e.branch).sort()).toEqual(["no", "yes"]);
    expect(v.approvalGates.join()).toMatch(/repository_change/);
    expect(p.plan.steps.find((s) => s.nodeId === "confirmed")?.failure).toBe("stop_and_ask");
  });
});

describe("5. permission checks and 6. autonomy levels", () => {
  const base: ActionRequest = { kind: "read", resource: "g", environment: "atlas", risk: "low", categories: [], actor: KHANEIL };
  it("level 0 observes only; level 1 needs Khaneil to start; level 2 low-risk only; level 3 allowlisted routines within limits", () => {
    expect(authorizeAction(0, base).allowed).toBe(true);
    expect(authorizeAction(0, { ...base, kind: "draft_plan" }).allowed).toBe(false);
    expect(authorizeAction(0, { ...base, kind: "create_tasks", planApproved: true }).allowed).toBe(false);
    expect(authorizeAction(1, { ...base, kind: "draft_plan" }).allowed).toBe(true);
    expect(authorizeAction(1, { ...base, kind: "create_tasks", planApproved: false }).allowed).toBe(false);
    expect(authorizeAction(1, { ...base, kind: "create_tasks", planApproved: true }).allowed).toBe(true);
    expect(authorizeAction(1, { ...base, kind: "create_tasks", planApproved: true, actor: AGENT }).allowed).toBe(false);
    expect(authorizeAction(1, { ...base, kind: "start_step", actor: AGENT, planApproved: true }).allowed).toBe(false);
    expect(authorizeAction(2, { ...base, kind: "start_step", actor: AGENT, planApproved: true }).allowed).toBe(true);
    expect(authorizeAction(2, { ...base, kind: "start_step", actor: AGENT, planApproved: true, risk: "medium" }).allowed).toBe(false);
    expect(authorizeAction(2, { ...base, kind: "start_step", actor: AGENT, planApproved: true, environment: "external" }).allowed).toBe(false);
    expect(authorizeAction(2, { ...base, kind: "routine", actor: ATLAS, routineId: "repo-health-check" }).allowed).toBe(false);
    expect(authorizeAction(3, { ...base, kind: "routine", actor: ATLAS, routineId: "repo-health-check", routineRunsToday: 0 }).allowed).toBe(true);
    expect(authorizeAction(3, { ...base, kind: "routine", actor: ATLAS, routineId: "repo-health-check", routineRunsToday: ROUTINES["repo-health-check"].perDay }).allowed).toBe(false);
    expect(authorizeAction(3, { ...base, kind: "routine", actor: ATLAS, routineId: "deploy-everything" }).allowed).toBe(false);
  });

  it("a level never grants broad permissions: sensitive work, production and unknown actions stay refused", () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(authorizeAction(level, { ...base, kind: "start_step", categories: ["production_deploy"], planApproved: true }).allowed).toBe(false);
      expect(authorizeAction(level, { ...base, kind: "start_step", categories: ["financial"], actor: AGENT, planApproved: true }).allowed).toBe(false);
      expect(authorizeAction(level, { ...base, kind: "routine", environment: "production", actor: ATLAS, routineId: "status-monitor" }).allowed).toBe(false);
      expect(authorizeAction(level, { ...base, kind: "run_shell" }).allowed).toBe(false);
    }
    const d = authorizeAction(3, { ...base, kind: "start_step", categories: ["customer_message"] });
    expect(!d.allowed && d.needsApproval).toEqual(["customer_message"]);
  });

  it("agents can't change their own privileges; stored data never raises autonomy", () => {
    expect(setLevelProblem(AGENT, 3)).toMatch(/only Khaneil/);
    expect(setLevelProblem(KHANEIL, 9)).toMatch(/Unknown/);
    const s = new ExecutiveStore(memoryBackend());
    expect(s.setAutonomy(3, AGENT)).toMatch(/only Khaneil/);
    expect(s.snapshot().autonomy).toBe(1);
    expect(parseExecutive(JSON.stringify({ version: 1, autonomy: 7, goals: [] })).autonomy).toBe(1);
    expect(s.setAutonomy(2, KHANEIL)).toBeNull();
    expect(s.snapshot().autonomy).toBe(2);
  });

  it("level 0 goals get no plan and no tasks", () => {
    const g = goalFor("Review the health of my GitHub repositories", {}, 0);
    expect(planGoal(g, KHANEIL, AT).ok).toBe(false);
    const { svc, runs } = app();
    const forced = { ...approved("Review the health of my GitHub repositories"), autonomy: 0 as const };
    expect(delegate(forced, { svc, runs, catalog, workspace: null, tasks: [] }, KHANEIL, AT).ok).toBe(false);
    expect(svc.repo.list()).toHaveLength(0);
  });
});

describe("7. budget limits", () => {
  it("warns when the plan's caps exceed the budget and refuses to start once it's used", () => {
    const g = planned("Identify, validate and prepare an AI automation product for Benjaire", { budgetUsd: 1 });
    expect(validatePlan(g.plan!, g, catalog).budget).toMatch(/over your \$1.00 budget/);
    const a = approvePlan(g, KHANEIL, AT, catalog, null);
    if (!a.ok) throw new Error(a.error);
    const { svc, runs } = app();
    const d = delegate(a.goal, { svc, runs, catalog, workspace: null, tasks: [] }, KHANEIL, AT);
    if (!d.ok) throw new Error(d.error);
    // Mock usage reported on one task.
    const taskId = Object.values(d.run.nodeTasks)[1];
    const t = svc.repo.get(taskId)!;
    svc.repo.put({ ...t, usage: [{ model: "mock", provider: "mock", cost: { usd: 1.2, basis: "estimated" }, recordedAt: AT }] }, t.rev);
    const b = goalBudget(d.goal, svc.repo.list(), runs.list());
    expect(b).toMatchObject({ exceeded: true, estimated: true });
    expect(delegate(d.goal, { svc, runs, catalog, workspace: null, tasks: svc.repo.list() }, KHANEIL, AT).ok).toBe(false);
    expect(goalSignals(d.goal, runs.list(), byId(svc.repo.list()), catalog, NOW).some((s) => s.kind === "budget_exceeded")).toBe(true);
  });
});

describe("8. approval enforcement and 9. goal-to-task linking", () => {
  it("plans need Khaneil's approval; delegation creates linked tasks with gates and dependencies", () => {
    const g = planned("Review the health of my GitHub repositories");
    expect(approvePlan(g, AGENT, AT, catalog, null).ok).toBe(false);
    const { svc, runs } = app();
    expect(delegate(g, { svc, runs, catalog, workspace: null, tasks: [] }, KHANEIL, AT).ok).toBe(false);
    const a = approvePlan(g, KHANEIL, AT, catalog, null);
    if (!a.ok) throw new Error(a.error);
    expect(delegate(a.goal, { svc, runs, catalog, workspace: null, tasks: [] }, AGENT, AT).ok).toBe(false);
    const d = delegate(a.goal, { svc, runs, catalog, workspace: null, tasks: [] }, KHANEIL, AT);
    if (!d.ok) throw new Error(d.error);
    expect(d.goal.state).toBe("running");
    expect(d.goal.runIds).toEqual([d.run.id]);
    expect(d.run.goalId).toBe(g.id);
    const tasks = byId(svc.repo.list());
    const gate = tasks.get(d.run.nodeTasks["approve-changes"])!;
    expect(gate.categories).toEqual(["repository_change"]);
    expect(gate.requiresApproval).toBe(true);
    const report = tasks.get(d.run.nodeTasks.report)!;
    expect(report.agentId).toBe("atlas-release-manager");
    expect(report.dependencyIds).toEqual([d.run.nodeTasks.confirmed]);
    expect(report.status).toBe("blocked");
    expect(report.objective).toBe(g.objective);
    // The approval gate can't be passed by an agent.
    svc.apply(gate.id, (t) => ({ ok: true, task: { ...t, status: "queued", dependencyIds: [] } }) as never);
    const asked = svc.apply(gate.id, (t, _a, at) => requestApproval(t, ATLAS, at));
    expect(asked.ok).toBe(true);
    expect(svc.apply(gate.id, (t, _a, at) => decideApproval(t, "granted", AGENT, at)).ok).toBe(false);
    // Workflow Intelligence sees the goal and its plan.
    const wf = executiveWorkflows([d.goal]);
    expect(wf.goals[0].id).toBe(g.id);
    expect(wf.definitions[d.goal.plan!.definition.id]).toBeTruthy();
  });
});

describe("10. execution status synchronization and 14. failure and recovery", () => {
  it("reads progress from the Task Center, moves to review only when work finishes, and recovers from a failed step", () => {
    const g = approved("Identify unfinished Atlas development tasks");
    const { svc, runs } = app();
    const d = delegate(g, { svc, runs, catalog, workspace: null, tasks: [] }, KHANEIL, AT);
    if (!d.ok) throw new Error(d.error);
    let goal = d.goal;
    const status = () => goalStatus(goal, runs.list(), byId(svc.repo.list()), catalog);
    expect(status()).toMatchObject({ done: 0, total: 4, nextMilestone: "Coordinate the goal", workFinished: false });

    finish(svc, d.run.nodeTasks.intake);
    finish(svc, d.run.nodeTasks["open-prs"], "failed");
    expect(status().status.get("open-prs")).toBe("failed");
    expect(goalSignals(goal, runs.list(), byId(svc.repo.list()), catalog, NOW).map((s) => s.kind)).toContain("failed");
    expect(syncGoal(goal, status(), AT)).toBeNull();

    // Recovery: Khaneil retries the failed step (bounded by the task's attempt limit).
    expect(svc.apply(d.run.nodeTasks["open-prs"], (t, _a, at) => retry(t, KHANEIL, at)).ok).toBe(true);
    finish(svc, d.run.nodeTasks["open-prs"]);
    finish(svc, d.run.nodeTasks["open-tasks"]);
    finish(svc, d.run.nodeTasks.rank);
    expect(status()).toMatchObject({ done: 4, total: 4, progress: 1, workFinished: true });
    const next = syncGoal(goal, status(), AT);
    expect(next?.state).toBe("review");
    goal = next!;
    // Atlas never confirms the outcome: Khaneil does, with a note.
    expect(reviewOutcome(goal, true, "", KHANEIL, AT).ok).toBe(false);
    expect(reviewOutcome(goal, true, "Ranked list used", AGENT, AT).ok).toBe(false);
    const done = reviewOutcome(goal, true, "Ranked list used for this week", KHANEIL, AT);
    expect(done.ok && done.goal.state).toBe("completed");
  });
});

describe("11. blocker detection", () => {
  it("flags pending approvals, missing tasks, unavailable agents and stale goals, once each, never lateness without a deadline", () => {
    const g = approved("Investigate a failed automation");
    const { svc, runs } = app();
    const d = delegate(g, { svc, runs, catalog, workspace: null, tasks: [] }, KHANEIL, AT);
    if (!d.ok) throw new Error(d.error);
    const later = NOW + 30 * 86_400_000;
    let tasks = byId(svc.repo.list());
    let kinds = goalSignals(d.goal, runs.list(), tasks, catalog, later).map((s) => s.kind);
    expect(kinds).not.toContain("overdue");
    expect(kinds).toContain("stale");
    const withDeadline = { ...d.goal, deadline: "2026-11-20" };
    expect(goalSignals(withDeadline, runs.list(), tasks, catalog, later).map((s) => s.kind)).toContain("overdue");
    expect(goalSignals(withDeadline, runs.list(), tasks, catalog, NOW).map((s) => s.kind)).not.toContain("overdue");

    finish(svc, d.run.nodeTasks.intake);
    finish(svc, d.run.nodeTasks.collect);
    finish(svc, d.run.nodeTasks.cause);
    svc.apply(d.run.nodeTasks["approve-recovery"], (t, _a, at) => requestApproval(t, ATLAS, at));
    tasks = byId(svc.repo.list());
    kinds = goalSignals(d.goal, runs.list(), tasks, catalog, NOW).map((s) => s.kind);
    expect(kinds).toContain("pending_approval");

    const missing = { ...d.run, errors: { recover: "Not created" } };
    const brokenRuns = runs.list().map((r) => (r.id === d.run.id ? missing : r));
    expect(goalSignals(d.goal, brokenRuns, tasks, catalog, NOW).map((s) => s.kind)).toContain("missing_dependency");

    const paused: Catalog = { ...catalog, agents: catalog.agents.map((a) => (a.id === "atlas-rerun-failed" ? { ...a, status: "paused" } : a)) };
    expect(goalSignals(d.goal, runs.list(), tasks, paused, NOW).map((s) => s.kind)).toContain("unavailable_agent");

    // Duplicates collapse to one entry per key, and dismissed keys stay hidden.
    const twice = executiveAttention([d.goal, d.goal], runs.list(), tasks, catalog, NOW);
    expect(new Set(twice.map((s) => s.key)).size).toBe(twice.length);
    const hidden = executiveAttention([d.goal], runs.list(), tasks, catalog, NOW, new Set([twice[0].key]));
    expect(hidden.some((s) => s.key === twice[0].key)).toBe(false);
  });
});

describe("12. briefing accuracy", () => {
  it("counts only real records, says None when empty, and calls no model", () => {
    const empty = buildBriefing({ kind: "on_demand", goals: [], runs: [], tasks: [], catalog, now: NOW });
    expect(empty.inProgress).toEqual([]);
    expect(empty.ai.usd).toBe(0);
    expect(briefingText(empty)).toMatch(/Goals in progress:\n- None/);
    expect(briefingText(empty)).toMatch(/Nothing needs you/);

    const g = approved("Identify unfinished Atlas development tasks");
    const draft = goalFor("Summarize current business priorities");
    const { svc, runs } = app();
    const d = delegate(g, { svc, runs, catalog, workspace: null, tasks: [] }, KHANEIL, AT);
    if (!d.ok) throw new Error(d.error);
    finish(svc, d.run.nodeTasks.intake);
    const t = svc.repo.get(d.run.nodeTasks.intake)!;
    svc.repo.put({ ...t, usage: [{ model: "mock", provider: "mock", cost: { usd: 0.25, basis: "billed" }, recordedAt: AT }] }, t.rev);
    const b = buildBriefing({ kind: "weekly", goals: [d.goal, draft], runs: runs.list(), tasks: svc.repo.list(), catalog, now: NOW });
    expect(b.inProgress.map((x) => x.ref)).toEqual([d.goal.id, draft.id]);
    expect(b.inProgress[0].text).toMatch(/1 of 4 steps done/);
    expect(b.completedWork.map((x) => x.ref)).toEqual([d.run.nodeTasks.intake]);
    expect(b.ai).toMatchObject({ usd: 0.25, estimated: false, tasksWithUsage: 1 });
    expect(b.nextActions.join()).toMatch(/Draft a plan/);
    expect(b.period).toEqual({ from: "2026-11-11", to: "2026-11-17" });
    const proj = buildBriefing({ kind: "project", projectId: "benjaire-site", goals: [d.goal, draft], runs: runs.list(), tasks: svc.repo.list(), catalog, now: NOW });
    expect(proj.inProgress.map((x) => x.ref)).toEqual([draft.id]);
  });
});

describe("13. Output Studio integration", () => {
  it("goal -> workflow -> task -> agent -> output, through the existing orchestrator and Output Studio", async () => {
    const g = approved("Identify, validate and prepare an AI automation product for Benjaire");
    const { svc, runs, now } = app();
    const d = delegate(g, { svc, runs, catalog, workspace: null, tasks: [] }, KHANEIL, AT);
    if (!d.ok) throw new Error(d.error);
    const ledger = new LedgerStore(memoryBackend());
    const intel = new IntelligenceStore(memoryBackend(), catalog, now);
    const sim = simulatedAdapter();
    const orch = new Orchestrator({ tasks: svc, runs, ledger, catalog, now, adapterFor: (n) => (n.execution.kind === "n8n" ? sim : manualAdapter), context: () => undefined });
    expect(orch.authorize(d.run.id, AGENT).ok).toBe(false);
    expect(orch.authorize(d.run.id, KHANEIL).ok).toBe(true);
    await orch.step(d.run.id);
    const rec = orch.recordOutput(d.run.id, "intake", output("goal-intake/1", { goal: g.objective, budgetUsd: 0, agents: ["benjaire-product-lab"] }), KHANEIL);
    expect(rec.ok).toBe(true);
    const outs = liveOutputs({ run: d.run, tasks: byId(svc.repo.list()), ledger: ledger.get(d.run.id) });
    const intakeOut = outs.find((o) => o.nodeId === "intake");
    expect(intakeOut).toMatchObject({ workflowRunId: d.run.id, taskId: d.run.nodeTasks.intake, agentId: "agent-operations-lead", mode: "live", verificationStatus: "verified" });
    // Steps that haven't run show as missing, never as made-up results.
    expect(outs.find((o) => o.nodeId === "scoring")?.verificationStatus).not.toBe("verified");
    expect(intel).toBeTruthy();
  });
});

describe("persistent executive context and security", () => {
  it("retrieves only the goal's project memory, with sources, within budget", () => {
    const intel = new IntelligenceStore(memoryBackend(), catalog, () => AT);
    intel.write({ category: "project_knowledge", scope: { project: "benjaire-site" }, title: "Benjaire product research decision", content: "Approved: research AI automation products for agencies first.", tags: ["product", "research"], source: { kind: "person", ref: "note-1" } }, KHANEIL);
    intel.write({ category: "project_knowledge", scope: { project: "portfolio-site" }, title: "Portfolio product research", content: "Product research notes for the portfolio site.", tags: ["product", "research"], source: { kind: "person", ref: "note-2" } }, KHANEIL);
    const g = planned("Research a profitable digital product for Benjaire");
    const r = executiveContext(g, intel.snapshot().memory, NOW);
    expect(r.items.map((i) => i.source.ref)).toContain("note-1");
    expect(r.items.map((i) => i.source.ref)).not.toContain("note-2");
    expect(r.usedTokens).toBeLessThanOrEqual(r.budgetTokens);
  });

  it("redacts credentials, refuses stale writes and agent writes", () => {
    expect(redact("use sk-abcdefghijklmnop1234 and ghp_abcdefghijklmnopqrstuvwxyz12")).toBe("use [redacted] and [redacted]");
    const s = new ExecutiveStore(memoryBackend());
    const g = goalFor("Investigate a failed automation", { constraints: ["Token Bearer abcdefghijklmnopqrstuvwxyz"] });
    expect(s.add(g, AGENT).ok).toBe(false);
    const added = s.add(g, KHANEIL);
    expect(added.ok && added.goal.constraints[0]).toBe("Token [redacted]");
    if (!added.ok) return;
    expect(s.put({ ...added.goal, priority: "high" }, added.goal.rev, KHANEIL, "edit").ok).toBe(true);
    expect(s.put({ ...added.goal, priority: "low" }, added.goal.rev, KHANEIL, "edit").ok).toBe(false);
    expect(s.snapshot().audit.map((a) => a.action)).toEqual(["goal_created", "edit"]);
  });
});

describe("15. existing application regression", () => {
  it("the saved Benjaire workflow and its live statuses are unchanged by executive reuse", () => {
    expect(BENJAIRE_LAUNCH.id).toBe("benjaire-ai-product-launch");
    const g = approved("Identify, validate and prepare an AI automation product for Benjaire");
    const { svc, runs } = app();
    const d = delegate(g, { svc, runs, catalog, workspace: null, tasks: [] }, KHANEIL, AT);
    if (!d.ok) throw new Error(d.error);
    const st = liveStatus(d.run.snapshot, d.run, byId(svc.repo.list()));
    expect(st.get("intake")).toBe("queued");
    expect(st.get("market-research")).toBe("blocked");
    expect(Object.keys(d.run.nodeTasks)).toHaveLength(BENJAIRE_LAUNCH.nodes.filter((n) => n.kind !== "outcome").length);
  });
});
