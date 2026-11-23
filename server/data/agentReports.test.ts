import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forAgent, forOwner, type DataEnv } from "./api";
import type { Db } from "./db";

// GET reports/agents: counts only, read by the self-reports key; other agent keys are refused.
const CORE = readFileSync(new URL("../../db/migrations/0001_atlas_core.sql", import.meta.url), "utf8");
const MEMORY = readFileSync(new URL("../../db/migrations/0003_agent_memory.sql", import.meta.url), "utf8");
const WRITER = "w".repeat(40), REPORTS = "r".repeat(40);
const ENV: DataEnv = { ATLAS_DATA_KEYS: `task-writer:${WRITER},self-reports:${REPORTS}` };
let pg: PGlite;
let db: Db;
beforeAll(() => {
  pg = new PGlite();
  db = { query: async <T,>(t: string, p: unknown[] = []) => (await pg.query<T>(t, p)).rows, tx: (fn) => pg.transaction((t) => fn({ query: async <T,>(q: string, p: unknown[] = []) => (await t.query<T>(q, p)).rows, tx: (f) => f(db) } as Db)) } as Db;
});
afterAll(async () => pg.close());
beforeEach(async () => {
  await db.query("DROP SCHEMA IF EXISTS atlas CASCADE");
  await pg.exec(CORE);
  await db.query("INSERT INTO atlas.schema_migrations (version, name) VALUES (1, 'atlas_core')");
});
const deps = () => ({ db, sink: () => {} });
const get = async (key: string | null) => {
  const req = new Request("https://atlas.test/api/hooks/data/reports/agents", { headers: key ? { authorization: `Bearer ${key}` } : { "cf-access-authenticated-user-email": "k@example.com" } });
  const res = key ? await forAgent(req, ENV, "reports/agents", deps()) : await forOwner(req, ENV, "reports/agents", deps());
  return { status: res.status, json: (await res.json()) as { message?: string; windowDays?: number; agents?: Record<string, unknown>[] } };
};
const run = (agent: string, status: string, cost: number | null, key: string) =>
  db.query("INSERT INTO atlas.agent_runs (agent_id, idempotency_key, status, cost_usd, input_tokens, output_tokens, result_summary) VALUES ($1, $2, $3, $4, 10, 5, 'secret summary')", [agent, key, status, cost]);

describe("reports/agents", () => {
  it("counts runs per catalog agent and maps an agent key to its catalog entry", async () => {
    await run("task-writer", "succeeded", 0.02, "run-key-0001");
    await run("task-writer", "failed", null, "run-key-0002");
    await run("dataset-census", "succeeded", null, "run-key-0003");
    const { status, json } = await get(REPORTS);
    expect(status).toBe(200);
    expect(json.windowDays).toBe(30);
    const writer = json.agents!.find((a) => a.catalogId === "atlas-task-writer")!;
    expect(writer).toMatchObject({ runs: 2, succeeded: 1, failed: 1, inputTokens: 20, outputTokens: 10, costUsd: 0.02, memoryItems: 0 });
    expect(json.agents!.find((a) => a.catalogId === "dataset-census")).toMatchObject({ runs: 1, succeeded: 1 });
    expect(JSON.stringify(json)).not.toContain("secret summary");
  });

  it("counts memory items and feedback once the memory migration is applied", async () => {
    await pg.exec(MEMORY);
    await db.query("INSERT INTO atlas.schema_migrations (version, name) VALUES (3, 'agent_memory')");
    await run("task-writer", "succeeded", null, "run-key-0004");
    await db.query("INSERT INTO atlas.memory_items (category, title, content, area, agent_id, source_kind, source_ref, origin, created_by, updated_by) VALUES ('operational', 'Lesson', 'Do X first', 'projects', 'task-writer', 'run', 'run-1', 'agent', 'task-writer', 'task-writer')");
    const { json } = await get(REPORTS);
    expect(json.agents!.find((a) => a.catalogId === "atlas-task-writer")).toMatchObject({ runs: 1, memoryItems: 1 });
  });

  it("refuses agent keys without agent reports, and lets Khaneil read it", async () => {
    expect((await get(WRITER)).status).toBe(403);
    expect((await get(null)).status).toBe(200);
  });
});
