import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { approvalRefusal, decideApproval, liveAttempt } from "../tasks/lifecycle";
import { byId, LocalTaskRepository, memoryBackend, TaskService, type Backend } from "../tasks/store";
import { KHANEIL, type Actor } from "../tasks/types";
import { BENJAIRE_LAUNCH, BENJAIRE_LAUNCH_GOAL } from "../workflows/benjaireLaunch";
import { buildingActivity, liveStatus, resolveAll } from "../workflows/engine";
import { RunStore, startLiveRun } from "../workflows/runs";
import type { WorkflowRun } from "../workflows/types";
import { adapterRouter, githubStatus, manualAdapter, n8nAdapter, output, simulatedAdapter, type SimulatedPlan } from "./adapters";
import { buildEnvelope, repairOutput, validateOutput } from "./handoff";
import { bridgeAdapter, pullReports, type BridgeClient } from "./bridgeClient";
import { LedgerStore } from "./ledger";
import type { StepReportBody } from "./n8nBridge";
import { Orchestrator } from "./orchestrator";
import { backoffMs, budgetProblem, stepPolicy } from "./policy";
import { goalReport, runStatus, stepTiming } from "./report";
import type { ExecutionAdapter, ExecutionReport, HandoffEnvelope, StepOutput } from "./types";

const art = (id: string) => ({ id, label: id, url: `https://docs.google.com/document/d/${id}`, kind: "document" as const });
const OUT: Record<string, StepOutput> = {
  intake: output("goal-intake/1", { goal: "Launch a Benjaire AI product", budgetUsd: 5, agents: ["benjaire-product-lab"] }),
  "market-research": output("market-research/1", { ideas: ["Inbox triage", "Invoice chase"] }, [art("signals")]),
  "customer-research": output("customer-research/1", { personas: ["Agency owner"], pains: ["Slow follow ups"] }),
  "competitor-analysis": output("competitor-analysis/1", { competitors: ["Acme"] }),
  scoring: output("opportunity-scores/1", { rankings: ["Inbox triage"], criteria: ["demand"], topIdea: "Inbox triage" }, [art("scores")]),
  brief: output("product-brief/1", { audience: "Small agencies", mvpScope: ["Gmail triage"] }, [art("brief")]),
  planning: output("product-plan/1", { effortDays: 10, risks: ["Gmail API limits"], audience: "Small agencies" }),
  develop: output("development/1", { repository: "khaneilcampbell/benjaire-flow", build: "passed", tests: "passed" }, [art("pr")]),
  quality: output("quality/1", { passed: true }),
  publish: output("publication/1", { listing: "Inbox triage" }, [art("listing")]),
  monitor: output("launch-outcome/1", { summary: "Listed. No sales yet." }),
};

const N8N: Actor = { kind: "n8n", id: "n8n", name: "n8n" };
const AGENT: Actor = { kind: "agent", id: "benjaire-product-lab", name: "Product Lab Lead" };

interface Env {
  backends: { tasks: Backend; runs: Backend; ledger: Backend };
  svc: TaskService;
  runs: RunStore;
  ledger: LedgerStore;
  orch: Orchestrator;
  sim: ReturnType<typeof simulatedAdapter>;
  run: WorkflowRun;
  tick(ms?: number): void;
  task(nodeId: string): ReturnType<TaskService["repo"]["get"]>;
  report(nodeId: string, kind: ExecutionReport["kind"], extra?: Partial<ExecutionReport>): ExecutionReport;
}

function setup(plan: SimulatedPlan = {}, opts: { maxConcurrent?: number; adapter?: (nodeId: string) => ExecutionAdapter | undefined; backends?: Env["backends"]; existingRun?: WorkflowRun } = {}): Env {
  let clock = Date.parse("2026-11-15T12:00:00Z");
  const now = () => new Date(clock).toISOString();
  const backends = opts.backends ?? { tasks: memoryBackend(), runs: memoryBackend(), ledger: memoryBackend() };
  const svc = new TaskService(new LocalTaskRepository(backends.tasks), now);
  const runs = new RunStore(backends.runs);
  const ledger = new LedgerStore(backends.ledger);
  const sim = simulatedAdapter(plan);
  const orch = new Orchestrator({
    tasks: svc,
    runs,
    ledger,
    catalog,
    now,
    maxConcurrent: opts.maxConcurrent,
    adapterFor: (n) => opts.adapter?.(n.id) ?? (n.id === "publish" ? n8nAdapter : n.execution.kind === "n8n" ? sim : manualAdapter),
  });
  let run = opts.existingRun;
  if (!run) {
    const r = startLiveRun(BENJAIRE_LAUNCH_GOAL, BENJAIRE_LAUNCH, svc, runs, catalog, KHANEIL, now());
    run = r.run!;
  }
  let n = 0;
  const task = (nodeId: string) => svc.repo.get(run!.nodeTasks[nodeId]);
  return {
    backends,
    svc,
    runs,
    ledger,
    orch,
    sim,
    run,
    tick: (ms = 1000) => void (clock += ms),
    task,
    report: (nodeId, kind, extra = {}) => ({ eventId: `ev-${nodeId}-${kind}-${++n}`, runId: run!.id, nodeId, attemptId: liveAttempt(task(nodeId)!)?.id ?? "none", kind, source: N8N, at: now(), ...(kind === "succeeded" ? { output: OUT[nodeId] } : {}), ...extra }),
  };
}

