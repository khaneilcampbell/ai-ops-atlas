import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forAgent, forOwner, statusOf, type DataEnv } from "./api";
import { withDb, type Db } from "./db";
import { agentFor, parseKeys } from "./policy";

// The data API against a real PostgreSQL: PGlite (Postgres compiled to WebAssembly) by default, so
// the migration, constraints, triggers and every query run for real in CI with nothing to install.
// Set ATLAS_TEST_DATABASE_URL to an empty scratch database to run the same tests through the
// site's own postgres.js driver instead.

const UP = readFileSync(new URL("../../db/migrations/0001_atlas_core.sql", import.meta.url), "utf8");
const DOWN = readFileSync(new URL("../../db/migrations/0001_atlas_core.down.sql", import.meta.url), "utf8");
const KEY = "k".repeat(40);
const ENV: DataEnv = { ATLAS_DATA_KEYS: `task-writer:${KEY},unknown-agent:${"u".repeat(40)}` };
const BASE = "https://atlas.test";

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

function externalDb(url: string): Db {
  return { query: (text, params) => withDb({ ATLAS_DATABASE_URL: url }, (d) => d.query(text, params)), tx: (fn) => withDb({ ATLAS_DATABASE_URL: url }, (d) => d.tx(fn)) } as Db;
}

beforeAll(async () => {
  if (external) db = externalDb(external);
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
  if (pg) await pg.exec(UP);
  else await withDb({ ATLAS_DATABASE_URL: external! }, (d) => d.query(UP));
  await db.query("INSERT INTO atlas.schema_migrations (version, name) VALUES (1, 'atlas_core')");
});

