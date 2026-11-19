import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { D1, D1Statement } from "../../server/live";
import { dispatchStep, readStepReports, receiveStepReport, type BridgeEnv } from "../../server/n8nBridge";
import { catalog } from "../catalog";
import { decideApproval, retry } from "../tasks/lifecycle";
import { byId, LocalTaskRepository, memoryBackend, TaskService, type Backend } from "../tasks/store";
import { KHANEIL, type Actor } from "../tasks/types";
import { BENJAIRE_LAUNCH, BENJAIRE_LAUNCH_GOAL } from "../workflows/benjaireLaunch";
import { RunStore, startLiveRun } from "../workflows/runs";
import type { WorkflowRun } from "../workflows/types";
import { adapterRouter, manualAdapter, n8nAdapter, output } from "./adapters";
import { bridgeAdapter, pullReports, type BridgeClient } from "./bridgeClient";
import { LedgerStore } from "./ledger";
import { BRIDGE_STEPS, type StepReportBody } from "./n8nBridge";
import { Orchestrator } from "./orchestrator";
import { goalReport } from "./report";
import type { ArtifactRef, DispatchResult, HandoffEnvelope, StepOutput } from "./types";

// Production reliability test: one full Benjaire workflow ("Launch a Benjaire AI product"), from
// the goal through the Task Center, agent steps on the n8n step runner, Khaneil's approvals, to a
// measured outcome. Everything real except the network edges: the orchestrator, task lifecycle and
// ledger as the app runs them, and the site's own bridge handlers (server/n8nBridge.ts) on a real
// SQLite database. n8n is a stand-in that behaves like the published "Atlas · Step Runner" (one
// model call, then a report to /api/hooks/n8n-report) and can be made to fail in each way the real
// one can. "Restart" throws the orchestrator and stores away and rebuilds them from storage, as
// quitting and reopening the Mac app does.

const TOKEN = "t".repeat(40);
const CALLBACK = "c".repeat(40);
const SITE = "https://ai-ops-atlas.pages.dev";
const WEBHOOK = "https://khancam15.app.n8n.cloud/webhook/atlas-step-runner";

function sqliteD1(): D1 {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: Number(r.changes) } };
    },
    all: async <T,>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
}

const art = (id: string) => ({ id, label: id, url: `https://docs.google.com/document/d/${id}`, kind: "document" as const });
/** What the step runner's model answers for each step when it works. */
const ANSWER: Record<string, StepOutput["fields"]> = {
  "market-research": { ideas: ["Inbox triage for agencies", "Invoice chase assistant"] },
  "customer-research": { personas: ["Agency owner"], pains: ["Slow client follow ups"] },
  "competitor-analysis": { competitors: ["Acme Mail AI"], priceRange: "$19-$49 a month" },
  scoring: { rankings: ["Inbox triage for agencies"], criteria: ["demand", "build effort"], topIdea: "Inbox triage for agencies" },
  brief: { audience: "Small agencies", mvpScope: ["Gmail triage", "Daily digest"] },
  planning: { effortDays: 10, risks: ["Gmail API limits"], audience: "Small agencies" },
};
const SCHEMA: Record<string, string> = { "market-research": "market-research/1", "customer-research": "customer-research/1", "competitor-analysis": "competitor-analysis/1", scoring: "opportunity-scores/1", brief: "product-brief/1", planning: "product-plan/1" };

/** How the stand-in n8n behaves for the next send of a step. */
type N8nMode =
  | "ok"
  | "model-error" // the model call fails: the runner reports failed, transient
  | "bad-json" // the model answers prose: the runner reports failed
  | "empty-fields" // the model answers {}: the runner reports "succeeded" with nothing in it
  | "crash" // n8n accepts the webhook, then dies: no report ever
  | "report-lost" // the step runs but its report never reaches the site
  | "report-twice" // the report POST is retried after a lost answer: the site gets it twice
  | "webhook-timeout" // n8n started the step but the site's call timed out
  | "http-500"; // n8n answers 500 without starting anything

