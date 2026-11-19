import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { STARTABLE, TOTAL_DAILY_CAP } from "../src/n8n/startable";
import type { D1, D1Statement } from "./live";
import { readStarts, sha256, startForApp, startWorkflow, type StartEnv } from "./n8nStart";

function sqliteD1(): D1 {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    all: async <T,>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
}

const SECRET = "k".repeat(48);
const SYNC = "s".repeat(40);
const NOW = Date.parse("2026-11-19T12:00:00Z");
const env = (over: Partial<StartEnv> = {}): StartEnv => ({ LIVE: sqliteD1(), N8N_START_SECRET: SECRET, USAGE_SYNC_TOKEN: SYNC, ...over });
const idea = { name: "90-Day Planner", product_type: "doc", audience: "new freelancers", price: 19, notes: "" };
const body = (over: Record<string, unknown> = {}) => ({ workflow: "product-idea", input: idea, idempotencyKey: "task_1:1", taskId: "task_1", ...over });
const post = (b: unknown, auth?: string) => new Request("https://x/api/n8n/start", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(b) });
const started = (execId = "812") => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ accepted: true, executionId: execId }, { status: 202 }));

/** Checks a token the way n8n's JWT auth does: HS256 over header.body with the shared secret. */
function verify(token: string, secret: string) {
  const [h, b, s] = token.split(".");
  const want = createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url");
  return { valid: want === s, header: JSON.parse(Buffer.from(h, "base64url").toString()), claims: JSON.parse(Buffer.from(b, "base64url").toString()) };
}

