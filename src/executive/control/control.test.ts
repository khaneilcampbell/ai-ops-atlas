import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { canMoveGoal, canMoveTask, taskCenterStatus } from "./lifecycle";
import { checkPlan, depthOf, draftPlan, parsePlan, validateGoal } from "./plan";
import { authorizeTask, bindingHash, canonical, checkApproval, type ActionBinding } from "./policy";
import { actionLevel, selectAgent, type AgentStats, type RosterAgent } from "./select";
import { parseReport, summarise, verifyReport } from "./verify";
import { parseResult, estimateCost } from "./contracts";
import { capability } from "../../intelligence/capabilities";
import { GOAL_STATES, PLAN_LIMITS, type ExecutivePlan } from "./types";

const OBJECTIVE = "Research one potential Benjaire AI automation product and prepare a structured opportunity report.";

describe("goal validation", () => {
  it("accepts a plain goal and rejects empty, oversized, control-character and over-budget goals", () => {
    expect(validateGoal({ objective: OBJECTIVE }, 5)).toMatchObject({ ok: true, value: { objective: OBJECTIVE, budgetUsd: null, autonomy: null } });
    expect(validateGoal({ objective: "" }, 5).ok).toBe(false);
    expect(validateGoal({ objective: "too short" }, 5).ok).toBe(false);
    expect(validateGoal({ objective: "x".repeat(PLAN_LIMITS.maxObjectiveChars + 1) }, 5).ok).toBe(false);
    expect(validateGoal({ objective: `${OBJECTIVE}\u0007` }, 5).ok).toBe(false);
    expect(validateGoal({ objective: OBJECTIVE, budgetUsd: 6 }, 5).ok).toBe(false);
    expect(validateGoal({ objective: OBJECTIVE, budgetUsd: 0 }, 5).ok).toBe(false);
    expect(validateGoal({ objective: OBJECTIVE, autonomy: 4 }, 5).ok).toBe(false);
    expect(validateGoal("not an object", 5).ok).toBe(false);
  });
});

