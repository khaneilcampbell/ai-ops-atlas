import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { OFF_MAP_PROJECTS } from "../catalog/projects";
import { decideApproval, requestApproval, transition } from "../tasks/lifecycle";
import { byId, LocalTaskRepository, memoryBackend, TaskService } from "../tasks/store";
import { KHANEIL } from "../tasks/types";
import { BENJAIRE_LAUNCH, BENJAIRE_LAUNCH_GOAL } from "./benjaireLaunch";
import { buildingActivity, liveEvents, liveStatus, resolveAll, resolveNode, simulate, skippedBy } from "./engine";
import { definitionProblems, layout, levels, topoOrder } from "./graph";
import { RunStore, startLiveRun } from "./runs";

const def = BENJAIRE_LAUNCH;
const name = (id: string) => def.nodes.find((n) => n.id === id)!.title;
let clock = Date.parse("2026-11-15T12:00:00Z");
const now = () => new Date((clock += 1000)).toISOString();

describe("Benjaire launch template", () => {
  it("is a valid acyclic workflow", () => {
    expect(definitionProblems(def)).toEqual([]);
    expect(topoOrder(def)?.[0]).toBe("intake");
  });

  it("names only real registry agents, active, under the expected titles", () => {
    const titles: Record<string, string> = {
      intake: "Agent Operations Lead",
      "market-research": "Market Research Analyst",
      "customer-research": "Customer Insight Researcher",
      "competitor-analysis": "Competitor Analyst",
      scoring: "Product Scoring Analyst",
      brief: "Product Brief Writer",
      planning: "Product Lab Lead",
      monitor: "Business Operations Monitor",
    };
    for (const [id, title] of Object.entries(titles)) {
      const r = resolveNode(def.nodes.find((n) => n.id === id)!, catalog);
      expect(r.agent, id).toBeDefined();
      expect(r.agentName).toBe(title);
      expect(r.problem).toBeNull();
    }
  });

  it("puts every step in a real building on the map", () => {
    for (const r of resolveAll(def, catalog).values()) {
      expect(catalog.projects.some((p) => p.id === r.buildingId), r.node.id).toBe(true);
      expect(OFF_MAP_PROJECTS.has(r.buildingId)).toBe(false);
    }
  });

  it("runs the three research steps in parallel and gates development and launch on approvals", () => {
    const lv = levels(def);
    expect(new Set(["market-research", "customer-research", "competitor-analysis"].map((id) => lv.get(id)))).toEqual(new Set([1]));
    expect(def.edges.filter((e) => e.to === "scoring").map((e) => e.from).sort()).toEqual(["competitor-analysis", "customer-research", "market-research"]);
    expect(def.edges.find((e) => e.to === "develop")?.from).toBe("approve-scope");
    expect(def.edges.find((e) => e.to === "publish")?.from).toBe("approve-launch");
    expect(def.nodes.find((n) => n.id === "approve-launch")?.approval?.categories).toEqual(expect.arrayContaining(["production_deploy", "financial", "customer_message"]));
  });

  it("marks development and quality checks unconfigured instead of inventing an owner", () => {
    for (const id of ["develop", "quality"]) {
      const n = def.nodes.find((x) => x.id === id)!;
      expect(n.unconfigured).toBeTruthy();
      expect(n.agentId).toBeUndefined();
      expect(n.execution.kind).toBe("none");
    }
  });

  it("lays out nodes without overlap", () => {
    const l = layout(def);
    for (const a of l.nodes) for (const b of l.nodes) if (a !== b && a.x === b.x) expect(Math.abs(a.y - b.y)).toBeGreaterThan(60);
    expect(l.edges).toHaveLength(def.edges.length);
  });
});

describe("simulation", () => {
  const opts = { branches: {}, manualStandIn: false };

  it("starts with nothing running and identifies every event as simulated", () => {
    const s0 = simulate(def, opts, 0, name);
    expect([...s0.status.values()].filter((v) => v === "running")).toHaveLength(0);
    const s3 = simulate(def, opts, 3, name);
    expect(s3.events.length).toBeGreaterThan(0);
    expect(s3.events.every((e) => e.simulated)).toBe(true);
  });

  it("runs the research branches together after intake", () => {
    const s2 = simulate(def, opts, 2, name);
    expect(s2.status.get("intake")).toBe("completed");
    for (const id of ["market-research", "customer-research", "competitor-analysis"]) expect(s2.status.get(id)).toBe("running");
  });

  it("stops at the unconfigured development step and never marks it done", () => {
    const end = simulate(def, opts, 99, name);
    expect(end.haltedAt).toBe("develop");
    expect(end.status.get("develop")).toBe("unconfigured");
    expect(end.status.get("publish")).toBe("not_started");
    expect(end.status.get("approve-scope")).toBe("completed");
  });

  it("can stand in for unconfigured steps but still shows them unconfigured", () => {
    const end = simulate(def, { branches: {}, manualStandIn: true }, 99, name);
    expect(end.haltedAt).toBeNull();
    expect(end.status.get("develop")).toBe("unconfigured");
    expect(end.status.get("launched")).toBe("completed");
  });

  it("follows the not-viable branch and skips everything after it", () => {
    const end = simulate(def, { branches: { viability: "no" }, manualStandIn: false }, 99, name);
    expect(end.status.get("parked")).toBe("completed");
    expect(end.status.get("brief")).toBe("skipped");
    expect(skippedBy(def, { viability: "no" }).has("publish")).toBe(true);
  });

  it("waits at approval nodes for Khaneil", () => {
    const { maxStep } = simulate(def, opts, 0, name);
    const at = Array.from({ length: maxStep + 1 }, (_, i) => simulate(def, opts, i, name)).find((s) => s.status.get("approve-scope") === "awaiting_approval");
    expect(at).toBeDefined();
    expect(at!.status.get("develop")).not.toBe("completed");
  });
});