describe("starting an allow-listed n8n workflow", () => {
  it("signs a short-lived token bound to this workflow, this start and this exact payload", async () => {
    const f = started();
    const res = await (await startWorkflow(post(body()), env(), f, NOW)).json();
    expect(res).toEqual({ state: "accepted", executionId: "812", executionUrl: "https://khancam15.app.n8n.cloud/workflow/1Dc7L3hYKdbTWL2F/executions/812" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://khancam15.app.n8n.cloud/webhook/atlas-start-product-idea");
    const token = String((init!.headers as Record<string, string>).authorization).replace("Bearer ", "");
    const t = verify(token, SECRET);
    expect(t.valid).toBe(true);
    expect(t.header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(t.claims).toMatchObject({ iss: "atlas-site", aud: "product-idea", jti: "task_1:1", task: "task_1", iat: NOW / 1000, exp: NOW / 1000 + 120 });
    const sent = JSON.parse(String(init!.body)) as { payload: string };
    expect(t.claims.sha).toBe(await sha256(sent.payload));
    expect(JSON.parse(sent.payload)).toEqual(idea);
    expect(String(init!.body)).not.toContain(SECRET);
    expect(token).not.toContain(SECRET);
  });

  it("refuses anything off the allow-list, bad input and bad keys without calling n8n", async () => {
    const f = started();
    const e = env();
    const cases = [
      body({ workflow: "flow-intake" }),
      body({ workflow: "constructor" }),
      body({ input: { ...idea, price: 1000 } }),
      body({ input: { ...idea, product_type: "video" } }),
      body({ input: { ...idea, name: "" } }),
      body({ idempotencyKey: "has spaces" }),
      body({ workflow: "career-job", input: { job_url: "http://insecure.example/job" } }),
      body({ workflow: "career-job", input: { job_text: "too short" } }),
    ];
    for (const c of cases) expect((await (await startWorkflow(post(c), e, f, NOW)).json()).state).toBe("refused");
    expect(f).not.toHaveBeenCalled();
  });

  it("drops fields the schema doesn't name", async () => {
    const f = started();
    await startWorkflow(post(body({ input: { ...idea, status: "published", price_cents: 1 } })), env(), f, NOW);
    expect(JSON.parse(JSON.parse(String(f.mock.calls[0][1]!.body)).payload)).toEqual(idea);
  });

  it("sends each start once, even when requests race or come back later", async () => {
    const f = started();
    const e = env();
    const answers = await Promise.all([1, 2, 3].map(async () => (await startWorkflow(post(body()), e, f, NOW)).json()));
    expect(f).toHaveBeenCalledTimes(1);
    expect(answers.filter((a) => a.state === "accepted" && !a.duplicate)).toHaveLength(1);
    const again = await (await startWorkflow(post(body()), e, f, NOW + 60_000)).json();
    expect(again).toMatchObject({ state: "accepted", duplicate: true, executionId: "812" });
    expect(f).toHaveBeenCalledTimes(1);
    expect((await (await startWorkflow(post(body({ workflow: "career-job", input: { job_url: "https://jobs.example/1" } })), e, f, NOW)).json()).state).toBe("refused");
  });

  it("keeps to each workflow's daily cap and the total cap", async () => {
    const e = env();
    const f = started();
    const career = STARTABLE.find((w) => w.key === "career-job")!;
    for (let i = 0; i < career.dailyCap; i++) await startWorkflow(post(body({ workflow: "career-job", input: { job_url: "https://jobs.example/1" }, idempotencyKey: `c:${i}` })), e, f, NOW);
    const over = await (await startWorkflow(post(body({ workflow: "career-job", input: { job_url: "https://jobs.example/1" }, idempotencyKey: "c:x" })), e, f, NOW)).json();
    expect(over.state).toBe("refused");
    expect(over.error).toMatch(/3 times/);
    // The next day it's allowed again.
    expect((await (await startWorkflow(post(body({ workflow: "career-job", input: { job_url: "https://jobs.example/1" }, idempotencyKey: "c:y" })), e, f, NOW + 86_400_001)).json()).state).toBe("accepted");
    expect(TOTAL_DAILY_CAP).toBeGreaterThanOrEqual(STARTABLE.reduce((s, w) => Math.max(s, w.dailyCap), 0));
  });

  it("says plainly what n8n answered", async () => {
    const answer = async (r: Response | Error) => (await startWorkflow(post(body({ idempotencyKey: `k:${Math.random().toString(36).slice(2)}` })), env(), vi.fn(async () => (r instanceof Error ? Promise.reject(r) : r)), NOW)).json();
    expect(await answer(Response.json({ accepted: false, reason: "The token has expired." }, { status: 422 }))).toMatchObject({ state: "refused", error: expect.stringContaining("expired") });
    expect(await answer(new Response("", { status: 404 }))).toMatchObject({ state: "refused", error: expect.stringContaining("published") });
    expect(await answer(new Response("", { status: 403 }))).toMatchObject({ state: "refused", error: expect.stringContaining("Atlas start (JWT)") });
    expect(await answer(new Response("", { status: 502 }))).toMatchObject({ state: "unknown" });
    expect(await answer(new Error("timeout"))).toMatchObject({ state: "unknown" });
  });

  it("won't start anything without the secret, or while the emergency stop is on", async () => {
    const f = started();
    expect((await startWorkflow(post(body()), env({ N8N_START_SECRET: "short" }), f, NOW)).status).toBe(503);
    const e = env();
    await e.LIVE!.batch([
      e.LIVE!.prepare("CREATE TABLE IF NOT EXISTS ops_control (id INTEGER PRIMARY KEY, active INTEGER NOT NULL, at TEXT, by TEXT, reason TEXT)"),
      e.LIVE!.prepare("INSERT INTO ops_control (id, active, at, by, reason) VALUES (1, 1, '2026-11-19T11:00:00Z', 'khaneil', 'test')"),
    ]);
    expect((await startWorkflow(post(body()), e, f, NOW)).status).toBe(423);
    expect(f).not.toHaveBeenCalled();
  });

  it("reports status and one start's record; the Mac route needs the sync key", async () => {
    const e = env();
    expect(await (await readStarts(new URL("https://x/api/n8n/start?status=1"), e)).json()).toEqual({ configured: true });
    expect(await (await readStarts(new URL("https://x/api/n8n/start?idem=task_1:1"), e)).json()).toEqual({ configured: true, start: null });
    await startWorkflow(post(body()), e, started("900"), NOW);
    expect((await (await readStarts(new URL("https://x/api/n8n/start?idem=task_1:1"), e)).json()).start).toMatchObject({ workflow: "product-idea", state: "accepted", executionId: "900" });
    const f = started();
    expect((await startForApp(post(body({ idempotencyKey: "m:1" }), "wrong"), e, f)).status).toBe(401);
    expect((await startForApp(post(body({ idempotencyKey: "m:1" }), SYNC), e, f)).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