describe("planning", () => {
  it("plans the opportunity report from a fixed template, with no model", () => {
    const p = draftPlan(OBJECTIVE);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.plan.template).toBe("opportunity-research");
    expect(p.plan.tasks.map((t) => [t.key, t.capability, t.dependsOn])).toEqual([
      ["research", "research.opportunity_report", []],
      ["verify-and-report", "executive.verify", ["research"]],
    ]);
    expect(checkPlan(p.plan, { budgetUsd: 1 }).ok).toBe(true);
  });

  it("refuses goals no template fits and goals asking for level 4 actions", () => {
    expect(draftPlan("Maintain my Benjaire website and keep it healthy every week.").ok).toBe(false);
    const publish = draftPlan("Research a product idea and publish it to the shop today.");
    expect(publish.ok).toBe(false);
    if (!publish.ok) expect(publish.reason).toMatch(/approval/);
  });

  const base = (): ExecutivePlan => {
    const p = draftPlan(OBJECTIVE);
    if (!p.ok) throw new Error("no plan");
    return JSON.parse(JSON.stringify(p.plan)) as ExecutivePlan;
  };

  it("rejects malformed plans: wrong schema, unknown fields, missing tasks", () => {
    expect(parsePlan({ ...base(), schema: "other/1" }).ok).toBe(false);
    expect(parsePlan({ ...base(), extra: 1 }).ok).toBe(false);
    expect(parsePlan({ ...base(), tasks: [] }).ok).toBe(false);
    expect(parsePlan(null).ok).toBe(false);
  });

  it("rejects cycles, self-dependencies, missing dependencies and duplicates", () => {
    const cyc = base();
    cyc.tasks[0].dependsOn = ["verify-and-report"];
    const r = checkPlan(cyc, { budgetUsd: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toMatch(/circle/i);
    expect(depthOf(cyc.tasks)).toBeNull();
    const self = base();
    self.tasks[0].dependsOn = ["research"];
    expect(checkPlan(self, { budgetUsd: 1 }).ok).toBe(false);
    const missing = base();
    missing.tasks[1].dependsOn = ["nowhere"];
    expect(checkPlan(missing, { budgetUsd: 1 }).ok).toBe(false);
    const dup = base();
    dup.tasks[1].key = "research";
    expect(checkPlan(dup, { budgetUsd: 1 }).ok).toBe(false);
  });

  it("rejects unknown capabilities, overspending tasks, wrong estimates and budget contradictions", () => {
    const unknown = base();
    unknown.tasks[0].capability = "launch.rockets";
    expect(checkPlan(unknown, { budgetUsd: 1 }).ok).toBe(false);
    const costly = base();
    costly.tasks[0].maxCostUsd = PLAN_LIMITS.maxTaskCostUsd + 1;
    expect(checkPlan(costly, { budgetUsd: 5 }).ok).toBe(false);
    const estimate = base();
    estimate.estimatedCostUsd = 0.01;
    expect(checkPlan(estimate, { budgetUsd: 1 }).ok).toBe(false);
    const poor = checkPlan(base(), { budgetUsd: 0.2 });
    expect(poor.ok).toBe(false);
    if (!poor.ok) expect(poor.problems.join(" ")).toMatch(/budget/);
  });

  it("rejects too many tasks and too deep a chain", () => {
    const p = base();
    const many = Array.from({ length: PLAN_LIMITS.maxTasks + 1 }, (_, i) => ({ ...p.tasks[1], key: `t${i}`, dependsOn: i ? [`t${i - 1}`] : [] }));
    expect(checkPlan({ ...p, tasks: many }, { budgetUsd: 1 }).ok).toBe(false);
    expect(depthOf(many)).toBe(many.length);
  });
});

describe("lifecycle", () => {
  it("allows only the listed transitions and never skips to completed", () => {
    expect(canMoveGoal("GOAL_RECEIVED", "GOAL_VALIDATED")).toBe(true);
    expect(canMoveGoal("PLAN_GENERATED", "GOAL_COMPLETED")).toBe(false);
    expect(canMoveGoal("EXECUTION_MONITORED", "GOAL_COMPLETED")).toBe(false);
    expect(canMoveGoal("RESULTS_VERIFIED", "GOAL_COMPLETED")).toBe(true);
    for (const s of ["GOAL_COMPLETED", "FAILED", "CANCELLED"] as const) for (const to of GOAL_STATES) expect(canMoveGoal(s, to)).toBe(false);
    expect(canMoveTask("running", "completed")).toBe(false);
    expect(canMoveTask("verifying", "completed")).toBe(true);
    expect(taskCenterStatus("verifying")).toBe("running");
    expect(taskCenterStatus("ready")).toBe("queued");
  });
});

describe("agent selection", () => {
  const roster: RosterAgent[] = catalog.agents.map((a) => ({ id: a.id, name: a.name, status: a.status, projectId: a.projectId }));
  const none = new Map<string, AgentStats>();

  it("picks the registered research agent for opportunity reports, from the catalog on disk", () => {
    const s = selectAgent("research.opportunity_report", roster, none);
    expect(s.ok && s.agent.id).toBe("benjaire-product-lab-research");
  });

  it("blocks with the reason when no eligible agent exists", () => {
    const paused = roster.map((a) => (a.id === "benjaire-product-lab-research" ? { ...a, status: "paused" } : a));
    const s = selectAgent("research.opportunity_report", paused, none);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toMatch(/status is paused/);
    expect(selectAgent("no.such.capability", roster, none).ok).toBe(false);
    const unreliable = new Map([["benjaire-product-lab-research", { active: 0, succeeded: 0, failed: 5 }]]);
    expect(selectAgent("research.opportunity_report", roster, unreliable).ok).toBe(false);
  });

  it("is deterministic and ranks levels by side effect", () => {
    expect(selectAgent("research.opportunity_report", roster, none)).toEqual(selectAgent("research.opportunity_report", [...roster].reverse(), none));
    expect(actionLevel(capability("research.opportunity_report")!)).toBe(2);
    expect(actionLevel(capability("executive.verify")!)).toBe(2);
  });
});

describe("authorization and approvals", () => {
  const binding: ActionBinding = { action: "research.opportunity_report", target: "task-1", params: { maxCostUsd: 0.6, agent: "benjaire-product-lab-research" }, requestedBy: "atlas-executive" };

  it("enforces autonomy levels, the spend ceiling and the budget", () => {
    const base = { estimatedCostUsd: 0.6, budgetRemainingUsd: 1, autoSpendCeilingUsd: 1 };
    expect(authorizeTask({ ...base, goalAutonomy: 2, actionLevel: 2 }).kind).toBe("allowed");
    expect(authorizeTask({ ...base, goalAutonomy: 1, actionLevel: 2 }).kind).toBe("needs_approval");
    expect(authorizeTask({ ...base, goalAutonomy: 3, actionLevel: 4 }).kind).toBe("needs_approval");
    expect(authorizeTask({ ...base, goalAutonomy: 2, actionLevel: 2, autoSpendCeilingUsd: 0.5 }).kind).toBe("needs_approval");
    expect(authorizeTask({ ...base, goalAutonomy: 2, actionLevel: 2, budgetRemainingUsd: 0.5 }).kind).toBe("refused");
  });

  it("binds an approval to the exact action and rejects self-approval, expiry, rejection and changes", async () => {
    const hash = await bindingHash(binding);
    expect(canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const now = Date.parse("2026-11-22T12:00:00Z");
    const ok = { status: "approved", reviewer: "khaneil@example.com", requestedBy: "atlas-executive", expiresAt: "2026-11-23T12:00:00Z", bindingHash: hash };
    expect(await checkApproval(ok, binding, now)).toEqual({ ok: true });
    expect((await checkApproval({ ...ok, reviewer: "atlas-executive" }, binding, now)).ok).toBe(false);
    expect(await checkApproval({ ...ok, status: "rejected" }, binding, now)).toMatchObject({ state: "rejected" });
    expect(await checkApproval(ok, binding, Date.parse("2026-11-24T00:00:00Z"))).toMatchObject({ state: "expired" });
    expect(await checkApproval({ ...ok, status: "pending" }, binding, now)).toMatchObject({ state: "pending" });
    expect(await checkApproval(ok, { ...binding, params: { ...binding.params, maxCostUsd: 2 } }, now)).toMatchObject({ state: "invalid" });
  });
});

describe("verification", () => {
  const urls = ["https://a.example.com/one", "https://b.example.com/two", "https://c.example.com/three"];
  const report = () => ({
    schema: "opportunity-report/1",
    productName: "Test product",
    sections: Object.fromEntries(
      ["targetCustomerProblem", "proposedSolution", "competitorOverview", "marketEvidence", "technicalFeasibility", "businessRisks", "recommendedNextStep"].map((k) => [
        k,
        { text: `${k}: a sufficiently long piece of text that describes this section for the checks in Atlas.`, sources: k === "competitorOverview" ? ["S2"] : k === "marketEvidence" ? ["S1", "S3"] : [] },
      ]),
    ),
    sources: urls.map((url, i) => ({ id: `S${i + 1}`, title: `Source ${i + 1}`, url })),
  });

  it("passes a complete report whose sources came from the run's own search", () => {
    const p = parseReport(report());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const v = verifyReport(p.report, urls, "2026-11-22T12:00:00Z");
    expect(v.passed).toBe(true);
    expect(summarise(p.report)).toContain("Recommended next step");
  });

  it("fails invented sources, missing sections, broken citations and placeholders", () => {
    const p = parseReport(report());
    if (!p.ok) throw new Error(p.error);
    expect(verifyReport(p.report, urls.slice(0, 1), "t").passed).toBe(false);
    const missing = report();
    delete (missing.sections as Record<string, unknown>).businessRisks;
    const pm = parseReport(missing);
    expect(!pm.ok || !verifyReport(pm.report, urls, "t").passed).toBe(true);
    const badCite = report();
    (badCite.sections as Record<string, { sources: string[] }>).marketEvidence.sources = ["S9"];
    const pc = parseReport(badCite);
    expect(!pc.ok || !verifyReport(pc.report, urls, "t").passed).toBe(true);
    const placeholder = report();
    (placeholder.sections as Record<string, { text: string }>).proposedSolution.text = "TODO lorem ipsum placeholder text that is long enough to pass the length check here.";
    const pp = parseReport(placeholder);
    expect(!pp.ok || !verifyReport(pp.report, urls, "t").passed).toBe(true);
    expect(parseReport({ schema: "nope" }).ok).toBe(false);
  });
});

describe("result contract", () => {
  const good = { contract: "ATLAS_WORKFLOW_RESULT", version: 1, eventId: "e1", taskId: "00000000-0000-4000-8000-000000000001", attempt: 1, correlationId: "c", idempotencyKey: "k", nonce: "n", executionId: "1", kind: "succeeded", at: "2026-11-22T12:00:00Z" };
  it("parses strictly and prices usage, never at zero for unknown models", () => {
    expect(parseResult(good).ok).toBe(true);
    expect(parseResult({ ...good, contract: "OTHER" }).ok).toBe(false);
    expect(parseResult({ ...good, taskId: "x" }).ok).toBe(false);
    expect(parseResult({ ...good, contract: "ATLAS_EXECUTIVE_ERROR" }).ok).toBe(false);
    expect(estimateCost({ model: "claude-sonnet-5-5", inputTokens: 1_000_000, outputTokens: 0, webSearches: 5 })).toBe(2.05);
    expect(estimateCost({ model: "mystery", inputTokens: 1_000_000, outputTokens: 0, webSearches: 0 })).toBe(4);
  });
});

describe("UI state sync", () => {
  const overview = (): import("./types").ExecutiveOverview => ({
    configured: { database: true, n8n: true, schedule: true },
    emergencyStop: null,
    goals: [
      { id: "g1", goalRecordId: "r1", objective: OBJECTIVE, state: "EXECUTION_MONITORED", stateReason: null, autonomy: 2, budgetUsd: 1, spentUsd: 0.3, createdAt: "t", updatedAt: "t", completedAt: null, summary: null, plan: null, planProblems: [], tasks: [{ state: "running" }, { state: "pending" }] as never },
      { id: "g2", goalRecordId: "r2", objective: "x", state: "BLOCKED", stateReason: "No eligible agent", autonomy: 1, budgetUsd: 1, spentUsd: 0, createdAt: "t", updatedAt: "t", completedAt: null, summary: null, plan: null, planProblems: [], tasks: [] },
      { id: "g3", goalRecordId: "r3", objective: "y", state: "GOAL_COMPLETED", stateReason: null, autonomy: 2, budgetUsd: 1, spentUsd: 0.25, createdAt: "t", updatedAt: "t", completedAt: "t", summary: "s", plan: null, planProblems: [], tasks: [{ state: "completed", artifact: { report: null, verification: { passed: true, checkedAt: "t", checks: [] } } }] as never },
    ],
    approvals: [{ id: "a", goalId: "r2", taskId: null, action: "research", target: "t", status: "pending", expiresAt: null, createdAt: "t" }],
    events: [],
    spend: { todayUsd: 0.55, dispatchesToday: 2, dailyCap: 10 },
  });

  it("counts open, running, blocked, waiting and verified work from the stored overview only", async () => {
    const { summariseControl } = await import("./client");
    const s = summariseControl(overview());
    expect(s).toMatchObject({ running: 1, blocked: 1, awaitingApproval: 1, verified: 1, failed: 0, spentUsd: 0.55 });
    expect(s.open.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(s.line).toBe("2 open goals · 1 running · 1 waiting for you · 1 blocked");
    expect(summariseControl({ ...overview(), emergencyStop: "Emergency stop is on (x)" }).line).toMatch(/^Emergency stop is on/);
  });

  it("reads the site on the web page, and points the Mac app to the web page", async () => {
    const { fetchControl } = await import("./client");
    const ok = (async () => new Response(JSON.stringify(overview()), { status: 200 })) as unknown as typeof fetch;
    expect((await fetchControl(ok, true, false)).state).toBe("ready");
    expect((await fetchControl(ok, false, true)).state).toBe("off");
    const missing = (async () => new Response(JSON.stringify({ message: "Apply migration 0002" }), { status: 503 })) as unknown as typeof fetch;
    expect(await fetchControl(missing, true, false)).toEqual({ state: "not-configured", message: "Apply migration 0002" });
  });
});