const status = (e: Env, nodeId: string) => e.task(nodeId)?.status;

async function throughResearch(e: Env) {
  expect(e.orch.authorize(e.run.id, KHANEIL).ok).toBe(true);
  expect(e.orch.recordOutput(e.run.id, "intake", OUT.intake, KHANEIL).ok).toBe(true);
  await e.orch.step(e.run.id);
}

async function finishResearch(e: Env) {
  await throughResearch(e);
  for (const id of ["market-research", "customer-research", "competitor-analysis"]) expect(e.orch.receive(e.report(id, "succeeded")).ok).toBe(true);
  await e.orch.step(e.run.id);
}

describe("start authorisation", () => {
  it("only a person can start a run or authorise execution", async () => {
    const e = setup();
    expect(startLiveRun(BENJAIRE_LAUNCH_GOAL, BENJAIRE_LAUNCH, e.svc, e.runs, catalog, AGENT).error).toMatch(/only a person/);
    expect(e.orch.authorize(e.run.id, AGENT).ok).toBe(false);
    expect(await e.orch.step(e.run.id)).toMatchObject({ ok: false });
    expect(e.sim.sent).toHaveLength(0);
    expect(e.orch.authorize(e.run.id, KHANEIL).ok).toBe(true);
    expect((await e.orch.step(e.run.id)).ok).toBe(true);
  });
});

describe("dependencies and parallel work", () => {
  it("intake waits on a person; research then runs in parallel", async () => {
    const e = setup();
    e.orch.authorize(e.run.id, KHANEIL);
    const first = await e.orch.step(e.run.id);
    expect(first.ok && first.summary.waitingOnPerson.map((w) => w.nodeId)).toEqual(["intake"]);
    expect(runStatus(e.run, byId(e.svc.repo.list()), e.ledger.get(e.run.id), new Map([["intake", "person"]]))).toBe("waiting_on_person");
    expect(e.sim.sent).toHaveLength(0);
    e.orch.recordOutput(e.run.id, "intake", OUT.intake, KHANEIL);
    const s = await e.orch.step(e.run.id);
    expect(s.ok && s.summary.dispatched.sort()).toEqual(["competitor-analysis", "customer-research", "market-research"]);
    expect(["market-research", "customer-research", "competitor-analysis"].map((id) => status(e, id))).toEqual(["running", "running", "running"]);
    expect(status(e, "scoring")).toBe("blocked");
  });

  it("bounded concurrency holds the extra step until a slot frees", async () => {
    const e = setup({}, { maxConcurrent: 2 });
    await throughResearch(e);
    expect(e.sim.sent).toHaveLength(2);
    const held = await e.orch.step(e.run.id);
    expect(held.ok && held.summary.held.some((h) => /concurrency/.test(h.why))).toBe(true);
    e.orch.receive(e.report(e.sim.sent[0].nodeId, "succeeded"));
    await e.orch.step(e.run.id);
    expect(e.sim.sent).toHaveLength(3);
  });

  it("scoring stays blocked until all three research steps complete", async () => {
    const e = setup();
    await throughResearch(e);
    e.orch.receive(e.report("market-research", "succeeded"));
    e.orch.receive(e.report("customer-research", "succeeded"));
    await e.orch.step(e.run.id);
    expect(status(e, "scoring")).toBe("blocked");
    expect(e.sim.sent.some((x) => x.nodeId === "scoring")).toBe(false);
    e.orch.receive(e.report("competitor-analysis", "succeeded"));
    await e.orch.step(e.run.id);
    expect(status(e, "scoring")).toBe("running");
  });
});

