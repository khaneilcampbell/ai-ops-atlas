import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildCatalog } from "../../src/catalog/parse";
import { withDb, type Db } from "../data/db";
import type { DispatchEnvelope } from "../../src/executive/control/contracts";
import { advance, cancelGoal, goalView, pauseGoal, receiveResult, resumeGoal, submitGoal, tick, type Deps } from "./engine";
import { forHook, forOwner, type ExecutiveEnv } from "./api";
import { mockAdapter, resultFor, SAMPLE_URLS, sampleReport, type MockAdapter } from "./mockAdapter";
import { n8nAdapter } from "./n8nAdapter";
import { rosterFromFiles } from "./roster";
import { WORKFLOW_ROUTES } from "../../src/executive/control/contracts";

// The Executive engine against a real PostgreSQL: PGlite by default (both migrations, constraints,
// triggers and every query run for real), or ATLAS_TEST_DATABASE_URL for the site's own driver.
// n8n is the deterministic mock adapter; nothing here calls a model or the network.

const MIG = (f: string) => readFileSync(new URL(`../../db/migrations/${f}`, import.meta.url), "utf8");
const external = process.env.ATLAS_TEST_DATABASE_URL;
let pg: PGlite | null = null;
let db: Db;

function pgliteDb(p: Pick<PGlite, "query">, top?: PGlite): Db {
  const self: Db = {
    query: async <T,>(text: string, params: unknown[] = []) => (await p.query<T>(text, params)).rows,
    tx: async <T,>(fn: (d: Db) => Promise<T>) => (top ? top.transaction((t) => fn(pgliteDb(t))) : fn(self)),
  };
  return self;
}

const catalogDir = new URL("../../catalog/", import.meta.url).pathname;
const files = Object.fromEntries(
  readdirSync(catalogDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => [f, readFileSync(join(catalogDir, f), "utf8")]),
);
const CATALOG_ROSTER = rosterFromFiles(files);
// The catalog on main keeps Atlas Executive paused until its n8n workflows are published; these
// tests run it as it will be once Khaneil publishes them (one test checks the paused case).
const ROSTER = CATALOG_ROSTER.map((a) => (a.id === "atlas-executive" ? { ...a, status: "active" } : a));

beforeAll(async () => {
  if (external) db = { query: (t, p) => withDb({ ATLAS_DATABASE_URL: external }, (d) => d.query(t, p)), tx: (fn) => withDb({ ATLAS_DATABASE_URL: external }, (d) => d.tx(fn)) } as Db;
  else {
    pg = new PGlite();
    db = pgliteDb(pg, pg);
  }
});
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await db.query("DROP SCHEMA IF EXISTS atlas CASCADE");
  const run = async (sql: string) => (pg ? pg.exec(sql) : withDb({ ATLAS_DATABASE_URL: external! }, (d) => d.query(sql)));
  await run(MIG("0001_atlas_core.sql"));
  await run(MIG("0002_executive.sql"));
  await run(MIG("0004_engineering.sql"));
});

const OBJECTIVE = "Research one potential Benjaire AI automation product and prepare a structured opportunity report.";
let clock = Date.parse("2026-11-22T12:00:00Z");
let adapter: MockAdapter;
let stopReason: string | null;
const deps = (over: Partial<Deps> = {}): Deps => ({ db, adapter, roster: async () => ROSTER, stop: async () => stopReason, now: () => clock, ...over });

beforeEach(() => {
  clock = Date.parse("2026-11-22T12:00:00Z");
  adapter = mockAdapter();
  stopReason = null;
});

async function goal(id: string) {
  return (await goalView(db, id))!;
}
const research = async (id: string) => (await goal(id)).tasks.find((t) => t.key === "research")!;
const events = async (id: string, kind: string) => db.query<{ detail: string }>("SELECT detail FROM atlas.exec_events WHERE exec_goal_id = $1 AND kind = $2 ORDER BY id", [id, kind]);
async function leaseOut() {
  await db.query("UPDATE atlas.exec_tasks SET lease_until = now() - interval '1 second' WHERE state IN ('dispatching', 'running')");
}

