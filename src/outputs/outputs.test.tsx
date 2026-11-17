import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { manualAdapter, output, simulatedAdapter } from "../execution/adapters";
import { LedgerStore } from "../execution/ledger";
import { Orchestrator } from "../execution/orchestrator";
import type { ExecutionReport, StepOutput } from "../execution/types";
import { liveAttempt } from "../tasks/lifecycle";
import { byId, LocalTaskRepository, memoryBackend, TaskService } from "../tasks/store";
import { KHANEIL, type Actor, type StoredTask } from "../tasks/types";
import { BENJAIRE_LAUNCH, BENJAIRE_LAUNCH_GOAL } from "../workflows/benjaireLaunch";
import { liveStatus, simulate } from "../workflows/engine";
import { RunStore, startLiveRun } from "../workflows/runs";
import { ChartView, OutputBody, SafeMarkdown, TableView } from "../views/workflows/OutputRenderers";
import { liveOutputs } from "./live";
import { assembleReport } from "./report";
import { simRunId, simulatedOutputs } from "./simulation";
import type { AgentOutput } from "./types";
import { chartData, dedupe, filterOutputs, outputProblems, parseScores, redact, safeImageUrl, safeUrl, scopeOutputs, tableData } from "./validate";

// Agent Output Studio: deterministic fixtures through the real Task Center, run store, ledger and
// orchestrator (simulated adapter, nothing leaves the process).

const N8N: Actor = { kind: "n8n", id: "n8n", name: "n8n" };
const art = (id: string) => ({ id, label: id, url: `https://docs.google.com/document/d/${id}`, kind: "document" as const });
const OUT: Record<string, StepOutput> = {
  intake: output("goal-intake/1", { goal: "Launch a Benjaire AI product", budgetUsd: 5, agents: ["benjaire-product-lab"] }),
  "market-research": output("market-research/1", { ideas: ["Inbox triage", "Invoice chase"] }, [art("signals")]),
  "customer-research": output("customer-research/1", { personas: ["Agency owner"], pains: ["Slow follow ups"] }),
  "competitor-analysis": output("competitor-analysis/1", { competitors: ["Acme"] }),
  scoring: output("opportunity-scores/1", { rankings: ["Inbox triage — 82/100", "Invoice chase — 70/100"], criteria: ["demand"], topIdea: "Inbox triage" }, [art("scores")]),
};

async function setup() {
  let clock = Date.parse("2026-11-15T12:00:00Z");
  const now = () => new Date((clock += 1000)).toISOString();
  const svc = new TaskService(new LocalTaskRepository(memoryBackend()), now);
  const runs = new RunStore(memoryBackend());
  const ledger = new LedgerStore(memoryBackend());
  const sim = simulatedAdapter();
  const orch = new Orchestrator({ tasks: svc, runs, ledger, catalog, now, adapterFor: (n) => (n.execution.kind === "n8n" ? sim : manualAdapter) });
  const run = startLiveRun(BENJAIRE_LAUNCH_GOAL, BENJAIRE_LAUNCH, svc, runs, catalog, KHANEIL, now()).run!;
  let n = 0;
  const task = (nodeId: string) => svc.repo.get(run.nodeTasks[nodeId])!;
  const report = (nodeId: string, kind: ExecutionReport["kind"], extra: Partial<ExecutionReport> = {}): ExecutionReport => ({ eventId: `ev-${nodeId}-${kind}-${++n}`, runId: run.id, nodeId, attemptId: liveAttempt(task(nodeId))?.id ?? "none", kind, source: N8N, at: now(), ...(kind === "succeeded" ? { output: OUT[nodeId] } : {}), ...extra });
  expect(orch.authorize(run.id, KHANEIL).ok).toBe(true);
  expect(orch.recordOutput(run.id, "intake", OUT.intake, KHANEIL).ok).toBe(true);
  await orch.step(run.id);
  const outputs = () => liveOutputs({ run, tasks: byId(svc.repo.list()), ledger: ledger.get(run.id) });
  return { svc, ledger, orch, run, task, report, outputs };
}