describe("structured handoffs", () => {
  it("the next step receives validated upstream outputs in a standard envelope", async () => {
    const e = setup();
    await finishResearch(e);
    const env = e.sim.sent.find((x) => x.nodeId === "scoring")!;
    const t = e.task("scoring")!;
    expect(env).toMatchObject({ envelopeVersion: 1, runId: e.run.id, taskId: t.id, destinationAgentId: "benjaire-product-lab-scoring", outputSchema: "opportunity-scores/1", correlationId: e.run.id, idempotencyKey: `${t.id}:1` });
    expect(env.sourceAgentIds.sort()).toEqual(["benjaire-product-lab-competitors", "benjaire-product-lab-customers", "benjaire-product-lab-research"]);
    expect(Object.keys(env.inputs).sort()).toEqual(["competitor-analysis", "customer-research", "market-research"]);
    expect(env.inputs["market-research"].fields.ideas).toEqual(["Inbox triage", "Invoice chase"]);
    expect(env.artifacts.map((a) => a.id)).toEqual(["signals"]);
    expect(env.inputSchema).toContain("market-research/1");
  });

  it("refuses unknown fields, long text and non-https artifacts", () => {
    expect(validateOutput("customer-research", { ...OUT["customer-research"], fields: { ...OUT["customer-research"].fields, shell: "rm -rf /" } })).toContain('Unexpected field "shell".');
    expect(validateOutput("brief", { ...OUT.brief, fields: { audience: "x".repeat(2001), mvpScope: ["a"] } }).join(" ")).toMatch(/longer than/);
    expect(validateOutput("brief", { ...OUT.brief, artifacts: [{ id: "a", label: "a", url: "http://x.test", kind: "link" }] }).join(" ")).toMatch(/https/);
    expect(validateOutput("scoring", { ...OUT.scoring, artifacts: [] }).join(" ")).toMatch(/at least 1/);
    expect(validateOutput("scoring", null)).toEqual(["No structured output was returned."]);
  });

  it("repairs only safe shape problems and never fills a missing field", () => {
    const fixed = repairOutput("planning", { schema: "product-plan/1", fields: { effortDays: " 12 ", risks: "Gmail limits", audience: " Agencies " }, artifacts: [] });
    expect(fixed?.fields).toEqual({ effortDays: 12, risks: ["Gmail limits"], audience: "Agencies" });
    expect(validateOutput("planning", fixed)).toEqual([]);
    const stillMissing = repairOutput("planning", { schema: "product-plan/1", fields: { effortDays: "12" }, artifacts: [] });
    expect(validateOutput("planning", stillMissing).join(" ")).toMatch(/Missing "risks"/);
  });
});

describe("invalid output", () => {
  it("records the error, retries once when safe, then holds for review", async () => {
    const e = setup();
    await throughResearch(e);
    const bad = { ...OUT["customer-research"], fields: { personas: ["x"] } };
    const r1 = e.orch.receive(e.report("customer-research", "succeeded", { output: bad }));
    expect(r1.ok && r1.validationErrors?.join(" ")).toMatch(/Missing "pains"/);
    expect(status(e, "customer-research")).toBe("failed");
    expect(e.ledger.get(e.run.id).validationFailures).toHaveLength(1);
    const s = await e.orch.step(e.run.id);
    expect(s.ok && s.summary.retried).toEqual(["customer-research"]);
    expect(e.task("customer-research")!.attempts).toHaveLength(2);
    e.orch.receive(e.report("customer-research", "succeeded", { output: bad }));
    expect(e.task("customer-research")!.error).toMatch(/Needs review/);
    const s2 = await e.orch.step(e.run.id);
    expect(s2.ok && s2.summary.retried).toEqual([]);
    expect(status(e, "customer-research")).toBe("failed");
    expect(e.ledger.get(e.run.id).handoffs["customer-research"]).toBeUndefined();
  });

  it("accepts a deterministically repairable output and says it was repaired", async () => {
    const e = setup();
    await throughResearch(e);
    e.orch.receive(e.report("competitor-analysis", "succeeded", { output: { schema: "competitor-analysis/1", fields: { competitors: " Acme " }, artifacts: [] } }));
    expect(status(e, "competitor-analysis")).toBe("completed");
    expect(e.ledger.get(e.run.id).handoffs["competitor-analysis"]).toMatchObject({ state: "validated", output: { fields: { competitors: ["Acme"] } } });
  });

  it("a person's recorded output is validated too and nothing changes when it fails", () => {
    const e = setup();
    e.orch.authorize(e.run.id, KHANEIL);
    const r = e.orch.recordOutput(e.run.id, "intake", { ...OUT.intake, fields: { goal: "x" } }, KHANEIL);
    expect(r.ok).toBe(false);
    expect(status(e, "intake")).toBe("queued");
  });
});