const deps = () => ({ db, sink: () => {} });
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function owner(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: J }> {
  const req = new Request(`${BASE}/api/data/${path}`, { method, headers: { "content-type": "application/json", "cf-access-authenticated-user-email": "khaneil@example.com", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await forOwner(req, ENV, path.split("?")[0], deps());
  return { status: res.status, json: (await res.json()) as J };
}

async function agent(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, key = KEY): Promise<{ status: number; json: J }> {
  const req = new Request(`${BASE}/api/hooks/data/${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await forAgent(req, ENV, path.split("?")[0], deps());
  return { status: res.status, json: (await res.json()) as J };
}

let n = 0;
const idem = () => ({ "idempotency-key": `test-${Date.now()}-${++n}` });

async function seed() {
  const goal = (await owner("POST", "records/goals", { fields: { title: "Grow Benjaire revenue", area: "business", priority: "high", target_date: "2027-03-31" } })).json.record;
  const project = (await owner("POST", "records/projects", { fields: { title: "Launch the commerce pipeline", area: "business", goal_id: goal.id } })).json.record;
  const lifeGoal = (await owner("POST", "records/goals", { fields: { title: "Run a half marathon", area: "life" } })).json.record;
  return { goal, project, lifeGoal };
}

describe("migration", () => {
  it("creates every table with constraints, and the down file removes them", async () => {
    const tables = (await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'atlas' ORDER BY 1")).map((r) => r.table_name);
    expect(tables).toEqual(["agent_runs", "ai_notes", "approvals", "decisions", "documents", "goals", "idempotency_keys", "projects", "schema_migrations", "tasks"]);
    await expect(db.query("INSERT INTO atlas.tasks (title, area, status, origin, created_by, updated_by) VALUES ('x', 'business', 'done', 'owner', 'owner', 'owner')")).rejects.toThrow();
    await expect(db.query("INSERT INTO atlas.documents (title, doc_type, area, storage_url, origin, created_by, updated_by) VALUES ('x', 'note', 'business', 'http://plain', 'owner', 'owner', 'owner')")).rejects.toThrow();
    if (pg) await pg.exec(DOWN);
    else await withDb({ ATLAS_DATABASE_URL: external! }, (d) => d.query(DOWN));
    const left = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'atlas' AND table_name <> 'schema_migrations'");
    expect(left).toEqual([]);
  });

  it("bumps version and updated_at on every update", async () => {
    const [row] = await db.query<{ id: string; version: number }>("INSERT INTO atlas.goals (title, area, origin, created_by, updated_by) VALUES ('g', 'career', 'owner', 'owner', 'owner') RETURNING id, version");
    const [after] = await db.query<{ version: number }>("UPDATE atlas.goals SET title = 'g2' WHERE id = $1 RETURNING version", [row.id]);
    expect(after.version).toBe(row.version + 1);
  });
});

describe("keys and status", () => {
  it("accepts only listed key ids with long keys", () => {
    expect(parseKeys(`task-writer:${KEY},task-writer:short,nobody:${KEY}`).map((k) => k.id)).toEqual(["task-writer"]);
    const req = (auth: string) => new Request(BASE, { headers: { authorization: auth } });
    expect(agentFor(req(`Bearer ${KEY}`), ENV.ATLAS_DATA_KEYS)?.id).toBe("task-writer");
    expect(agentFor(req(`Bearer ${"u".repeat(40)}`), ENV.ATLAS_DATA_KEYS)).toBeNull();
    expect(agentFor(req(KEY), ENV.ATLAS_DATA_KEYS)).toBeNull();
  });

  it("refuses agents without a valid key", async () => {
    expect((await agent("GET", "context?q=x", undefined, {}, "wrong".repeat(10))).status).toBe(401);
  });

  it("says what is missing when no database is configured, without opening one", async () => {
    expect(await statusOf({})).toEqual({ state: "not-configured", need: expect.stringContaining("ATLAS_DB") });
    const res = await forOwner(new Request(`${BASE}/api/data/overview`), {}, "overview", { sink: () => {} });
    expect(res.status).toBe(503);
  });

  it("reports the schema version and key count, never the keys", async () => {
    const r = await owner("GET", "status");
    expect(r.json).toEqual({ state: "ok", schemaVersion: 1, agentKeys: 1 });
    expect(JSON.stringify(r.json)).not.toContain(KEY);
  });
});

describe("example flow: an n8n agent files a task and records its run", () => {
  it("starts a run, reads context, writes a task, finishes the run, and shows it all in the overview", async () => {
    const { goal, project } = await seed();
    const runKey = "n8n-exec-4711";

    const start = await agent("POST", "runs", { idempotencyKey: runKey, agentId: "task-writer", status: "running", workflowId: "wf-task-writer", inputRef: `project:${project.id}`, projectId: project.id });
    expect(start.status).toBe(201);
    const runId = start.json.run.id;

    const ctx = await agent("GET", `context?project=${project.id}`);
    expect(ctx.status).toBe(200);
    expect(ctx.json.project.title).toBe("Launch the commerce pipeline");
    expect(ctx.json.goal.id).toBe(goal.id);
    expect(ctx.json.tasks).toEqual([]);

    const taskId = "6f1d3c1e-9a43-4c1e-8f0e-2b7a1c9d0e11";
    const write = { id: taskId, runId, fields: { title: "Draft the Stripe product list", area: "business", priority: "high", due_date: "2026-12-05", project_id: project.id, goal_id: goal.id } };
    const created = await agent("POST", "records/tasks", write, { "idempotency-key": `${runKey}:task` });
    expect(created.status).toBe(201);
    expect(created.json.record).toMatchObject({ id: taskId, status: "queued", source: "agent", origin: "agent", created_by: "task-writer", owner_confirmed_at: null, version: 1 });

    // n8n retries the same request: same answer, no second row.
    const again = await agent("POST", "records/tasks", write, { "idempotency-key": `${runKey}:task` });
    expect(again.status).toBe(201);
    expect(again.json.replayed).toBe(true);
    expect((await db.query("SELECT count(*)::int AS n FROM atlas.tasks"))[0]).toEqual({ n: 1 });

    // The agent may update its own task.
    const upd = await agent("POST", "records/tasks", { id: taskId, fields: { status: "running" }, expectedVersion: 1 }, idem());
    expect(upd.json).toMatchObject({ result: "updated", record: { status: "running", version: 2 } });

    const done = await agent("POST", "runs", { idempotencyKey: runKey, agentId: "task-writer", status: "succeeded", resultSummary: "Filed 1 task.", taskId, model: "claude-sonnet", inputTokens: 1200, outputTokens: 300, costUsd: 0.0081 });
    expect(done.json.run).toMatchObject({ status: "succeeded", task_id: taskId, cost_usd: "0.0081" });
    expect(done.json.run.finished_at).toBeTruthy();
    // A late duplicate "finished" is harmless; a contradictory one is refused.
    expect((await agent("POST", "runs", { idempotencyKey: runKey, agentId: "task-writer", status: "succeeded" })).json.result).toBe("unchanged");
    expect((await agent("POST", "runs", { idempotencyKey: runKey, agentId: "task-writer", status: "failed", error: "late" })).status).toBe(409);

    const view = await owner("GET", "overview");
    expect(view.status).toBe(200);
    expect(view.json.runs[0]).toMatchObject({ agent_id: "task-writer", status: "succeeded", task_id: taskId });
    expect(view.json.records.map((r: J) => r.label)).toEqual(expect.arrayContaining(["Grow Benjaire revenue", "Launch the commerce pipeline", "Draft the Stripe product list"]));
    expect(view.json.counts).toMatchObject({ runs24h: 1, runsFailed24h: 0, tasksOpen: 1, approvalsPending: 0 });
  });

  it("records a failed run with its error", async () => {
    const r = await agent("POST", "runs", { idempotencyKey: "n8n-exec-9", agentId: "task-writer", status: "failed", error: "Model answer had no title." });
    expect(r.json.run).toMatchObject({ status: "failed", error: "Model answer had no title." });
    expect((await agent("POST", "runs", { idempotencyKey: "n8n-exec-10", agentId: "task-writer", status: "failed" })).status).toBe(400);
    expect((await agent("POST", "runs", { idempotencyKey: "n8n-exec-11", agentId: "someone-else", status: "running" })).status).toBe(403);
  });
});

describe("untrusted model output", () => {
  it("refuses bad statuses, lengths, ids, unknown fields and missing fields, writing nothing", async () => {
    const h = idem;
    expect((await agent("POST", "records/tasks", { fields: { title: "x", area: "business", status: "done" } }, h())).json.message).toContain("status must be one of");
    expect((await agent("POST", "records/tasks", { fields: { title: "x".repeat(201), area: "business" } }, h())).json.message).toContain("longer than 200");
    expect((await agent("POST", "records/tasks", { fields: { title: "x", area: "business", project_id: "not-a-uuid" } }, h())).json.message).toContain("UUID");
    expect((await agent("POST", "records/tasks", { fields: { title: "x", area: "business", origin: "owner" } }, h())).json.message).toContain('no field "origin"');
    expect((await agent("POST", "records/tasks", { fields: { area: "business" } }, h())).json.message).toContain("title is required");
    expect((await agent("POST", "records/tasks", { fields: { title: "x", area: "business", due_date: "2026-02-30" } }, h())).status).toBe(400);
    expect((await agent("POST", "records/tasks", { fields: { title: "bad\u0007bell", area: "business" } }, h())).status).toBe(400);
    expect((await agent("POST", "records/tasks", { fields: { title: "x", area: "business", project_id: "6f1d3c1e-9a43-4c1e-8f0e-2b7a1c9d0e99" } }, h())).status).toBe(422);
    expect((await agent("POST", "records/tasks", { fields: { title: "x", area: "business" } })).json.message).toContain("Idempotency-Key");
    expect((await db.query("SELECT count(*)::int AS n FROM atlas.tasks"))[0]).toEqual({ n: 0 });
  });

  it("refuses reusing an idempotency key for a different request", async () => {
    const h = idem();
    expect((await agent("POST", "records/tasks", { fields: { title: "one", area: "business" } }, h)).status).toBe(201);
    expect((await agent("POST", "records/tasks", { fields: { title: "two", area: "business" } }, h)).status).toBe(422);
  });

  it("refuses an oversized body", async () => {
    const r = await agent("POST", "records/tasks", { fields: { title: "x", area: "business", description: "y".repeat(70_000) } }, idem());
    expect(r.status).toBe(413);
  });
});

describe("least privilege", () => {
  it("keeps an agent to its areas and tables", async () => {
    const { lifeGoal, project } = await seed();
    expect((await agent("GET", `context?goal=${lifeGoal.id}`)).status).toBe(404);
    expect((await agent("POST", "records/tasks", { fields: { title: "x", area: "life" } }, idem())).status).toBe(403);
    expect((await agent("POST", "records/goals", { fields: { title: "x", area: "business" } }, idem())).status).toBe(403);
    expect((await agent("POST", "records/tasks", { fields: { title: "x", area: "business", goal_id: lifeGoal.id } }, idem())).status).toBe(422);
    expect((await agent("GET", "overview")).status).toBe(403);
    expect((await agent("GET", `context?q=marathon`)).json.search).toEqual([]);
    expect((await agent("GET", `context?q=commerce`)).json.search.map((s: J) => s.id)).toEqual([project.id]);
  });

  it("never shows an agent restricted or private documents", async () => {
    const { project } = await seed();
    for (const access_category of ["internal", "private", "restricted"]) await owner("POST", "records/documents", { fields: { title: `Doc ${access_category}`, doc_type: "contract", area: "business", access_category, project_id: project.id, storage_url: "https://drive.example.com/d/1" } });
    const docs = (await agent("GET", `context?project=${project.id}`)).json.documents.map((d: J) => d.title);
    expect(docs).toEqual(["Doc internal"]);
    expect((await owner("GET", `context?project=${project.id}`)).json.documents).toHaveLength(3);
    expect((await agent("POST", "records/documents", { fields: { title: "x", doc_type: "note", area: "business", access_category: "restricted" } }, idem())).status).toBe(403);
  });

  it("only Khaneil decides approvals", async () => {
    const a = (await agent("POST", "approvals", { kind: "external_message", proposedAction: "Email the supplier a reorder", area: "business" }, idem())).json.approval;
    expect((await agent("POST", `approvals/${a.id}/decision`, { decision: "approve" }, idem())).status).toBe(403);
  });
});

describe("approvals protect Khaneil's facts", () => {
  it("turns an agent's change to an owner record into a pending approval, applied only when approved", async () => {
    const { project } = await seed();
    const task = (await owner("POST", "records/tasks", { fields: { title: "Pick a payment provider", area: "business", project_id: project.id } })).json.record;
    expect(task.owner_confirmed_at).not.toBeNull();

    const tried = await agent("POST", "records/tasks", { id: task.id, fields: { status: "cancelled", title: "Drop payments" } }, idem());
    expect(tried.status).toBe(202);
    expect(tried.json.result).toBe("approval_required");
    const unchanged = (await owner("GET", `records/tasks/${task.id}`)).json.record;
    expect(unchanged).toMatchObject({ status: "queued", title: "Pick a payment provider", version: 1 });

    const pending = (await owner("GET", "overview")).json.approvals;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "fact_change", target_table: "tasks", target_id: task.id, requested_by: "task-writer", payload: { fields: { status: "cancelled", title: "Drop payments" }, baseVersion: 1 } });

    const decided = await owner("POST", `approvals/${pending[0].id}/decision`, { decision: "approve", note: "Fine" });
    expect(decided.json).toMatchObject({ result: "approved", approval: { reviewer: "khaneil@example.com" }, record: { status: "cancelled", title: "Drop payments", updated_by: "owner" } });
    expect((await owner("POST", `approvals/${pending[0].id}/decision`, { decision: "reject" })).status).toBe(409);
  });

  it("refuses to apply an approved change after the record moved on", async () => {
    const { project } = await seed();
    const tried = await agent("POST", "records/projects", { id: project.id, fields: { status: "paused" } }, idem());
    expect(tried.status).toBe(403); // task-writer can't write projects at all
    const task = (await owner("POST", "records/tasks", { fields: { title: "T", area: "business" } })).json.record;
    const ask = await agent("POST", "records/tasks", { id: task.id, fields: { priority: "low" } }, idem());
    await owner("POST", "records/tasks", { id: task.id, fields: { priority: "critical" } });
    const r = await owner("POST", `approvals/${ask.json.approval.id}/decision`, { decision: "approve" });
    expect(r.status).toBe(409);
    expect((await owner("GET", `records/tasks/${task.id}`)).json.record.priority).toBe("critical");
  });

  it("lets an agent check its own approval and see it expire", async () => {
    const a = (await agent("POST", "approvals", { kind: "financial", proposedAction: "Refund order 1001 ($40)", area: "business", expiresInHours: 1 }, idem())).json.approval;
    expect((await agent("GET", `approvals/${a.id}`)).json.approval.status).toBe("pending");
    await db.query("UPDATE atlas.approvals SET expires_at = now() - interval '1 minute' WHERE id = $1", [a.id]);
    expect((await agent("GET", `approvals/${a.id}`)).json.approval.status).toBe("expired");
    expect((await agent("POST", "approvals", { kind: "fact_change", proposedAction: "x", area: "business" }, idem())).status).toBe(400);
  });

  it("keeps AI notes apart from the facts", async () => {
    const { project } = await seed();
    const r = await agent("POST", "notes", { subjectTable: "projects", subjectId: project.id, kind: "recommendation", body: "Start with three products." }, idem());
    expect(r.status).toBe(201);
    const ctx = (await agent("GET", `context?project=${project.id}`)).json;
    expect(ctx.aiNotes[0]).toMatchObject({ body: "Start with three products.", ai_generated: true, agent_id: "task-writer" });
    expect(ctx.project.description).toBeNull();
  });
});

describe("concurrency", () => {
  it("writes once when the same request arrives twice at the same moment", async () => {
    const h = idem();
    const body = { fields: { title: "Only once", area: "business" } };
    const [a, b] = await Promise.all([agent("POST", "records/tasks", body, h), agent("POST", "records/tasks", body, h)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.json.replayed, b.json.replayed].filter(Boolean)).toHaveLength(1);
    expect((await db.query("SELECT count(*)::int AS n FROM atlas.tasks"))[0]).toEqual({ n: 1 });
  });

  it("records one run when start and a retry race", async () => {
    const body = { idempotencyKey: "n8n-exec-race", agentId: "task-writer", status: "running" };
    await Promise.all([agent("POST", "runs", body), agent("POST", "runs", body)]);
    expect((await db.query("SELECT count(*)::int AS n FROM atlas.agent_runs"))[0]).toEqual({ n: 1 });
  });
});
