import { describe, expect, it } from "vitest";
import { KEEP_ROWS, MAX_ROWS_PER_POST, readAgentUsage, readAgentUsageForApp, receiveAgentUsage } from "./agentUsage";
import type { D1, D1Statement } from "./live";

const TOKEN = "a".repeat(43);
const SYNC = "s".repeat(43);

/** An in-memory stand-in for the D1 queries agentUsage.ts makes. */
function fakeD1() {
  let next = 1;
  const rows: { id: number; at: string; agent: string; body: string }[] = [];
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT INTO agent_usage")) {
        const [at, agent, body] = args as string[];
        rows.push({ id: next++, at, agent, body });
      } else if (sql.startsWith("DELETE FROM agent_usage")) {
        const keep = new Set([...rows].sort((a, b) => b.id - a.id).slice(0, args[0] as number).map((r) => r.id));
        for (let i = rows.length - 1; i >= 0; i--) if (!keep.has(rows[i].id)) rows.splice(i, 1);
      }
    },
    all: async <T,>() => ({ results: [...rows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, args[0] as number) as T[] }),
  });
  const db: D1 = { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
  return { db, rows };
}

const row = (over: Record<string, unknown> = {}) => ({
  at: "2026-11-09T06:00:00Z",
  provider: "anthropic",
  model: "claude-opus-5-5",
  agent: "GitHub Merge Flow",
  project: "khaneilcampbell/ai-ops-atlas",
  requests: 1,
  input_tokens: 2400,
  output_tokens: 310,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cost_usd: 0.02,
  cost_type: "estimated",
  ...over,
});

const post = (body: unknown, token = TOKEN) =>
  new Request("https://x.pages.dev/api/hooks/usage", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("agent usage", () => {
  it("is off until the site has its database and key", async () => {
    expect((await receiveAgentUsage(post({ records: [row()] }), { AGENT_FEED_TOKEN: TOKEN })).status).toBe(503);
    expect((await receiveAgentUsage(post({ records: [row()] }), { LIVE: fakeD1().db })).status).toBe(503);
  });

  it("refuses a wrong key, bad JSON, empty or oversized batches, and rows that don't validate", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN };
    expect((await receiveAgentUsage(post({ records: [row()] }, "b".repeat(43)), env)).status).toBe(401);
    expect((await receiveAgentUsage(post("{nope"), env)).status).toBe(400);
    expect((await receiveAgentUsage(post({ records: [] }), env)).status).toBe(400);
    expect((await receiveAgentUsage(post({ records: [row({ input_tokens: -1 })] }), env)).status).toBe(400);
    expect((await receiveAgentUsage(post({ records: Array.from({ length: MAX_ROWS_PER_POST + 1 }, () => row()) }), env)).status).toBe(413);
    expect(d.rows).toHaveLength(0);
  });

  it("stores only the known fields and serves them to the page and, with the sync key, to the Mac", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN, USAGE_SYNC_TOKEN: SYNC };
    const res = await receiveAgentUsage(post({ records: [row({ prompt: "secret text" }), row({ provider: "" })] }), env);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ stored: 1, skipped: 1 });
    expect(d.rows[0].body).not.toContain("secret text");

    const page = (await (await readAgentUsage(env)).json()) as { configured: boolean; records: { agent: string; input_tokens: number }[] };
    expect(page.configured).toBe(true);
    expect(page.records[0]).toMatchObject({ agent: "GitHub Merge Flow", input_tokens: 2400 });

    const get = (token: string) => new Request("https://x.pages.dev/api/hooks/usage", { headers: { authorization: `Bearer ${token}` } });
    expect((await readAgentUsageForApp(get(TOKEN), env)).status).toBe(401);
    expect((await readAgentUsageForApp(get(SYNC), env)).status).toBe(200);
  });

  it("keeps only the newest rows", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN };
    const posts = Math.ceil(KEEP_ROWS / MAX_ROWS_PER_POST) + 1;
    for (let i = 0; i < posts; i++) await receiveAgentUsage(post({ records: Array.from({ length: MAX_ROWS_PER_POST }, () => row()) }), env);
    expect(d.rows.length).toBe(KEEP_ROWS);
    expect(Math.min(...d.rows.map((r) => r.id))).toBe(posts * MAX_ROWS_PER_POST - KEEP_ROWS + 1);
  });

  it("says when the site has no database", async () => {
    expect(await (await readAgentUsage({})).json()).toEqual({ configured: false, records: [] });
  });
});