describe("duplicates and replays", () => {
  it("a repeated report id is applied once", async () => {
    const e = setup();
    await throughResearch(e);
    const rep = e.report("market-research", "succeeded");
    expect(e.orch.receive(rep).ok).toBe(true);
    expect(e.orch.receive(rep)).toMatchObject({ ok: true, duplicate: true });
    expect(e.task("market-research")!.attempts).toHaveLength(1);
  });

  it("overlapping rounds never send the same step twice", async () => {
    const e = setup();
    e.orch.authorize(e.run.id, KHANEIL);
    e.orch.recordOutput(e.run.id, "intake", OUT.intake, KHANEIL);
    await Promise.all([e.orch.step(e.run.id), e.orch.step(e.run.id), e.orch.step(e.run.id)]);
    expect(e.sim.sent).toHaveLength(3);
    expect(new Set(e.sim.sent.map((x) => x.idempotencyKey)).size).toBe(3);
  });

  it("an old attempt's report or a report from the wrong system can't complete a step", async () => {
    const e = setup();
    await throughResearch(e);
    const old = e.report("market-research", "failed", { error: "boom", transient: true });
    e.orch.receive(old);
    e.tick(10 * 60_000);
    await e.orch.step(e.run.id);
    expect(e.orch.receive({ ...old, eventId: "replay", kind: "succeeded", output: OUT["market-research"] }).ok).toBe(false);
    expect(e.orch.receive(e.report("market-research", "succeeded", { source: { kind: "github", id: "x", name: "x" } }))).toMatchObject({ ok: false });
    expect(status(e, "market-research")).toBe("running");
  });
});

describe("persistence and recovery", () => {
  it("state survives a restart from the same storage", async () => {
    const e = setup();
    await throughResearch(e);
    e.orch.receive(e.report("market-research", "succeeded"));
    const again = setup({}, { backends: e.backends, existingRun: e.run });
    expect(again.task("market-research")!.status).toBe("completed");
    expect(again.ledger.get(e.run.id).handoffs["market-research"].state).toBe("validated");
    expect(again.ledger.get(e.run.id).startedBy).toBe("Khaneil");
    expect(again.orch.receive(again.report("customer-research", "succeeded")).ok).toBe(true);
  });

  it("after a crash, an unsent attempt fails safely and a maybe-sent one waits for a person", async () => {
    // Dispatch that never returns stands in for a crash mid-send.
    const hang: ExecutionAdapter = { ...simulatedAdapter(), dispatch: () => new Promise(() => {}) };
    const e = setup({}, { adapter: (id) => (id === "market-research" ? hang : undefined) });
    e.orch.authorize(e.run.id, KHANEIL);
    e.orch.recordOutput(e.run.id, "intake", OUT.intake, KHANEIL);
    void e.orch.step(e.run.id);
    await new Promise((r) => setTimeout(r, 0));
    const restarted = setup({}, { backends: e.backends, existingRun: e.run });
    expect(liveAttempt(restarted.task("customer-research")!)?.state).toBe("running");
    const rec = restarted.orch.recover();
    expect(rec.uncertain).toEqual(["market-research"]);
    expect(restarted.task("market-research")!.attempts[0].state).toBe("unknown");
    expect(restarted.ledger.get(e.run.id).needsReconcile["market-research"]).toMatch(/may or may not/);
    await restarted.orch.step(restarted.run.id);
    expect(restarted.sim.sent.some((x) => x.nodeId === "market-research")).toBe(false);
    expect(restarted.orch.resolveUnknown(e.run.id, "market-research", "did_not_run", AGENT).ok).toBe(false);
    expect(restarted.orch.resolveUnknown(e.run.id, "market-research", "did_not_run", KHANEIL).ok).toBe(true);
    expect(restarted.task("market-research")!.status).toBe("failed");
  });
});