describe("live runs over the Task Center", () => {
  const setup = () => {
    const svc = new TaskService(new LocalTaskRepository(memoryBackend()), now);
    const store = new RunStore(memoryBackend());
    const { run, error } = startLiveRun(BENJAIRE_LAUNCH_GOAL, def, svc, store, catalog, KHANEIL, now());
    expect(error).toBeNull();
    return { svc, store, run: run! };
  };

  it("creates one task per step with registry owners, dependencies and approval rules", () => {
    const { svc, store, run } = setup();
    const tasks = byId(svc.repo.list());
    expect(Object.keys(run.nodeTasks)).toHaveLength(def.nodes.filter((n) => n.kind !== "outcome").length);
    const scoring = tasks.get(run.nodeTasks.scoring)!;
    expect(scoring.agentId).toBe("benjaire-product-lab-scoring");
    expect(scoring.dependencyIds.sort()).toEqual(["market-research", "customer-research", "competitor-analysis"].map((id) => run.nodeTasks[id]).sort());
    expect(scoring.status).toBe("blocked");
    const launch = tasks.get(run.nodeTasks["approve-launch"])!;
    expect(launch.requiresApproval).toBe(true);
    expect(launch.categories).toContain("production_deploy");
    expect(tasks.get(run.nodeTasks.develop)!.agentId).toBeUndefined();
    expect(store.list()).toHaveLength(1);
    expect(run.snapshot).not.toBe(def);
    expect(run.definitionVersion).toBe(def.version);
  });

  it("shows only what the Task Center records: queued and blocked tasks, no invented progress", () => {
    const { svc, run } = setup();
    const st = liveStatus(run.snapshot, run, byId(svc.repo.list()));
    expect(st.get("intake")).toBe("queued");
    expect(st.get("market-research")).toBe("blocked");
    expect(st.get("launched")).toBe("not_started");
    expect([...st.values()]).not.toContain("completed");
    const ev = liveEvents(run, byId(svc.repo.list()));
    expect(ev.every((e) => !e.simulated)).toBe(true);
    expect(ev.some((e) => e.type === "queued")).toBe(true);
  });

  it("hands off when an upstream task completes, through the Task Center's own rules", () => {
    const { svc, run } = setup();
    const id = run.nodeTasks.intake;
    expect(svc.apply(id, (t, _a, at) => transition(t, "running", KHANEIL, at)).ok).toBe(true);
    expect(svc.apply(id, (t, _a, at) => transition(t, "completed", KHANEIL, at)).ok).toBe(true);
    const tasks = byId(svc.repo.list());
    const st = liveStatus(run.snapshot, run, tasks);
    expect(st.get("intake")).toBe("completed");
    expect(st.get("market-research")).toBe("queued");
    expect(liveEvents(run, tasks).some((e) => e.type === "handoff" && e.nodeId === "market-research")).toBe(true);
  });

  it("keeps the approval gate: an agent can't approve, a person can", () => {
    const { svc, run } = setup();
    const id = run.nodeTasks["approve-scope"];
    const t = byId(svc.repo.list()).get(id)!;
    const asked = requestApproval({ ...t, status: "queued" }, KHANEIL, now());
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;
    const byAgent = decideApproval(asked.task, "granted", { kind: "agent", id: "benjaire-product-lab", name: "Product Lab Lead" }, now());
    expect(byAgent.ok).toBe(false);
  });

  it("reads building activity from the same statuses", () => {
    const { svc, run } = setup();
    const res = resolveAll(run.snapshot, catalog);
    const acts = buildingActivity(run.snapshot, res, liveStatus(run.snapshot, run, byId(svc.repo.list())));
    const hub = acts.find((a) => a.buildingId === "intelligence-hub")!;
    expect(hub.nodeIds).toEqual(["intake"]);
    expect(hub.active).toBe(1);
    expect(acts.reduce((n, a) => n + a.unconfigured, 0)).toBe(2);
  });
});