describe("end to end (mock n8n)", () => {
  it("plans, assigns a registered research agent, dispatches once, verifies and completes", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "khaneil@example.com");
    expect(g.state).toBe("EXECUTION_MONITORED");
    expect(g.plan?.template).toBe("opportunity-research");
    const r = g.tasks.find((t) => t.key === "research")!;
    expect(r.agentId).toBe("benjaire-product-lab-research");
    expect(r.workflow).toBe("Atlas · Executive Dispatch");
    expect(r.state).toBe("running");
    expect(r.taskRecordId).toBeTruthy();
    expect(adapter.sent).toHaveLength(1);
    const e = adapter.sent[0];
    expect(e.contract).toBe("ATLAS_EXECUTIVE_DISPATCH");
    expect(e.inputs.objective).toBe(OBJECTIVE);
    // The Task Center rows exist and mirror the state.
    const tasks = await db.query<{ status: string; created_by: string }>("SELECT status, created_by FROM atlas.tasks ORDER BY created_at");
    expect(tasks.map((t) => t.status).sort()).toEqual(["queued", "running"]);
    expect(tasks.every((t) => t.created_by === "atlas-executive")).toBe(true);

    const out = await receiveResult(deps(), resultFor(e));
    expect(out.status).toBe(202);
    const done = await goal(g.id);
    expect(done.state).toBe("GOAL_COMPLETED");
    expect(done.tasks.every((t) => t.state === "completed")).toBe(true);
    expect(done.summary).toContain("Recommended next step");
    expect(done.spentUsd).toBeGreaterThan(0);
    const run = await db.query<{ status: string; model: string; cost_usd: string; input_tokens: number }>("SELECT status, model, cost_usd::text, input_tokens FROM atlas.agent_runs");
    expect(run[0]).toMatchObject({ status: "succeeded", model: "claude-sonnet-5-5", input_tokens: 40000 });
    const note = await db.query("SELECT kind FROM atlas.ai_notes");
    expect(note).toHaveLength(1);
    // Every lifecycle state was persisted in order.
    const states = (await db.query<{ to_state: string }>("SELECT to_state FROM atlas.exec_events WHERE kind = 'goal.state' ORDER BY id")).map((x) => x.to_state);
    expect(states).toEqual(["GOAL_RECEIVED", "GOAL_VALIDATED", "PLAN_GENERATED", "PLAN_CHECKED", "TASKS_CREATED", "AGENTS_ASSIGNED", "EXECUTION_AUTHORIZED", "EXECUTION_STARTED", "EXECUTION_MONITORED", "RESULTS_VERIFIED", "GOAL_COMPLETED"]);
  });

  it("blocks a goal no template fits, without inventing a plan", async () => {
    const g = await submitGoal(deps(), { objective: "Maintain my Benjaire website and keep it healthy every week." }, "k");
    expect(g.state).toBe("BLOCKED");
    expect(g.stateReason).toMatch(/No plan template/);
    expect(adapter.sent).toHaveLength(0);
  });

  it("blocks an owner-approval goal (publish) at planning", async () => {
    const g = await submitGoal(deps(), { objective: "Research a product idea and publish it to the shop today." }, "k");
    expect(g.state).toBe("BLOCKED");
    expect(g.stateReason).toMatch(/approval/);
  });

  it("rejects bad goals before anything is stored", async () => {
    await expect(submitGoal(deps(), { objective: "" }, "k")).rejects.toThrow(/Write the goal/);
    await expect(submitGoal(deps(), { objective: OBJECTIVE, budgetUsd: 50 }, "k")).rejects.toThrow(/budget/);
    expect(await db.query("SELECT id FROM atlas.exec_goals")).toHaveLength(0);
  });

  it("fails the plan check when the budget is below the plan's cost (contradiction)", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE, budgetUsd: 0.2 }, "k");
    expect(g.state).toBe("FAILED");
    expect(g.stateReason).toMatch(/more than the goal's \$0.20 budget/);
    expect(g.tasks).toHaveLength(0);
  });
});