describe("live outputs", () => {
  it("ties every output to its run, task and registry agent", async () => {
    const e = await setup();
    for (const id of ["market-research", "customer-research", "competitor-analysis"]) expect(e.orch.receive(e.report(id, "succeeded")).ok).toBe(true);
    const outs = e.outputs();
    expect(outs.length).toBeGreaterThan(0);
    const agentIds = new Set(catalog.agents.map((a) => a.id));
    for (const o of outs) {
      expect(o.workflowRunId).toBe(e.run.id);
      expect(o.taskId).toBe(e.run.nodeTasks[o.nodeId]);
      const node = BENJAIRE_LAUNCH.nodes.find((n) => n.id === o.nodeId)!;
      if (node.agentId) {
        expect(o.agentId).toBe(node.agentId);
        expect(agentIds.has(o.agentId)).toBe(true);
      }
      expect(outputProblems(o)).toEqual([]);
    }
    const research = outs.filter((o) => o.nodeId === "market-research");
    expect(research.map((o) => o.type)).toEqual(expect.arrayContaining(["markdown", "table", "document"]));
    expect(research.find((o) => o.type === "document")!.artifact!.url).toBe("https://docs.google.com/document/d/signals");
  });

  it("verifies only complete, schema-checked outputs; work in progress stays unverified", async () => {
    const e = await setup();
    expect(e.orch.receive(e.report("market-research", "succeeded")).ok).toBe(true);
    const outs = e.outputs();
    expect(outs.filter((o) => o.nodeId === "market-research" && o.type !== "table").every((o) => o.verificationStatus === "verified")).toBe(true);
    const pending = outs.find((o) => o.nodeId === "customer-research" && o.id.endsWith(":pending"))!;
    expect(pending.state).toBe("loading");
    expect(pending.verificationStatus).toBe("unverified");
    for (const o of outs) if (o.verificationStatus === "verified") expect(o.state).toBe("complete");
  });

  it("keeps failed attempts apart and marks earlier attempts as history", async () => {
    const e = await setup();
    expect(e.orch.receive(e.report("competitor-analysis", "succeeded")).ok).toBe(true);
    const t = e.task("competitor-analysis");
    const failed = { ...t.attempts[0], id: "a-old", number: 1, state: "failed" as const, error: "n8n timed out", finishedAt: t.attempts[0].requestedAt };
    const tasks = byId(e.svc.repo.list());
    tasks.set(t.id, { ...t, attempts: [failed, { ...t.attempts[0], number: 2 }] } as StoredTask);
    const outs = liveOutputs({ run: e.run, tasks, ledger: e.ledger.get(e.run.id) });
    const err = outs.find((o) => o.id.endsWith(":competitor-analysis:1:failed"))!;
    expect(err.category).toBe("errors");
    expect(err.latest).toBe(false);
    expect(filterOutputs(outs, "errors").some((o) => o.id === err.id)).toBe(false);
    expect(filterOutputs(outs, "errors", { history: true }).some((o) => o.id === err.id)).toBe(true);
  });

  it("gives the same cards when an execution event repeats", async () => {
    const e = await setup();
    const rep = e.report("market-research", "succeeded");
    expect(e.orch.receive(rep).ok).toBe(true);
    const first = e.outputs().map((o) => o.id);
    e.orch.receive(rep);
    e.orch.receive({ ...rep });
    expect(e.outputs().map((o) => o.id)).toEqual(first);
    const outs = e.outputs();
    expect(dedupe([...outs, ...outs])).toHaveLength(outs.length);
  });

  it("says when a task record is missing and drops unsafe artifact links", async () => {
    const e = await setup();
    const tasks = byId(e.svc.repo.list());
    tasks.delete(e.run.nodeTasks["customer-research"]);
    const outs = liveOutputs({ run: e.run, tasks, ledger: e.ledger.get(e.run.id) });
    expect(outs.find((o) => o.nodeId === "customer-research")!.state).toBe("missing");
    const bad = { ...OUT["market-research"], artifacts: [{ ...art("x"), url: "http://example.com/x" }, { ...art("y"), url: "javascript:alert(1)" }] };
    expect(e.orch.receive(e.report("market-research", "succeeded", { output: bad })).ok).toBe(true);
    expect(e.outputs().some((o) => o.artifact && !o.artifact.url.startsWith("https://"))).toBe(false);
    expect(outputProblems({ ...e.outputs()[0], type: "link", artifact: undefined })).toContain("No artifact to open.");
  });

  it("draws the scorecard only from numbers in the record, and records approvals", async () => {
    const e = await setup();
    for (const id of ["market-research", "customer-research", "competitor-analysis"]) e.orch.receive(e.report(id, "succeeded"));
    await e.orch.step(e.run.id);
    e.orch.receive(e.report("scoring", "succeeded"));
    const chart = e.outputs().find((o) => o.nodeId === "scoring" && o.type === "chart")!;
    expect(chartData(chart.structuredData)!.series).toEqual([
      { label: "Inbox triage", value: 82 },
      { label: "Invoice chase", value: 70 },
    ]);
    expect(parseScores(["Inbox triage", "Invoice chase — 70"])).toBeNull();
  });
});