interface World {
  backends: { tasks: Backend; runs: Backend; ledger: Backend };
  site: BridgeEnv;
  /** Every request the site made to the outside world. */
  outbound: string[];
  /** Model calls n8n made, per step. */
  modelCalls: Record<string, number>;
  mode: Record<string, N8nMode[]>;
  /** Reports n8n held back (crash or lost), by step. */
  held: StepReportBody[];
  cursor: number;
  clock: number;
  /** When set, the app "dies" while this step's send is in flight: before the site gets it, or after. */
  dieDuring?: { nodeId: string; when: "before-site" | "after-site" };
  app: App;
}

interface App {
  svc: TaskService;
  runs: RunStore;
  ledger: LedgerStore;
  orch: Orchestrator;
  client: BridgeClient;
}

const now = (w: World) => new Date(w.clock).toISOString();

/** The stand-in step runner: the same checks and report shape as the published n8n workflow. */
async function n8n(w: World, req: Request): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("Authorization data is wrong!", { status: 403 });
  const e = (await req.json()) as HandoffEnvelope;
  if (!SCHEMA[e.nodeId] || e.envelopeVersion !== 1 || !e.idempotencyKey || !e.attemptId || !e.runId) return new Response("", { status: 200 });
  const mode = w.mode[e.nodeId]?.shift() ?? "ok";
  if (mode === "http-500") return new Response("", { status: 500 });
  w.modelCalls[e.nodeId] = (w.modelCalls[e.nodeId] ?? 0) + 1;
  const exec = `${1000 + Object.values(w.modelCalls).reduce((a, b) => a + b, 0)}`;
  const base = { runId: e.runId, nodeId: e.nodeId as StepReportBody["nodeId"], attemptId: e.attemptId, idempotencyKey: e.idempotencyKey, eventId: `${e.idempotencyKey}:${exec}`, executionId: exec, at: now(w), usage: { model: "claude-haiku-5-5", provider: "anthropic", durationMs: 4000 } } as const;
  const report: StepReportBody =
    mode === "model-error"
      ? { ...base, kind: "failed", error: "The model call failed.", transient: true }
      : mode === "bad-json"
        ? { ...base, kind: "failed", error: "The model did not return JSON." }
        : { ...base, kind: "succeeded", output: { schema: SCHEMA[e.nodeId], fields: mode === "empty-fields" ? {} : ANSWER[e.nodeId], artifacts: [{ id: `n8n-${exec}`, label: "n8n step runner execution", url: `https://khancam15.app.n8n.cloud/workflow/x/executions/${exec}` } as ArtifactRef] } }; // the real runner sends no artifact kind
  if (mode === "crash" || mode === "report-lost") {
    w.held.push(report);
  } else {
    await postReport(w, report);
    if (mode === "report-twice") await postReport(w, report);
  }
  if (mode === "webhook-timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  return new Response("", { status: 200 });
}

const postReport = (w: World, r: StepReportBody, key = CALLBACK) => receiveStepReport(new Request(`${SITE}/api/hooks/n8n-report`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(r) }), w.site, w.clock);

/** The site's fetch: only the step runner webhook is reachable; anything else is recorded and refused. */
const siteFetch = (w: World): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    w.outbound.push(url);
    if (url !== WEBHOOK) return new Response("not allowed in this test", { status: 599 });
    return n8n(w, new Request(url, init));
  }) as typeof fetch;

const NEVER = new Promise<never>(() => {});

/** The app's bridge client, talking to the real site handlers. */
function client(w: World): BridgeClient {
  return {
    status: async () => true,
    send: async (env) => {
      if (w.dieDuring?.nodeId === env.nodeId && w.dieDuring.when === "before-site") return NEVER;
      const res = await dispatchStep(new Request(`${SITE}/api/n8n/steps`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(env) }), w.site, siteFetch(w), w.clock);
      if (w.dieDuring?.nodeId === env.nodeId) return NEVER;
      return (await res.json()) as DispatchResult;
    },
    reports: async (since) => (await readStepReports(new URL(`${SITE}/api/n8n/steps?since=${since}`), w.site)).json(),
    lookup: async (idem) => (await readStepReports(new URL(`${SITE}/api/n8n/steps?idem=${encodeURIComponent(idem)}`), w.site)).json(),
  };
}