describe("agent discovery", () => {
  it("reads the same agents, statuses and buildings as the app's own catalog parser", () => {
    // Names may differ: the app shows some agents under operational display names; selection never uses names.
    const app = buildCatalog(files).catalog.agents.map((a) => ({ id: a.id, status: a.status, projectId: a.projectId }));
    const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
    expect(CATALOG_ROSTER.map(({ id, status, projectId }) => ({ id, status, projectId })).sort(byId)).toEqual([...app].sort(byId));
  });

  it("stays blocked while the catalog on main has Atlas Executive paused", async () => {
    const g = await submitGoal(deps({ roster: async () => CATALOG_ROSTER }), { objective: OBJECTIVE }, "k");
    expect(g.state).toBe("BLOCKED");
    expect(g.stateReason).toMatch(/No eligible agent/);
    expect(g.tasks.find((t) => t.key === "verify-and-report")?.blockedReason).toMatch(/status is paused/);
    expect(adapter.sent).toHaveLength(0);
  });

  it("blocks with the missing capability when no registered agent is eligible", async () => {
    const roster = ROSTER.map((a) => (a.id === "benjaire-product-lab-research" ? { ...a, status: "paused" } : a));
    const g = await submitGoal(deps({ roster: async () => roster }), { objective: OBJECTIVE }, "k");
    expect(g.state).toBe("BLOCKED");
    expect(g.stateReason).toMatch(/No eligible agent/);
    expect((await events(g.id, "capability.missing"))[0].detail).toMatch(/research.opportunity_report/);
    expect(adapter.sent).toHaveLength(0);
    // Once the agent is back, the next check assigns it.
    await tick(deps(), "test");
    expect((await goal(g.id)).state).toBe("EXECUTION_MONITORED");
  });

  it("blocks (and retries later) when the registry can't be read", async () => {
    const g = await submitGoal(
      deps({
        roster: async () => {
          throw new Error("GitHub answered 503");
        },
      }),
      { objective: OBJECTIVE },
      "k",
    );
    expect(g.state).toBe("BLOCKED");
    expect(g.stateReason).toMatch(/Agent Registry couldn't be read/);
  });
});

describe("authorization and approvals", () => {
  it("level 1 goal waits for an approval bound to the exact action; approve runs it", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE, autonomy: 1 }, "k");
    expect(g.state).toBe("AWAITING_APPROVAL");
    const [a] = await db.query<{ id: string; payload: { executive: { bindingHash: string } }; expires_at: Date }>("SELECT id, payload, expires_at FROM atlas.approvals");
    expect(a.payload.executive.bindingHash).toMatch(/^[0-9a-f]{64}$/);
    expect(adapter.sent).toHaveLength(0);
    // An agent can't approve its own request.
    await db.query("UPDATE atlas.approvals SET status = 'approved', reviewer = 'atlas-executive', decided_at = now() WHERE id = $1", [a.id]);
    await advance(deps(), g.id, "k");
    expect((await goal(g.id)).state).toBe("FAILED");
  });

  it("approval by Khaneil lets the task run", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE, autonomy: 1 }, "k");
    await db.query("UPDATE atlas.approvals SET status = 'approved', reviewer = 'khaneil@example.com', decided_at = now()");
    await advance(deps(), g.id, "k");
    expect((await goal(g.id)).state).toBe("EXECUTION_MONITORED");
    expect(adapter.sent).toHaveLength(1);
  });

  it("a changed action invalidates the approval", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE, autonomy: 1 }, "k");
    await db.query("UPDATE atlas.approvals SET status = 'approved', reviewer = 'khaneil@example.com', decided_at = now()");
    await db.query("UPDATE atlas.exec_tasks SET max_cost_usd = 0.9 WHERE plan_key = 'research'");
    await advance(deps(), g.id, "k");
    const v = await goal(g.id);
    expect(v.state).toBe("FAILED");
    expect((await research(g.id)).error).toMatch(/changed after it was approved/);
    expect(adapter.sent).toHaveLength(0);
  });

  it("rejection fails the goal; expiry marks the approval expired", async () => {
    const g1 = await submitGoal(deps(), { objective: OBJECTIVE, autonomy: 1 }, "k");
    await db.query("UPDATE atlas.approvals SET status = 'rejected', reviewer = 'khaneil@example.com', decided_at = now()");
    await advance(deps(), g1.id, "k");
    expect((await goal(g1.id)).state).toBe("FAILED");

    const g2 = await submitGoal(deps(), { objective: `${OBJECTIVE} Second.`, autonomy: 1 }, "k");
    clock += 49 * 3_600_000;
    await advance(deps(), g2.id, "k");
    expect((await goal(g2.id)).state).toBe("FAILED");
    const [a] = await db.query<{ status: string }>("SELECT status FROM atlas.approvals WHERE goal_id = $1", [g2.goalRecordId]);
    expect(a.status).toBe("expired");
  });
});