describe("retries and timeouts", () => {
  it("transient failures retry with backoff only when repeating is safe", async () => {
    const e = setup();
    await throughResearch(e);
    e.orch.receive(e.report("market-research", "failed", { error: "HTTP 503", transient: true }));
    const held = await e.orch.step(e.run.id);
    expect(held.ok && held.summary.held.some((h) => h.nodeId === "market-research" && /backoff/.test(h.why))).toBe(true);
    e.tick(backoffMs(1));
    const s = await e.orch.step(e.run.id);
    expect(s.ok && s.summary.retried).toEqual(["market-research"]);
    expect(e.sim.sent.filter((x) => x.nodeId === "market-research").map((x) => x.idempotencyKey)).toEqual([`${e.task("market-research")!.id}:1`, `${e.task("market-research")!.id}:2`]);

    const risky = setup({ sideEffects: true, idempotent: false });
    await throughResearch(risky);
    risky.orch.receive(risky.report("market-research", "failed", { error: "HTTP 503", transient: true }));
    risky.tick(60 * 60_000);
    const r = await risky.orch.step(risky.run.id);
    expect(r.ok && r.summary.retried).toEqual([]);
    expect(risky.task("market-research")!.status).toBe("failed");
  });

  it("a run past its timeout is checked, never assumed failed", async () => {
    const e = setup({ status: { "market-research": { state: "running" }, "customer-research": { state: "unknown" }, "competitor-analysis": { state: "succeeded", output: OUT["competitor-analysis"] } } });
    await throughResearch(e);
    e.tick(7 * 3_600_000);
    const s = await e.orch.step(e.run.id);
    expect(s.ok && s.summary.stale.sort()).toEqual(["competitor-analysis", "customer-research", "market-research"]);
    expect(status(e, "market-research")).toBe("running");
    expect(e.task("customer-research")!.attempts[0].state).toBe("unknown");
    expect(status(e, "customer-research")).toBe("running");
    expect(e.ledger.get(e.run.id).needsReconcile["customer-research"]).toBeDefined();
    expect(status(e, "competitor-analysis")).toBe("completed");
  });

  it("backoff doubles and is capped", () => {
    expect([1, 2, 3, 10].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 30 * 60_000]);
  });
});

describe("approvals", () => {
  async function toScopeApproval(e: Env) {
    await finishResearch(e);
    e.orch.receive(e.report("scoring", "succeeded"));
    await e.orch.step(e.run.id);
    expect(e.orch.decide(e.run.id, "viability", "yes", AGENT).ok).toBe(false);
    expect(e.orch.decide(e.run.id, "viability", "yes", KHANEIL).ok).toBe(true);
    await e.orch.step(e.run.id);
    e.orch.receive(e.report("brief", "succeeded"));
    await e.orch.step(e.run.id);
    e.orch.receive(e.report("planning", "succeeded"));
    await e.orch.step(e.run.id);
  }

  it("Atlas asks; only a person grants; the approval step completes only after a grant", async () => {
    const e = setup();
    await toScopeApproval(e);
    expect(status(e, "approve-scope")).toBe("awaiting_approval");
    expect(liveStatus(e.run.snapshot, e.run, byId(e.svc.repo.list())).get("parked")).toBe("skipped");
    const t = e.task("approve-scope")!;
    expect(e.svc.apply(t.id, (x, _a, at) => decideApproval(x, "granted", AGENT, at)).ok).toBe(false);
    expect(approvalRefusal({ agentId: "benjaire-product-lab", createdBy: KHANEIL }, { kind: "person", id: "benjaire-product-lab", name: "x" })).toMatch(/own task/);
    expect(e.orch.recordOutput(e.run.id, "develop", OUT.develop, KHANEIL).ok).toBe(false);
    e.svc.apply(t.id, (x, _a, at) => decideApproval(x, "granted", KHANEIL, at));
    const s = await e.orch.step(e.run.id);
    expect(s.ok && s.summary.approvalsCompleted).toEqual(["approve-scope"]);
    expect(s.ok && s.summary.unconfigured.map((u) => u.nodeId)).toContain("develop");
  });

  it("a forged or replayed report can't run a sensitive step; publish only goes through a person after approval", async () => {
    const e = setup();
    await toScopeApproval(e);
    e.svc.apply(e.task("approve-scope")!.id, (x, _a, at) => decideApproval(x, "granted", KHANEIL, at));
    await e.orch.step(e.run.id);
    e.orch.recordOutput(e.run.id, "develop", OUT.develop, KHANEIL);
    e.orch.recordOutput(e.run.id, "quality", OUT.quality, KHANEIL);
    await e.orch.step(e.run.id);
    expect(status(e, "approve-launch")).toBe("awaiting_approval");
    expect(e.orch.receive({ eventId: "forged", runId: e.run.id, nodeId: "publish", attemptId: "run_x", kind: "succeeded", source: N8N, output: OUT.publish, at: "2026-11-15T12:00:00Z" }).ok).toBe(false);
    expect(e.orch.recordOutput(e.run.id, "publish", OUT.publish, KHANEIL).ok).toBe(false);
    e.svc.apply(e.task("approve-launch")!.id, (x, _a, at) => decideApproval(x, "granted", KHANEIL, at));
    await e.orch.step(e.run.id);
    // Publish needs its own approval, per run.
    expect(status(e, "publish")).toBe("awaiting_approval");
    e.svc.apply(e.task("publish")!.id, (x, _a, at) => decideApproval(x, "granted", KHANEIL, at));
    const s = await e.orch.step(e.run.id);
    expect(s.ok && s.summary.unconfigured.find((u) => u.nodeId === "publish")?.need).toMatch(/read-only/);
    expect(e.sim.sent.some((x) => x.nodeId === "publish")).toBe(false);
    expect(e.orch.recordOutput(e.run.id, "publish", OUT.publish, AGENT).ok).toBe(false);
    expect(e.orch.recordOutput(e.run.id, "publish", OUT.publish, KHANEIL).ok).toBe(true);
  });
});