describe("validation and rendering", () => {
  it("refuses chart data that isn't real numbers", () => {
    expect(chartData({ series: [{ label: "a", value: Number.NaN }] })).toBeNull();
    expect(chartData({ series: [{ label: "a", value: Infinity }] })).toBeNull();
    expect(chartData({ series: [{ label: "a", value: -1 }] })).toBeNull();
    expect(chartData({ series: [{ label: "a", value: "5" }] })).toBeNull();
    expect(chartData({ series: [] })).toBeNull();
    expect(chartData({ series: [{ label: "a", value: 3 }], max: 10 })).toEqual({ series: [{ label: "a", value: 3 }], max: 10, unit: undefined });
    expect(renderToStaticMarkup(<ChartView data={{ series: [{ label: "a", value: Number.NaN }] }} />)).toContain("no chart is drawn");
  });

  it("renders markdown as text: no HTML, scripts or unsafe links", () => {
    const md = "# Title\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n- [bad](javascript:alert(1))\n- [ok](https://example.com/a)\n**bold** `code`";
    const unverified = renderToStaticMarkup(<SafeMarkdown text={md} links={false} />);
    const verified = renderToStaticMarkup(<SafeMarkdown text={md} links />);
    for (const html of [unverified, verified]) {
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("javascript:");
      expect(html).toContain("&lt;script&gt;");
    }
    expect(unverified).not.toContain("<a ");
    expect(verified).toContain('href="https://example.com/a"');
    expect(safeUrl("https://user:pw@example.com")).toBeNull();
    expect(safeUrl("data:text/html,hi")).toBeNull();
    expect(safeImageUrl("https://example.com/x.svg")).toBeNull();
    expect(safeImageUrl("https://example.com/x.png")).toBe("https://example.com/x.png");
  });

  it("redacts credentials in any text it shows", () => {
    const s = redact("key sk-ant-api03-abcdefghijklmnop and ghp_abcdefghijklmnopqrstuvwxyz12 and Authorization: Bearer abc.def.ghi123 and password=hunter22");
    expect(s).not.toMatch(/sk-ant-api03|ghp_abc|abc\.def|hunter22/);
    const html = renderToStaticMarkup(<OutputBody o={{ ...base(), type: "text", structuredData: { text: "token: supersecretvalue" } }} />);
    expect(html).not.toContain("supersecretvalue");
  });

  it("caps large tables and keeps validation fast", () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => [i, `row ${i}`]);
    const t0 = performance.now();
    expect(tableData({ columns: ["#", "Value"], rows })!.rows).toHaveLength(10_000);
    const html = renderToStaticMarkup(<TableView data={{ columns: ["#", "Value"], rows }} />);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(html.match(/<tr>/g)!.length).toBe(101);
    expect(html).toContain("Show all 10000 rows");
    expect(renderToStaticMarkup(<TableView data={{ columns: ["#", "Value"], rows }} limit={3} />).match(/<tr>/g)!.length).toBe(4);
  });

  it("filters by category and selected step", () => {
    const outs: AgentOutput[] = [
      { ...base(), id: "1", nodeId: "scoring", category: "analytics" },
      { ...base(), id: "2", nodeId: "brief", category: "documents" },
      { ...base(), id: "3", nodeId: "brief", category: "errors", type: "error", structuredData: { message: "x" }, verificationStatus: "unverified", state: "failed" },
    ];
    expect(filterOutputs(outs, "all").map((o) => o.id)).toEqual(["1", "2", "3"]);
    expect(filterOutputs(outs, "documents").map((o) => o.id)).toEqual(["2"]);
    expect(filterOutputs(outs, "errors").map((o) => o.id)).toEqual(["3"]);
    expect(filterOutputs(outs, "all", { nodeId: "brief" }).map((o) => o.id)).toEqual(["2", "3"]);
  });
});