/** Opens the app: stores read from device storage, a fresh orchestrator, recovery run once. */
function boot(w: World): App {
  const svc = new TaskService(new LocalTaskRepository(w.backends.tasks), () => now(w));
  const runs = new RunStore(w.backends.runs);
  const ledger = new LedgerStore(w.backends.ledger);
  const c = client(w);
  const route = adapterRouter(manualAdapter, bridgeAdapter(c, () => true));
  const orch = new Orchestrator({ tasks: svc, runs, ledger, catalog, now: () => now(w), adapterFor: (n) => route(n) });
  orch.recover();
  return { svc, runs, ledger, orch, client: c };
}

function world(): World {
  const w = {
    backends: { tasks: memoryBackend(), runs: memoryBackend(), ledger: memoryBackend() },
    site: { LIVE: sqliteD1(), N8N_BRIDGE_TOKEN: TOKEN, N8N_BRIDGE_CALLBACK_TOKEN: CALLBACK },
    outbound: [],
    modelCalls: {},
    mode: {},
    held: [],
    cursor: 0,
    clock: Date.parse("2026-11-16T12:00:00Z"),
  } as unknown as World;
  w.app = boot(w);
  return w;
}

/** Quit and reopen the app. Storage survives; everything in memory doesn't. */
function restart(w: World) {
  w.dieDuring = undefined;
  w.app = boot(w);
}

const tick = (w: World, ms: number) => void (w.clock += ms);
const pull = (w: World) => pullReports(w.app.orch, w.app.client, { read: () => w.cursor, write: (n) => void (w.cursor = n) });
/** What the Run panel does each minute while a step is out: pick up reports, then one round. */
async function poll(w: World, run: WorkflowRun) {
  await pull(w);
  return w.app.orch.step(run.id);
}
const task = (w: World, run: WorkflowRun, nodeId: string) => w.app.svc.repo.get(run.nodeTasks[nodeId])!;
const st = (w: World, run: WorkflowRun, nodeId: string) => task(w, run, nodeId).status;
const grant = (w: World, run: WorkflowRun, nodeId: string, actor: Actor = KHANEIL) => w.app.svc.apply(task(w, run, nodeId).id, (x, _a, at) => decideApproval(x, "granted", actor, at));
async function rows(w: World) {
  const db = w.site.LIVE!;
  const d = (await db.prepare("SELECT idem, node_id, state FROM n8n_dispatch").all<{ idem: string; node_id: string; state: string }>()).results;
  const r = (await db.prepare("SELECT event_id, idem FROM n8n_reports").all<{ event_id: string; idem: string }>()).results;
  return { dispatch: d, reports: r };
}