describe("blocked workflow recovery", () => {
  it("unconfigured research blocks the run until it is waived or recorded by hand", async () => {
    const e = setup({ unavailable: { "market-research": "n8n webhook not set up", "customer-research": "n8n webhook not set up", "competitor-analysis": "n8n webhook not set up" } });
    await throughResearch(e);
    const s = await e.orch.step(e.run.id);
    expect(s.ok && s.summary.unconfigured.length).toBe(3);
    const stuck = new Map((s.ok ? s.summary.unconfigured : []).map((u) => [u.nodeId, "unconfigured" as const]));
    expect(runStatus(e.run, byId(e.svc.repo.list()), e.ledger.get(e.run.id))).toBe("running");
    expect(runStatus(e.run, byId(e.svc.repo.list()), e.ledger.get(e.run.id), stuck)).toBe("blocked");
    expect(e.orch.waive(e.run.id, "competitor-analysis", "", KHANEIL).ok).toBe(false);
    expect(e.orch.waive(e.run.id, "competitor-analysis", "Known market", AGENT).ok).toBe(false);
    expect(e.orch.waive(e.run.id, "competitor-analysis", "Known market", KHANEIL).ok).toBe(true);
    expect(e.orch.waive(e.run.id, "approve-scope", "x", KHANEIL).ok).toBe(false);
    e.orch.recordOutput(e.run.id, "market-research", OUT["market-research"], KHANEIL);
    e.orch.recordOutput(e.run.id, "customer-research", OUT["customer-research"], KHANEIL);
    await e.orch.step(e.run.id);
    const env = e.sim.sent.find((x) => x.nodeId === "scoring")!;
    expect(env.inputs["competitor-analysis"]).toMatchObject({ waived: true, fields: {} });
  });
});

describe("Workflow Intelligence sync", () => {
  it("node statuses, timings and building activity come from the same tasks", async () => {
    const e = setup();
    await throughResearch(e);
    const tasks = byId(e.svc.repo.list());
    const st = liveStatus(e.run.snapshot, e.run, tasks);
    expect(st.get("intake")).toBe("completed");
    expect(st.get("market-research")).toBe("running");
    expect(st.get("scoring")).toBe("blocked");
    e.tick(90_000);
    e.orch.receive(e.report("market-research", "succeeded"));
    const timing = stepTiming(e.task("market-research"));
    expect(timing.durationMs).toBe(90_000);
    const act = buildingActivity(e.run.snapshot, resolveAll(e.run.snapshot, catalog), liveStatus(e.run.snapshot, e.run, byId(e.svc.repo.list())));
    expect(act.reduce((n, b) => n + b.active, 0)).toBeGreaterThanOrEqual(2);
    expect(act.reduce((n, b) => n + b.done, 0)).toBeGreaterThanOrEqual(2);
  });
});

