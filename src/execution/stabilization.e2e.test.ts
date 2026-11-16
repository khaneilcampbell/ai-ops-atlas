import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { buildStepContext, recordRunIntelligence } from "../intelligence/benjaire";
import { agentAccess, IntelligenceStore, readProblem } from "../intelligence/memory";
import { decideApproval, liveAttempt } from "../tasks/lifecycle";
import { agentProblem } from "../tasks/registry";
import { byId, LocalTaskRepository, memoryBackend, TaskService, type Backend } from "../tasks/store";
import { KHANEIL, type Actor } from "../tasks/types";
import { BENJAIRE_LAUNCH, BENJAIRE_LAUNCH_GOAL } from "../workflows/benjaireLaunch";
import { buildingActivity, liveEvents, liveStatus, resolveAll } from "../workflows/engine";
import { RunStore, startLiveRun } from "../workflows/runs";
import { manualAdapter, n8nAdapter, output, simulatedAdapter } from "./adapters";
import { LedgerStore } from "./ledger";
import { Orchestrator } from "./orchestrator";
import { goalReport } from "./report";
import type { ExecutionReport, StepOutput } from "./types";

// Stabilization sprint, end to end: the Benjaire product research and launch workflow from goal to
// summary, on the real Task Center, run store, execution ledger, orchestrator and agent memory,
// with a stand-in for n8n (nothing outside is called, nothing is published, sold or emailed). It
// checks that every subsystem tells the same story at each step, and that quitting the app in the
// middle loses nothing and sends nothing twice.

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
const RESEARCH = ["market-research", "customer-research", "competitor-analysis"];

/** The whole app's stores on shared backends, so "restart" rebuilds them from what was saved. */
function boot(backends: { tasks: Backend; runs: Backend; ledger: Backend; intel: Backend }, clock: { t: number }, sim: ReturnType<typeof simulatedAdapter>) {
  const now = () => new Date(clock.t).toISOString();
  const svc = new TaskService(new LocalTaskRepository(backends.tasks), now);
  const runs = new RunStore(backends.runs);
  const ledger = new LedgerStore(backends.ledger);
  const intel = new IntelligenceStore(backends.intel, catalog, now);
  const orch = new Orchestrator({
    tasks: svc,
    runs,
    ledger,
    catalog,
    now,
    // Same wiring as src/execution/app.ts: n8n steps to the bridge (here a stand-in), publish to the
    // real read-only n8n adapter (it refuses), everything else by hand.
    adapterFor: (n) => (n.id === "publish" ? n8nAdapter : n.execution.kind === "n8n" ? sim : manualAdapter),
    context: (run, nodeId, task, attempt) => buildStepContext(intel, run, nodeId, task, attempt),
  });
  return { svc, runs, ledger, intel, orch };
}