/** Khaneil starts the goal and records the intake; research goes out. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};
async function start(w: World, opts: { dies?: boolean } = {}): Promise<WorkflowRun> {
  const r = startLiveRun(BENJAIRE_LAUNCH_GOAL, BENJAIRE_LAUNCH, w.app.svc, w.app.runs, catalog, KHANEIL, now(w));
  expect(r.error).toBeNull();
  const run = r.run!;
  expect(w.app.orch.authorize(run.id, KHANEIL).ok).toBe(true);
  expect(w.app.orch.recordOutput(run.id, "intake", output("goal-intake/1", { goal: BENJAIRE_LAUNCH_GOAL.objective, budgetUsd: 5, agents: ["benjaire-product-lab"] }), KHANEIL).ok).toBe(true);
  // When the app is about to die mid-send, the round never finishes: don't wait for it.
  if (opts.dies) {
    void w.app.orch.step(run.id);
    await settle();
  } else await w.app.orch.step(run.id);
  return run;
}

/** Drives the rest of the workflow the way Khaneil and the app do, through to a measured outcome. */
async function finish(w: World, run: WorkflowRun) {
  for (let i = 0; i < 4 && st(w, run, "scoring") !== "completed"; i++) await poll(w, run);
  expect(st(w, run, "scoring")).toBe("completed");
  if (st(w, run, "viability") !== "completed") expect(w.app.orch.decide(run.id, "viability", "yes", KHANEIL).ok).toBe(true);
  for (let i = 0; i < 6 && st(w, run, "planning") !== "completed"; i++) await poll(w, run);
  expect(st(w, run, "planning")).toBe("completed");
  await w.app.orch.step(run.id);
  expect(st(w, run, "approve-scope")).toBe("awaiting_approval");
  expect(grant(w, run, "approve-scope").ok).toBe(true);
  await w.app.orch.step(run.id);
  // No coding or test workflow exists: Khaneil records what was built and checked.
  expect(w.app.orch.recordOutput(run.id, "develop", output("development/1", { repository: "khaneilcampbell/benjaire-flow", build: "passed", tests: "passed" }, [art("pr")]), KHANEIL).ok).toBe(true);
  expect(w.app.orch.recordOutput(run.id, "quality", output("quality/1", { passed: true }), KHANEIL).ok).toBe(true);
  await w.app.orch.step(run.id);
  expect(grant(w, run, "approve-launch").ok).toBe(true);
  await w.app.orch.step(run.id);
  expect(grant(w, run, "publish").ok).toBe(true);
  await w.app.orch.step(run.id);
  // Publishing stays in n8n's own Approve and Publish flow; Khaneil records the listing.
  expect(w.app.orch.recordOutput(run.id, "publish", output("publication/1", { listing: "Inbox triage for agencies" }, [art("listing")]), KHANEIL).ok).toBe(true);
  await w.app.orch.step(run.id);
  expect(w.app.orch.recordOutput(run.id, "monitor", output("launch-outcome/1", { summary: "Listed. First sale on Stripe." }), KHANEIL).ok).toBe(true);
  await w.app.orch.step(run.id);
  expect(w.app.orch.recordOutcome(run.id, { state: "achieved", note: "First sale", metrics: [{ name: "Stripe net sales (USD cents)", value: 7900, source: "Stripe sales feed (atlas-sales-feed)" }] }, KHANEIL).ok).toBe(true);
  return goalReport(run, byId(w.app.svc.repo.list()), w.app.ledger.get(run.id));
}

/** Every bridge step ran once and only once in n8n, and Atlas recorded exactly one validated result for it. */
async function expectCleanLedger(w: World, run: WorkflowRun) {
  const l = w.app.ledger.get(run.id);
  for (const s of BRIDGE_STEPS) {
    expect(l.handoffs[s]?.state, s).toBe("validated");
    expect(Object.keys(l.handoffs[s]!.output!.fields).length, s).toBeGreaterThan(0);
  }
  const { dispatch, reports } = await rows(w);
  expect(new Set(dispatch.map((d) => d.idem)).size).toBe(dispatch.length);
  expect(new Set(reports.map((r) => r.event_id)).size).toBe(reports.length);
  expect(w.outbound.every((u) => u === WEBHOOK)).toBe(true);
  expect(Object.keys(l.needsReconcile)).toEqual([]);
}

describe("reliability: the happy path", () => {
  it("runs the whole workflow once, with one n8n call per step, and ends with a measured outcome", async () => {
    const w = world();
    const run = await start(w);
    const rep = await finish(w, run);
    expect(rep.status).toBe("completed");
    expect(rep.outcome).toBe("achieved");
    expect(rep.approvalsGranted).toBe(3);
    expect(w.modelCalls).toEqual(Object.fromEntries(BRIDGE_STEPS.map((s) => [s, 1])));
    expect((await rows(w)).dispatch).toHaveLength(6);
    await expectCleanLedger(w, run);
  });
});