describe("goal completion", () => {
  it("a finished workflow is not a business success until an outcome is recorded with evidence", async () => {
    const e = setup();
    await finishResearch(e);
    e.orch.receive(e.report("scoring", "succeeded", { usage: { model: "claude-haiku", provider: "anthropic", inputTokens: 1200, outputTokens: 300, cost: { usd: 0.01, basis: "estimated" } } }));
    await e.orch.step(e.run.id);
    e.orch.decide(e.run.id, "viability", "yes", KHANEIL);
    for (const id of ["brief", "planning"]) {
      await e.orch.step(e.run.id);
      e.orch.receive(e.report(id, "succeeded"));
    }
    for (const gate of ["approve-scope", "approve-launch", "publish"]) {
      await e.orch.step(e.run.id);
      if (gate === "approve-launch") {
        e.orch.recordOutput(e.run.id, "develop", OUT.develop, KHANEIL);
        e.orch.recordOutput(e.run.id, "quality", OUT.quality, KHANEIL);
        await e.orch.step(e.run.id);
      }
      e.svc.apply(e.task(gate)!.id, (x, _a, at) => decideApproval(x, "granted", KHANEIL, at));
      await e.orch.step(e.run.id);
    }
    e.orch.recordOutput(e.run.id, "publish", OUT.publish, KHANEIL);
    await e.orch.step(e.run.id);
    e.orch.recordOutput(e.run.id, "monitor", OUT.monitor, KHANEIL);
    e.tick(60_000);
    const tasks = byId(e.svc.repo.list());
    const rep = goalReport(e.run, tasks, e.ledger.get(e.run.id));
    expect(rep.status).toBe("completed");
    expect(rep.steps.skipped).toBe(1);
    expect(rep.outcome).toBe("not_recorded");
    expect(rep.approvalsGranted).toBe(3);
    expect(rep.usage).toMatchObject({ inputTokens: 1200, outputTokens: 300, estimatedUsd: 0.01, billedUsd: 0 });
    expect(rep.artifacts.length).toBeGreaterThan(0);
    expect(e.orch.recordOutcome(e.run.id, { state: "achieved", note: "Sold", metrics: [] }, KHANEIL).ok).toBe(false);
    expect(e.orch.recordOutcome(e.run.id, { state: "too_early", note: "Listed a day ago", metrics: [] }, AGENT).ok).toBe(false);
    expect(e.orch.recordOutcome(e.run.id, { state: "too_early", note: "Listed a day ago", metrics: [] }, { kind: "agent", id: "benjaire-ops-monitor", name: "Business Operations Monitor" }).ok).toBe(true);
    expect(e.orch.recordOutcome(e.run.id, { state: "achieved", note: "First sales", metrics: [{ name: "orders", value: 3, source: "Stripe" }] }, KHANEIL).ok).toBe(true);
    expect(goalReport(e.run, tasks, e.ledger.get(e.run.id)).outcome).toBe("achieved");
  });

  it("parking the idea completes the workflow on the other branch", async () => {
    const e = setup();
    await finishResearch(e);
    e.orch.receive(e.report("scoring", "succeeded"));
    await e.orch.step(e.run.id);
    e.orch.decide(e.run.id, "viability", "no", KHANEIL, "Weak demand");
    expect(status(e, "brief")).toBe("cancelled");
    expect(status(e, "publish")).toBe("cancelled");
    await e.orch.step(e.run.id);
    expect(runStatus(e.run, byId(e.svc.repo.list()), e.ledger.get(e.run.id))).toBe("completed");
  });

  it("cancelling a run cancels open steps and stops further dispatch", async () => {
    const e = setup();
    await throughResearch(e);
    expect(e.orch.cancelRun(e.run.id, AGENT).ok).toBe(false);
    expect(e.orch.cancelRun(e.run.id, KHANEIL).ok).toBe(true);
    expect(e.task("market-research")!.cancelRequestedAt).toBeDefined();
    expect(status(e, "scoring")).toBe("cancelled");
    expect(runStatus(e.run, byId(e.svc.repo.list()), e.ledger.get(e.run.id))).toBe("cancelled");
  });
});