describe("dispatch safety", () => {
  it("never dispatches the same task twice under concurrent checks", async () => {
    const g = await submitGoal(deps({ adapter: mockAdapter(false) }), { objective: OBJECTIVE }, "k");
    expect((await research(g.id)).state).toBe("ready");
    await Promise.all([tick(deps(), "a"), tick(deps(), "b"), advance(deps(), g.id, "c")]);
    expect(adapter.sent).toHaveLength(1);
  });

  it("holds dispatch while the emergency stop is on", async () => {
    stopReason = "Emergency stop is on (test)";
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    expect(adapter.sent).toHaveLength(0);
    expect((await research(g.id)).blockedReason).toMatch(/Emergency stop/);
    stopReason = null;
    await tick(deps(), "t");
    expect(adapter.sent).toHaveLength(1);
  });

  it("one agent runs one task at a time; the next goal waits for the slot", async () => {
    const g1 = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    const g2 = await submitGoal(deps(), { objective: `${OBJECTIVE} Another one.` }, "k");
    expect(adapter.sent).toHaveLength(1);
    expect((await research(g2.id)).blockedReason).toMatch(/already running/);
    await receiveResult(deps(), resultFor(adapter.sent[0]));
    expect((await goal(g1.id)).state).toBe("GOAL_COMPLETED");
    expect(adapter.sent).toHaveLength(2);
  });

  it("respects the daily dispatch cap", async () => {
    await db.query("INSERT INTO atlas.exec_goals (objective, budget_usd, created_by) VALUES ('x seed goal', 1, 'k')");
    const [seed] = await db.query<{ id: string }>("SELECT id FROM atlas.exec_goals");
    for (let i = 0; i < 10; i++) await db.query("INSERT INTO atlas.exec_events (exec_goal_id, kind, actor) VALUES ($1, 'task.dispatched', 'x')", [seed.id]);
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    expect(adapter.sent).toHaveLength(0);
    expect((await research(g.id)).blockedReason).toMatch(/daily limit/);
  });

  it("refused dispatch retries, then fails after the attempt limit", async () => {
    adapter.next = [
      { state: "refused", error: "n8n refused the dispatch (404)." },
      { state: "refused", error: "again" },
      { state: "refused", error: "and again" },
    ];
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    expect(adapter.sent).toHaveLength(3);
    expect(new Set(adapter.sent.map((e) => e.idempotencyKey)).size).toBe(3);
    const v = await goal(g.id);
    expect(v.state).toBe("FAILED");
    expect(v.tasks.find((t) => t.key === "verify-and-report")?.state).toBe("cancelled");
  });
});