describe("simulation, isolation and access", () => {
  const status = (step: number, standIn = true) => simulate(BENJAIRE_LAUNCH, { branches: { viability: "yes" }, manualStandIn: standIn }, step, (id) => id);
  const simOut = (step: number, standIn = true) => {
    const s = status(step, standIn);
    return simulatedOutputs(BENJAIRE_LAUNCH, s.status, { standIn, startedNodes: new Set(s.events.filter((e) => e.type !== "skipped").map((e) => e.nodeId)), completedNodes: new Set(s.events.filter((e) => e.type === "completed").map((e) => e.nodeId)) });
  };

  it("labels every simulated output and reveals them step by step", () => {
    expect(simOut(0)).toEqual([]);
    const all = simOut(status(0).maxStep);
    expect(all.length).toBeGreaterThan(10);
    expect(all.every((o) => o.verificationStatus === "simulated" && o.mode === "simulation" && o.workflowRunId === simRunId(BENJAIRE_LAUNCH.id))).toBe(true);
    for (const t of ["Market research summary", "Customer pain-point analysis", "Competitor comparison", "Opportunity scorecard", "Product brief", "Quality-check results", "Launch summary"]) expect(all.some((o) => o.title === t)).toBe(true);
    for (const o of all) expect(outputProblems(o)).toEqual([]);
    expect(simOut(2).some((o) => o.title === "Product brief")).toBe(false);
    // Without a stand-in the unconfigured step shows as not set up, not as a result.
    const noStandIn = simOut(status(0, false).maxStep, false);
    expect(noStandIn.some((o) => o.nodeId === "quality" && o.state === "complete")).toBe(false);
    expect(noStandIn.some((o) => o.nodeId === "develop" && o.state === "unconfigured")).toBe(true);
  });

  it("never mixes live and simulated outputs, and refuses runs not held here", async () => {
    const e = await setup();
    e.orch.receive(e.report("market-research", "succeeded"));
    const live = e.outputs();
    const sim = simOut(4);
    const mixed = [...live, ...sim];
    const liveScope = scopeOutputs(mixed, { mode: "live", runIds: new Set([e.run.id]) });
    expect(liveScope.every((o) => o.mode === "live")).toBe(true);
    expect(liveScope).toHaveLength(live.length);
    const simScope = scopeOutputs(mixed, { mode: "simulation", runIds: new Set([simRunId(BENJAIRE_LAUNCH.id)]) });
    expect(simScope.every((o) => o.verificationStatus === "simulated")).toBe(true);
    // An output id or run id from elsewhere grants nothing.
    expect(scopeOutputs(live, { mode: "live", runIds: new Set(["wfrun_someone_else"]) })).toEqual([]);
    expect(scopeOutputs([{ ...live[0], workflowRunId: simRunId(BENJAIRE_LAUNCH.id) }], { mode: "simulation", runIds: new Set([simRunId(BENJAIRE_LAUNCH.id)]) })).toEqual([]);
    expect(outputProblems({ ...live[0], verificationStatus: "simulated" })).toContain("A live output can't be simulated.");
    expect(outputProblems({ ...sim[0], verificationStatus: "verified" })).toContain("A simulated output must be labelled simulated.");
  });

  it("assembles the report from existing outputs without upgrading their status", async () => {
    const e = await setup();
    e.orch.receive(e.report("market-research", "succeeded"));
    const outs = e.outputs();
    const st = liveStatus(e.run.snapshot, e.run, byId(e.svc.repo.list()));
    const r = assembleReport(BENJAIRE_LAUNCH_GOAL, BENJAIRE_LAUNCH, outs, st, (id) => id, "live");
    expect(r.goal).toBe(BENJAIRE_LAUNCH_GOAL.name);
    expect(r.completedStages).toContain(1);
    expect(r.findings.length).toBeGreaterThan(0);
    for (const l of [...r.findings, ...r.decisions, ...r.deliverables]) expect(outs.some((o) => o.nodeId === l.nodeId && o.verificationStatus === l.verification)).toBe(true);
    expect(r.findings.filter((l) => l.verification === "verified").length).toBeLessThanOrEqual(outs.filter((o) => o.verificationStatus === "verified").length);
    expect(r.counts.simulated).toBe(0);
    expect(r.evidence.some((x) => x.ref.includes("signals"))).toBe(true);
    expect(r.nextActions.length).toBeGreaterThan(0);

    const s = status(status(0).maxStep);
    const simR = assembleReport(BENJAIRE_LAUNCH_GOAL, BENJAIRE_LAUNCH, simOut(s.maxStep), s.status, (id) => id, "simulation");
    expect(simR.counts.verified).toBe(0);
    expect([...simR.findings, ...simR.decisions].every((l) => l.verification === "simulated")).toBe(true);
  });
});

function base(): AgentOutput {
  return { id: "x", workflowRunId: "r", taskId: "t", agentId: "a", nodeId: "n", type: "text", title: "T", structuredData: { text: "hi" }, createdAt: "2026-01-01T00:00:00Z", verificationStatus: "verified", mode: "live", category: "research", state: "complete", attempt: 1, latest: true };
}