describe("external integration failures", () => {
  it("a refused send fails safely; an unclear or thrown send is never re-sent automatically", async () => {
    const thrower: ExecutionAdapter = { ...simulatedAdapter(), dispatch: async () => Promise.reject(new Error("socket hang up")) };
    const e = setup({ dispatch: { "market-research": "refused" } }, { adapter: (id) => (id === "customer-research" ? thrower : undefined) });
    await throughResearch(e);
    expect(status(e, "market-research")).toBe("failed");
    expect(e.task("market-research")!.error).toMatch(/Not sent/);
    expect(e.task("customer-research")!.attempts[0].state).toBe("unknown");
    expect(e.ledger.get(e.run.id).needsReconcile["customer-research"]).toBeDefined();
    await e.orch.step(e.run.id);
    await e.orch.step(e.run.id);
    expect(e.task("customer-research")!.attempts).toHaveLength(1);
  });

  it("the real n8n adapter refuses and explains what's missing; GitHub needs the Mac app", async () => {
    expect(n8nAdapter.available("market-research", undefined)).toMatchObject({ ok: false });
    expect((await n8nAdapter.dispatch({} as never)).state).toBe("refused");
    const route = adapterRouter(manualAdapter);
    expect(route({ id: "market-research", execution: { kind: "n8n" } })).toBe(n8nAdapter);
    expect(route({ id: "develop", execution: { kind: "none" } })).toBe(manualAdapter);
    expect(githubStatus({ id: "a", requestedAt: "2026-11-15T12:00:00Z", idempotencyKey: "k" }, [], new Set())).toEqual({ state: "not_found" });
  });

  it("model budget caps hold a step; deterministic steps use no model", () => {
    const scoring = BENJAIRE_LAUNCH.nodes.find((n) => n.id === "scoring")!;
    const approval = BENJAIRE_LAUNCH.nodes.find((n) => n.id === "approve-scope")!;
    expect(stepPolicy(approval).tier).toBe("none");
    expect(stepPolicy(scoring).tier).toBe("advanced");
    expect(budgetProblem({ usage: [{ model: "m", provider: "p", recordedAt: "", cost: { usd: 3.5, basis: "billed" } }] }, stepPolicy(scoring))).toMatch(/budget/);
    expect(budgetProblem({ usage: [] }, stepPolicy(scoring))).toBeNull();
  });

  it("a step after a decision gets what the decision was about, not just yes or no", () => {
    const h = (id: string, output: StepOutput) => ({ nodeId: id, taskId: "x", attempt: 1, at: "", state: "validated" as const, by: "k", output });
    const env = buildEnvelope(BENJAIRE_LAUNCH, { id: "r", nodeTasks: { brief: "t" } }, "brief", { number: 1, idempotencyKey: "t:1" }, { scoring: h("scoring", OUT.scoring), viability: h("viability", output("decision/1", { branch: "yes" })), intake: h("intake", OUT.intake) }, "2026-11-15T12:00:00Z");
    expect(Object.keys(env.inputs).sort()).toEqual(["scoring", "viability"]);
    expect(env.inputs.scoring.fields.topIdea).toBe("Inbox triage");
    expect(env.sourceAgentIds).toContain("benjaire-product-lab-scoring");
  });

  it("an envelope never carries data from steps that aren't upstream", () => {
    const env = buildEnvelope(BENJAIRE_LAUNCH, { id: "r", nodeTasks: { brief: "t" } }, "brief", { number: 1, idempotencyKey: "t:1" }, { intake: { nodeId: "intake", taskId: "x", attempt: 1, at: "", state: "validated", by: "k", output: OUT.intake } }, "2026-11-15T12:00:00Z");
    expect(env.inputs).toEqual({});
  });
});

describe("n8n bridge", () => {
  function fakeBridge() {
    const sent: HandoffEnvelope[] = [];
    const stored: StepReportBody[] = [];
    const client: BridgeClient = {
      status: async () => true,
      send: async (env) => (sent.push(env), { state: "accepted" }),
      reports: async (since) => ({ reports: stored.slice(since), cursor: stored.length }),
    };
    return { client, sent, stored };
  }

  it("routes only allow-listed steps to the bridge; publish stays read-only", () => {
    const b = bridgeAdapter(fakeBridge().client, () => true);
    const route = adapterRouter(manualAdapter, b);
    expect(route({ id: "scoring", execution: { kind: "n8n" } })).toBe(b);
    expect(route({ id: "publish", execution: { kind: "n8n" } })).toBe(n8nAdapter);
    expect(b.available("publish", undefined).ok).toBe(false);
    expect(bridgeAdapter(fakeBridge().client, () => false).available("scoring", undefined).need).toMatch(/N8N_BRIDGE_TOKEN/);
  });

  it("sends research through the bridge and completes steps from picked-up reports", async () => {
    const fb = fakeBridge();
    const b = bridgeAdapter(fb.client, () => true);
    const e = setup({}, { adapter: (id) => (id === "publish" ? n8nAdapter : ["market-research", "customer-research", "competitor-analysis", "scoring", "brief", "planning"].includes(id) ? b : undefined) });
    await throughResearch(e);
    expect(fb.sent.map((x) => x.nodeId).sort()).toEqual(["competitor-analysis", "customer-research", "market-research"]);
    expect(fb.sent.every((x) => !!x.attemptId)).toBe(true);
    let n = 0;
    for (const env of fb.sent) fb.stored.push({ eventId: `e${++n}`, idempotencyKey: env.idempotencyKey, runId: env.runId, nodeId: env.nodeId as never, attemptId: env.attemptId!, kind: "succeeded", at: "2026-11-15T12:05:00Z", output: OUT[env.nodeId] });
    let cur = 0;
    const cursor = { read: () => cur, write: (x: number) => void (cur = x) };
    expect(await pullReports(e.orch, fb.client, cursor)).toBe(3);
    expect(await pullReports(e.orch, fb.client, cursor)).toBe(0);
    expect(status(e, "market-research")).toBe("completed");
    await e.orch.step(e.run.id);
    expect(fb.sent.some((x) => x.nodeId === "scoring")).toBe(true);
  });
});