describe("timeouts, stalls and restart recovery", () => {
  it("a stalled attempt is retried after its lease runs out, and fails after the last one", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    for (let i = 1; i <= 3; i++) {
      expect(adapter.sent).toHaveLength(i);
      await leaseOut();
      await tick(deps(), "schedule");
    }
    const v = await goal(g.id);
    expect(v.state).toBe("FAILED");
    expect((await research(g.id)).error).toMatch(/Gave up after 3 attempts/);
    expect((await events(g.id, "task.stalled")).length).toBe(3);
  });

  it("an unclear send waits for the lease, and a fresh worker (restart) picks it up", async () => {
    adapter.next = [{ state: "unknown", error: "timeout" }];
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    expect((await research(g.id)).state).toBe("dispatching");
    // A restart: new adapter, nothing in memory. The database alone carries the state.
    adapter = mockAdapter();
    await tick(deps(), "after restart");
    expect(adapter.sent).toHaveLength(0);
    await leaseOut();
    await tick(deps(), "after restart");
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].attempt).toBe(2);
    await receiveResult(deps(), resultFor(adapter.sent[0]));
    expect((await goal(g.id)).state).toBe("GOAL_COMPLETED");
  });

  it("ignores a late result from an attempt that was already retried", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    const first = adapter.sent[0];
    await leaseOut();
    await tick(deps(), "t");
    const late = await receiveResult(deps(), resultFor(first));
    expect(late.body.stale).toBe(true);
    expect((await research(g.id)).attempts).toBe(2);
  });
});

describe("results: authentication, idempotency, verification", () => {
  const ENV: ExecutiveEnv = { N8N_BRIDGE_TOKEN: "t".repeat(40), N8N_BRIDGE_CALLBACK_TOKEN: "c".repeat(40) };
  const hook = (body: unknown, key = "c".repeat(40)) =>
    forHook(new Request("https://atlas.test/api/hooks/executive-result", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }), ENV, "result", { db, adapter, roster: async () => ROSTER, stop: async () => null });

  it("refuses a wrong key, a wrong nonce and a result for an attempt never sent", async () => {
    await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    const e = adapter.sent[0];
    expect((await hook(resultFor(e), "x".repeat(40))).status).toBe(401);
    expect((await hook(resultFor(e, { nonce: "f".repeat(32) }))).status).toBe(403);
    expect((await hook(resultFor(e, { attempt: 2, idempotencyKey: `${e.taskId}:2` }))).status).toBe(409);
    expect((await hook({ ...resultFor(e), taskId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    expect((await hook({ nonsense: true })).status).toBe(400);
  });

  it("stores a repeated callback once", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    const body = resultFor(adapter.sent[0]);
    expect((await hook(body)).status).toBe(202);
    const again = await hook(body);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect(await db.query("SELECT id FROM atlas.exec_artifacts")).toHaveLength(1);
    expect((await goal(g.id)).state).toBe("GOAL_COMPLETED");
  });

  it("never completes on the workflow's word: invented sources fail verification and retry", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    const bad = resultFor(adapter.sent[0], { searched: SAMPLE_URLS.slice(0, 1) });
    await receiveResult(deps(), bad);
    const r = await research(g.id);
    expect(r.state).toBe("running"); // retried: attempt 2 already dispatched
    expect(r.attempts).toBe(2);
    expect((await events(g.id, "verification.failed"))[0].detail).toMatch(/Sources came from the run's own web search/);
    expect((await goal(g.id)).state).toBe("EXECUTION_MONITORED");
  });

  it("a malformed report fails verification; an error report is retried when transient", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    await receiveResult(deps(), resultFor(adapter.sent[0], { report: { schema: "nope" } }));
    expect((await research(g.id)).attempts).toBe(2);
    await receiveResult(deps(), resultFor(adapter.sent[1], { contract: "ATLAS_EXECUTIVE_ERROR", kind: "failed", report: undefined, error: "Anthropic 529", transient: true }));
    expect((await research(g.id)).attempts).toBe(3);
    await receiveResult(deps(), resultFor(adapter.sent[2], { contract: "ATLAS_EXECUTIVE_ERROR", kind: "failed", report: undefined, error: "Anthropic 529", transient: true }));
    expect((await goal(g.id)).state).toBe("FAILED");
  });

  it("stops retrying when the budget can't cover another attempt", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE, budgetUsd: 0.7 }, "k");
    // A costly failed attempt (about $0.30) leaves less than the $0.60 cap for the next one.
    await receiveResult(deps(), resultFor(adapter.sent[0], { contract: "ATLAS_EXECUTIVE_ERROR", kind: "failed", report: undefined, error: "x", transient: true, usage: { model: "claude-sonnet-5-5", inputTokens: 100_000, outputTokens: 10_000, webSearches: 5 } }));
    const v = await goal(g.id);
    expect(v.state).toBe("FAILED");
    expect((await research(g.id)).error).toMatch(/Not enough budget/);
    expect(adapter.sent).toHaveLength(1);
  });
});