describe("stabilization: Benjaire research workflow end to end", () => {
  it("goal to summary with one restart: every subsystem agrees, nothing runs twice, nothing skips a gate", async () => {
    const clock = { t: Date.parse("2026-11-16T12:00:00Z") };
    const backends = { tasks: memoryBackend(), runs: memoryBackend(), ledger: memoryBackend(), intel: memoryBackend() };
    const sim = simulatedAdapter();
    let app = boot(backends, clock, sim);
    let n = 0;

    // A memory record for another building, worded to match the research query. It must never
    // reach this workflow's agents.
    const other = app.intel.write(
      { category: "operational", scope: { project: "portfolio-site" }, title: "Market research on portfolio visitors", content: "Portfolio market research notes: ideas, demand signals.", tags: ["research", "market"], source: { kind: "manual", ref: "e2e" } },
      KHANEIL,
    );
    expect(other.ok).toBe(true);
    const foreignId = other.ok ? other.record.id : "";

    // 1. Goal creation. Only a person may start it; the goal travels with the run.
    expect(startLiveRun(BENJAIRE_LAUNCH_GOAL, BENJAIRE_LAUNCH, app.svc, app.runs, catalog, AGENT).error).toMatch(/only a person/);
    const started = startLiveRun(BENJAIRE_LAUNCH_GOAL, BENJAIRE_LAUNCH, app.svc, app.runs, catalog, KHANEIL, new Date(clock.t).toISOString());
    const run = started.run!;
    const task = (id: string) => app.svc.repo.get(run.nodeTasks[id])!;
    const tasks = () => byId(app.svc.repo.list());
    const report = (nodeId: string, kind: ExecutionReport["kind"]): ExecutionReport => ({ eventId: `e2e-${nodeId}-${kind}-${++n}`, runId: run.id, nodeId, attemptId: liveAttempt(task(nodeId))?.id ?? "none", kind, source: N8N, at: new Date(clock.t).toISOString(), ...(kind === "succeeded" ? { output: OUT[nodeId] } : {}) });

    // 2. Workflow initialisation: one task per step, unique ids, nothing started, nothing sent.
    const taskIds = Object.values(run.nodeTasks);
    expect(new Set(taskIds).size).toBe(taskIds.length);
    // Outcome markers ("parked", "done") are states, not work, so they have no task.
    expect(taskIds.length).toBe(BENJAIRE_LAUNCH.nodes.filter((x) => x.kind !== "outcome").length);
    expect(started.error).toBeNull();
    expect(taskIds.every((id) => app.svc.repo.get(id)!.attempts.length === 0)).toBe(true);

    // 3. Agent assignment: each step's task has the registry's agent and that agent's building, and
    // every agent resolves to a live catalog entry.
    const resolved = resolveAll(run.snapshot, catalog);
    for (const node of run.snapshot.nodes) {
      const r = resolved.get(node.id)!;
      if (!node.agentId) continue;
      expect(r.agent, `${node.id} agent ${node.agentId}`).toBeDefined();
      expect(agentProblem(r.agent)).toBeNull();
      expect(task(node.id).agentId).toBe(node.agentId);
      expect(r.buildingId).toBe(r.agent!.projectId);
    }

    // Nothing moves until a person authorises the run.
    expect(app.orch.authorize(run.id, AGENT).ok).toBe(false);
    expect((await app.orch.step(run.id)).ok).toBe(false);
    expect(app.orch.authorize(run.id, KHANEIL).ok).toBe(true);
    await app.orch.step(run.id);
    expect(sim.sent).toHaveLength(0);
    expect(app.orch.recordOutput(run.id, "intake", OUT.intake, KHANEIL).ok).toBe(true);

    // 4. Parallel research: three steps in one round, each with scoped context from memory.
    const s1 = await app.orch.step(run.id);
    expect(s1.ok && [...s1.summary.dispatched].sort()).toEqual([...RESEARCH].sort());
    expect(liveStatus(run.snapshot, run, tasks()).get("scoring")).toBe("blocked");
    for (const env of sim.sent) {
      expect(env.inputs.intake).toMatchObject({ fields: { goal: "Launch a Benjaire AI product" } });
      expect(env.context?.items.some((i) => i.id === foreignId)).toBe(false);
    }
    const contexts = app.intel.snapshot().contexts;
    expect(contexts.map((c) => c.nodeId).sort()).toEqual([...RESEARCH].sort());
    for (const c of contexts) {
      const acc = agentAccess(catalog, c.agentId);
      for (const item of c.items) {
        const rec = app.intel.memory().find((m) => m.id === item.id)!;
        expect(readProblem(rec, acc, clock.t), `${c.agentId} read ${item.id}`).toBeNull();
      }
    }

    // Two research reports arrive, then the app quits with the third still out with n8n.
    clock.t += 60_000;
    expect(app.orch.receive(report("market-research", "succeeded")).ok).toBe(true);
    expect(app.orch.receive(report("customer-research", "succeeded")).ok).toBe(true);
    const outstanding = liveAttempt(task("competitor-analysis"))!;

    // Restart: every store is rebuilt from what was saved. Nothing is lost or re-sent.
    app = boot(backends, clock, sim);
    const rec = app.orch.recover();
    expect(rec).toEqual({ notSent: [], uncertain: [] });
    await app.orch.step(run.id);
    expect(sim.sent.filter((e) => e.nodeId === "competitor-analysis")).toHaveLength(1);
    expect(liveAttempt(task("competitor-analysis"))!.id).toBe(outstanding.id);
    // Its report, delivered twice after the restart, completes it once.
    const late = report("competitor-analysis", "succeeded");
    expect(app.orch.receive(late).ok).toBe(true);
    expect(app.orch.receive(late)).toMatchObject({ ok: true, duplicate: true });

    // 5. Structured handoff: scoring receives exactly the three validated research outputs it depends on.
    await app.orch.step(run.id);
    const scoringEnv = sim.sent.find((e) => e.nodeId === "scoring")!;
    expect(Object.keys(scoringEnv.inputs).sort()).toEqual([...RESEARCH].sort());
    expect(scoringEnv.inputs["market-research"]).toMatchObject({ fields: { ideas: ["Inbox triage", "Invoice chase"] } });

    // 6. Opportunity evaluation, then Khaneil's decision. Only a person decides.
    expect(app.orch.receive(report("scoring", "succeeded")).ok).toBe(true);
    await app.orch.step(run.id);
    expect(app.orch.decide(run.id, "viability", "yes", AGENT).ok).toBe(false);
    expect(app.orch.decide(run.id, "viability", "yes", KHANEIL).ok).toBe(true);
    for (const id of ["brief", "planning"]) {
      await app.orch.step(run.id);
      expect(app.orch.receive(report(id, "succeeded")).ok).toBe(true);
    }
    // The brief knew which idea "yes" was about.
    expect(sim.sent.find((e) => e.nodeId === "brief")!.inputs.viability).toMatchObject({ fields: { branch: "yes" } });

    // 7. Human approval gate: Atlas asks, no agent or workflow can grant, nothing past it runs.
    await app.orch.step(run.id);
    expect(task("approve-scope").status).toBe("awaiting_approval");
    expect(app.svc.apply(task("approve-scope").id, (x, _a, at) => decideApproval(x, "granted", AGENT, at)).ok).toBe(false);
    expect(app.svc.apply(task("approve-scope").id, (x, _a, at) => decideApproval(x, "granted", N8N, at)).ok).toBe(false);
    expect(app.orch.recordOutput(run.id, "develop", OUT.develop, KHANEIL).ok).toBe(false);

    // 8. Authorised execution after each gate. Publish has its own approval and never goes to n8n.
    for (const gate of ["approve-scope", "approve-launch", "publish"]) {
      await app.orch.step(run.id);
      if (gate === "approve-launch") {
        expect(app.orch.recordOutput(run.id, "develop", OUT.develop, KHANEIL).ok).toBe(true);
        expect(app.orch.recordOutput(run.id, "quality", OUT.quality, KHANEIL).ok).toBe(true);
        await app.orch.step(run.id);
      }
      expect(task(gate).status).toBe("awaiting_approval");
      if (gate === "publish") expect(app.orch.recordOutput(run.id, "publish", OUT.publish, KHANEIL).ok).toBe(false);
      expect(app.svc.apply(task(gate).id, (x, _a, at) => decideApproval(x, "granted", KHANEIL, at)).ok).toBe(true);
      await app.orch.step(run.id);
    }
    expect(sim.sent.some((e) => e.nodeId === "publish")).toBe(false);
    expect(app.orch.recordOutput(run.id, "publish", OUT.publish, AGENT).ok).toBe(false);
    expect(app.orch.recordOutput(run.id, "publish", OUT.publish, KHANEIL).ok).toBe(true);
    await app.orch.step(run.id);
    expect(app.orch.recordOutput(run.id, "monitor", OUT.monitor, KHANEIL).ok).toBe(true);

    // 9. Evaluation recording: one evaluation per finished agent step, research findings kept as
    // unverified working memory, and a second pass adds nothing.
    const ledger = app.ledger.get(run.id);
    const first = recordRunIntelligence(app.intel, run, ledger, tasks());
    expect(first.findings).toBe(4);
    expect(first.evaluations).toBeGreaterThanOrEqual(6);
    expect(recordRunIntelligence(app.intel, run, ledger, tasks())).toEqual({ findings: 0, evaluations: 0 });
    const findings = app.intel.snapshot().memory.filter((m) => m.source.kind === "handoff");
    expect(findings.every((m) => m.verification === "unverified" && m.scope.project === "benjaire-site")).toBe(true);

    // 10. Goal completion summary: done as a workflow, not a business success until measured.
    const rep = goalReport(run, tasks(), app.ledger.get(run.id));
    expect(rep.status).toBe("completed");
    expect(rep.approvalsGranted).toBe(3);
    expect(rep.steps.skipped).toBe(1);
    expect(rep.outcome).toBe("not_recorded");
    expect(app.orch.recordOutcome(run.id, { state: "achieved", note: "Sold", metrics: [] }, KHANEIL).ok).toBe(false);
    expect(app.orch.recordOutcome(run.id, { state: "too_early", note: "Listed today", metrics: [] }, KHANEIL).ok).toBe(true);
    expect(goalReport(run, tasks(), app.ledger.get(run.id)).outcome).toBe("too_early");

    // The same story everywhere: Workflow Intelligence status = Task Center status for every step,
    // the timeline holds only real events, buildings show finished work, and each n8n step went
    // out exactly once with each attempt key unique.
    const st = liveStatus(run.snapshot, run, tasks());
    for (const node of run.snapshot.nodes) {
      if (node.kind === "outcome") continue;
      const t = task(node.id);
      const expected = t.status === "cancelled" ? "skipped" : t.status;
      expect(st.get(node.id), node.id).toBe(expected);
    }
    expect(liveEvents(run, tasks()).every((e) => !e.simulated)).toBe(true);
    const act = buildingActivity(run.snapshot, resolved, st);
    expect(act.reduce((s, b) => s + b.active, 0)).toBe(0);
    expect(act.reduce((s, b) => s + b.done, 0)).toBeGreaterThan(0);
    const perNode = new Map<string, number>();
    for (const e of sim.sent) perNode.set(e.nodeId, (perNode.get(e.nodeId) ?? 0) + 1);
    expect([...perNode.values()].every((c) => c === 1)).toBe(true);
    expect(new Set(sim.sent.map((e) => e.idempotencyKey)).size).toBe(sim.sent.length);
    expect(sim.sent.length).toBe(6);
  });
});