describe("reliability: interrupted execution", () => {
  it("quitting while steps are out with n8n loses nothing and sends nothing twice", async () => {
    const w = world();
    w.mode["market-research"] = ["crash"]; // its report arrives late, after the restart
    const run = await start(w);
    restart(w);
    expect(st(w, run, "market-research")).toBe("running");
    await poll(w, run);
    expect(st(w, run, "customer-research")).toBe("completed");
    // The late report arrives once n8n is back.
    await postReport(w, w.held.shift()!);
    restart(w);
    await finish(w, run);
    expect(w.modelCalls["market-research"]).toBe(1);
    await expectCleanLedger(w, run);
  });

  it("quitting after Atlas recorded a send but before the site got it: the site says it never went, so it's sent once", async () => {
    const w = world();
    w.dieDuring = { nodeId: "market-research", when: "before-site" };
    const run = await start(w, { dies: true });
    restart(w);
    expect(task(w, run, "market-research").attempts[0].state).toBe("unknown");
    tick(w, 3 * 60_000);
    await poll(w, run);
    expect(task(w, run, "market-research").attempts[0].state).toBe("failed");
    tick(w, 60_000);
    await poll(w, run);
    await finish(w, run);
    expect(w.modelCalls["market-research"]).toBe(1);
    expect(task(w, run, "market-research").attempts).toHaveLength(2);
    await expectCleanLedger(w, run);
  });

  it("quitting after the site sent it to n8n: the site's record and report finish the step, with no second send", async () => {
    const w = world();
    w.dieDuring = { nodeId: "scoring", when: "after-site" };
    const run = await start(w);
    await pull(w);
    void w.app.orch.step(run.id);
    await settle();
    expect(task(w, run, "scoring").attempts[0].state).toBe("requested");
    restart(w);
    expect(task(w, run, "scoring").attempts[0].state).toBe("unknown");
    await poll(w, run);
    expect(st(w, run, "scoring")).toBe("completed");
    await finish(w, run);
    expect(w.modelCalls.scoring).toBe(1);
    await expectCleanLedger(w, run);
  });

  it("n8n's webhook call times out after the step started: held, then completed by its report, never re-sent", async () => {
    const w = world();
    w.mode["competitor-analysis"] = ["webhook-timeout"];
    const run = await start(w);
    expect(task(w, run, "competitor-analysis").attempts[0].state).toBe("unknown");
    await poll(w, run);
    expect(st(w, run, "competitor-analysis")).toBe("completed");
    await finish(w, run);
    expect(w.modelCalls["competitor-analysis"]).toBe(1);
    await expectCleanLedger(w, run);
  });

  it("the model call fails mid-run: one automatic retry after the backoff, then it goes on", async () => {
    const w = world();
    w.mode["customer-research"] = ["model-error"];
    const run = await start(w);
    await poll(w, run);
    expect(st(w, run, "customer-research")).toBe("failed");
    await poll(w, run);
    expect(task(w, run, "customer-research").attempts).toHaveLength(1); // waiting out the backoff
    tick(w, 61_000);
    await poll(w, run);
    await finish(w, run);
    expect(task(w, run, "customer-research").attempts).toHaveLength(2);
    expect(w.modelCalls["customer-research"]).toBe(2);
    await expectCleanLedger(w, run);
  });

  it("n8n answers 500 without starting: the step fails cleanly and nothing is counted as sent twice", async () => {
    const w = world();
    w.mode.brief = ["http-500"];
    const run = await start(w);
    for (let i = 0; i < 3; i++) await poll(w, run);
    w.app.orch.decide(run.id, "viability", "yes", KHANEIL);
    await poll(w, run);
    expect(task(w, run, "brief").attempts[0].state).toBe("unknown");
    expect(w.modelCalls.brief).toBeUndefined();
    // The site's record says n8n refused it with no clear start; it stays held for Khaneil until checked.
    await poll(w, run);
    expect(w.app.ledger.get(run.id).needsReconcile.brief).toMatch(/n8n answered 500/);
    expect(st(w, run, "planning")).toBe("blocked");
    // Khaneil checks n8n, records that it didn't run, and retries: one more send, under a new key.
    expect(w.app.orch.resolveUnknown(run.id, "brief", "did_not_run", KHANEIL).ok).toBe(true);
    expect(w.app.svc.apply(task(w, run, "brief").id, (x, _a, at) => retry(x, KHANEIL, at)).ok).toBe(true);
    await finish(w, run);
    expect(w.modelCalls.brief).toBe(1);
    await expectCleanLedger(w, run);
  });

  it("n8n dies after accepting a step and never reports: Atlas notices without any other change and holds it for Khaneil", async () => {
    const w = world();
    w.mode.planning = ["crash"];
    const run = await start(w);
    for (let i = 0; i < 3; i++) await poll(w, run);
    w.app.orch.decide(run.id, "viability", "yes", KHANEIL);
    for (let i = 0; i < 3; i++) await poll(w, run);
    expect(st(w, run, "planning")).toBe("running");
    tick(w, 31 * 60_000);
    const s = await poll(w, run);
    expect(s.ok && s.summary.stale).toContain("planning");
    expect(task(w, run, "planning").attempts[0].state).toBe("unknown");
    expect(st(w, run, "approve-scope")).not.toBe("awaiting_approval");
    // Khaneil checks: it never finished. Retrying sends it once more under a new key.
    expect(w.app.orch.resolveUnknown(run.id, "planning", "did_not_run", KHANEIL).ok).toBe(true);
    expect(w.app.svc.apply(task(w, run, "planning").id, (x, _a, at) => retry(x, KHANEIL, at)).ok).toBe(true);
    await poll(w, run);
    await poll(w, run);
    expect(st(w, run, "planning")).toBe("completed");
    expect(w.modelCalls.planning).toBe(2);
  });
});