describe("owner controls", () => {
  it("pause stops new dispatches; resume continues", async () => {
    const g = await submitGoal(deps({ adapter: mockAdapter(false) }), { objective: OBJECTIVE }, "k");
    await pauseGoal(deps(), g.id, "k");
    await tick(deps(), "t");
    expect(adapter.sent).toHaveLength(0);
    await resumeGoal(deps(), g.id, "k");
    expect(adapter.sent).toHaveLength(1);
    expect((await goal(g.id)).state).toBe("EXECUTION_MONITORED");
  });

  it("cancel closes every unfinished task; a late result is recorded and ignored", async () => {
    const g = await submitGoal(deps(), { objective: OBJECTIVE }, "k");
    await cancelGoal(deps(), g.id, "k");
    const v = await goal(g.id);
    expect(v.state).toBe("CANCELLED");
    expect(v.tasks.every((t) => t.state === "cancelled")).toBe(true);
    const late = await receiveResult(deps(), resultFor(adapter.sent[0]));
    expect(late.body.stale).toBe(true);
    expect((await db.query<{ status: string }>("SELECT status FROM atlas.tasks")).every((t) => t.status === "cancelled")).toBe(true);
  });

  it("owner routes: submit, overview, tick", async () => {
    const env: ExecutiveEnv = {};
    const seams = { db, adapter, roster: async () => ROSTER, stop: async () => null };
    const call = (method: string, path: string, body?: unknown) =>
      forOwner(new Request(`https://atlas.test/api/executive/${path}`, { method, headers: { "cf-access-authenticated-user-email": "khaneil@example.com", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, path, seams);
    const created = await call("POST", "goals", { objective: OBJECTIVE });
    expect(created.status).toBe(201);
    const o = (await (await call("GET", "overview")).json()) as { goals: { state: string }[]; events: unknown[]; spend: { dispatchesToday: number } };
    expect(o.goals[0].state).toBe("EXECUTION_MONITORED");
    expect(o.events.length).toBeGreaterThan(5);
    expect(o.spend.dispatchesToday).toBe(1);
    expect((await call("POST", "tick")).status).toBe(200);
    expect((await call("POST", "goals", { objective: "" })).status).toBe(400);
  });
});

describe("n8n adapter", () => {
  const env = { N8N_BRIDGE_TOKEN: "t".repeat(40), N8N_BRIDGE_CALLBACK_TOKEN: "c".repeat(40) };
  const route = WORKFLOW_ROUTES["research.opportunity_report"];
  const envelope = { idempotencyKey: "k:1" } as DispatchEnvelope;
  it("maps answers and sends the header key to the mapped webhook only", async () => {
    let seen = "";
    const ok = n8nAdapter(env, (async (url: string, init: RequestInit) => {
      seen = `${url} ${(init.headers as Record<string, string>).authorization}`;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch);
    expect(await ok.dispatch(route, envelope)).toEqual({ state: "accepted" });
    expect(seen).toBe(`https://khancam15.app.n8n.cloud/webhook/atlas-executive-dispatch Bearer ${"t".repeat(40)}`);
    const notPublished = n8nAdapter(env, (async () => new Response("", { status: 404 })) as unknown as typeof fetch);
    expect((await notPublished.dispatch(route, envelope)).state).toBe("refused");
    const busy = n8nAdapter(env, (async () => new Response("", { status: 503 })) as unknown as typeof fetch);
    expect((await busy.dispatch(route, envelope)).state).toBe("unknown");
    const down = n8nAdapter(env, (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch);
    expect((await down.dispatch(route, envelope)).state).toBe("unknown");
    expect(n8nAdapter({}).configured).toBe(false);
  });
});

it("sample report is labelled as a development example", () => {
  expect(String(sampleReport().productName)).toMatch(/not research/);
});