describe("reliability: accurate state", () => {
  it("a report that's delivered twice completes the step once", async () => {
    const w = world();
    w.mode["market-research"] = ["report-twice"];
    const run = await start(w);
    await poll(w, run);
    expect((await rows(w)).reports.filter((r) => r.idem.startsWith(run.nodeTasks["market-research"]))).toHaveLength(1);
    expect(task(w, run, "market-research").attempts).toHaveLength(1);
  });

  it("a report n8n couldn't deliver doesn't leave the step running forever", async () => {
    const w = world();
    w.mode["market-research"] = ["report-lost"];
    const run = await start(w);
    tick(w, 31 * 60_000);
    await poll(w, run);
    expect(task(w, run, "market-research").attempts[0].state).toBe("unknown");
    expect(w.app.ledger.get(run.id).needsReconcile["market-research"]).toMatch(/never reported back/);
    expect(st(w, run, "scoring")).toBe("blocked");
  });

  it("a report the app picked up but couldn't save is found again from the site", async () => {
    const w = world();
    const run = await start(w);
    // The device's storage refused the write while the reports were applied; the cursor moved on anyway.
    const saved = w.backends.tasks.write;
    w.backends.tasks.write = () => {
      throw new Error("QuotaExceededError");
    };
    await pull(w);
    w.backends.tasks.write = saved;
    restart(w);
    expect(st(w, run, "market-research")).toBe("running");
    tick(w, 21 * 60_000);
    await poll(w, run);
    expect(st(w, run, "market-research")).toBe("completed");
    await finish(w, run);
    expect(w.modelCalls["market-research"]).toBe(1);
    await expectCleanLedger(w, run);
  });

  it("an empty answer or an answer that isn't JSON is never counted as done", async () => {
    const w = world();
    w.mode["market-research"] = ["empty-fields", "bad-json", "empty-fields"];
    const run = await start(w);
    for (let i = 0; i < 6; i++) {
      tick(w, 5 * 60_000);
      await poll(w, run);
    }
    expect(st(w, run, "market-research")).not.toBe("completed");
    expect(w.app.ledger.get(run.id).handoffs["market-research"]).toBeUndefined();
    expect(st(w, run, "scoring")).not.toBe("running");
    expect(w.modelCalls.scoring).toBeUndefined();
  });

  it("a report for a step that already finished, or from an old attempt, changes nothing", async () => {
    const w = world();
    const run = await start(w);
    await poll(w, run);
    const t = task(w, run, "market-research");
    const before = JSON.stringify(t);
    const forged: StepReportBody = { eventId: "forged-1", idempotencyKey: t.attempts[0].idempotencyKey, runId: run.id, nodeId: "market-research", attemptId: t.attempts[0].id, kind: "failed", error: "x", at: now(w) };
    expect((await postReport(w, forged)).status).toBe(202);
    await poll(w, run);
    expect(JSON.stringify(task(w, run, "market-research"))).toBe(before);
  });

  it("two windows asking the site to send the same step at the same moment reach n8n once", async () => {
    const w = world();
    const run = await start(w);
    const t = task(w, run, "scoring");
    const env = { envelopeVersion: 1, runId: run.id, taskId: t.id, attemptId: "run_x", nodeId: "scoring", sourceAgentIds: [], destinationAgentId: null, inputSchema: "x/1", outputSchema: "opportunity-scores/1", inputs: {}, artifacts: [], correlationId: run.id, idempotencyKey: `${t.id}:9`, at: now(w) };
    const send = () => dispatchStep(new Request(`${SITE}/api/n8n/steps`, { method: "POST", body: JSON.stringify(env) }), w.site, siteFetch(w), w.clock);
    await Promise.all([send(), send(), send()]);
    expect(w.outbound.filter((u) => u === WEBHOOK).length).toBe(3 + 1); // three research sends at start + one
  });
});

describe("reliability: no unauthorised action", () => {
  it("steps that need approval can't run without Khaneil, and no agent, workflow or Atlas can approve", async () => {
    const w = world();
    const run = await start(w);
    for (let i = 0; i < 3; i++) await poll(w, run);
    w.app.orch.decide(run.id, "viability", "yes", KHANEIL);
    for (let i = 0; i < 4; i++) await poll(w, run);
    expect(st(w, run, "approve-scope")).toBe("awaiting_approval");
    for (const a of [{ kind: "agent", id: "benjaire-product-lab", name: "Product Lab Lead" }, { kind: "n8n", id: "atlas-step-runner", name: "n8n step runner" }, { kind: "system", id: "atlas", name: "Atlas" }] as Actor[]) expect(grant(w, run, "approve-scope", a).ok).toBe(false);
    for (let i = 0; i < 3; i++) await poll(w, run);
    expect(st(w, run, "approve-scope")).toBe("awaiting_approval");
    expect(st(w, run, "develop")).toBe("blocked");
    expect(st(w, run, "publish")).toBe("blocked");
    expect(w.app.orch.waive(run.id, "publish", "skip", KHANEIL).ok).toBe(false);
  });

  it("only the six research and planning steps can reach n8n; publishing, approvals and emails can't", async () => {
    const w = world();
    const run = await start(w);
    for (const nodeId of ["publish", "approve-launch", "approve-scope", "develop", "monitor", "intake", "viability"]) {
      const res = await dispatchStep(new Request(`${SITE}/api/n8n/steps`, { method: "POST", body: JSON.stringify({ envelopeVersion: 1, runId: run.id, taskId: "t", attemptId: "a", nodeId, sourceAgentIds: [], destinationAgentId: null, inputSchema: "x/1", outputSchema: "x/1", inputs: {}, artifacts: [], correlationId: run.id, idempotencyKey: `t:${nodeId}`, at: now(w) }) }), w.site, siteFetch(w), w.clock);
      expect(res.status, nodeId).toBe(400);
    }
    expect(manualAdapter.available("publish", undefined).ok).toBe(true);
    expect(n8nAdapter.available("publish", undefined).ok).toBe(false);
    expect(w.outbound.every((u) => u === WEBHOOK)).toBe(true);
  });

  it("n8n can't approve, decide or complete another step through its report key", async () => {
    const w = world();
    const run = await start(w);
    const t = task(w, run, "market-research");
    const ok: StepReportBody = { eventId: "x1", idempotencyKey: t.attempts[0].idempotencyKey, runId: run.id, nodeId: "market-research", attemptId: t.attempts[0].id, kind: "succeeded", at: now(w), output: { schema: "market-research/1", fields: ANSWER["market-research"], artifacts: [] } };
    expect((await postReport(w, { ...ok, nodeId: "approve-scope" as never })).status).toBe(400);
    expect((await postReport(w, { ...ok, nodeId: "scoring" })).status).toBe(409);
    expect((await postReport(w, { ...ok, runId: "wfrun_other" })).status).toBe(409);
    expect((await postReport(w, ok, TOKEN)).status).toBe(401);
    expect((await postReport(w, { ...ok, idempotencyKey: "task_never:1" })).status).toBe(404);
  });

  it("a cancelled run sends nothing more, even when reports arrive", async () => {
    const w = world();
    const run = await start(w);
    expect(w.app.orch.cancelRun(run.id, KHANEIL).ok).toBe(true);
    const sent = w.outbound.length;
    for (let i = 0; i < 3; i++) await poll(w, run);
    w.app.orch.decide(run.id, "viability", "yes", KHANEIL);
    await poll(w, run);
    expect(w.outbound.length).toBe(sent);
  });
});

