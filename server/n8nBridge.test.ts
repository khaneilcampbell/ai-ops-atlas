import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { DAILY_DISPATCH_CAP, toExecutionReport } from "../src/execution/n8nBridge";
import type { D1, D1Statement } from "./live";
import { dispatchStep, forApp, readStepReports, receiveStepReport, type BridgeEnv } from "./n8nBridge";

/** D1 on a real in-memory SQLite, so the SQL itself is tested. */
function sqliteD1(): D1 {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    all: async <T,>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
}

const TOKEN = "t".repeat(40);
const CALLBACK = "c".repeat(40);
const SYNC = "s".repeat(40);
const env = (): BridgeEnv => ({ LIVE: sqliteD1(), N8N_BRIDGE_TOKEN: TOKEN, N8N_BRIDGE_CALLBACK_TOKEN: CALLBACK, USAGE_SYNC_TOKEN: SYNC });
const NOW = Date.parse("2026-11-15T12:00:00Z");

const envelope = (over: Record<string, unknown> = {}) => ({
  envelopeVersion: 1,
  runId: "wfrun_1",
  taskId: "task_1",
  attemptId: "run_1",
  nodeId: "market-research",
  sourceAgentIds: [],
  destinationAgentId: "benjaire-product-lab-research",
  inputSchema: "goal-intake/1",
  outputSchema: "market-research/1",
  inputs: {},
  artifacts: [],
  correlationId: "wfrun_1",
  idempotencyKey: "task_1:1",
  at: "2026-11-15T12:00:00Z",
  ...over,
});
const post = (url: string, body: unknown, auth?: string) => new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
const ok = () => vi.fn(async () => new Response("{}", { status: 200 }));

describe("dispatch", () => {
  it("requests racing with the same key reach n8n once", async () => {
    const e = env();
    const f = ok();
    const answers = await Promise.all([1, 2, 3].map(async () => (await dispatchStep(post("https://x/api/n8n/steps", envelope()), e, f, NOW)).json()));
    expect(f).toHaveBeenCalledTimes(1);
    expect(answers.filter((a) => a.state === "accepted" && !a.duplicate)).toHaveLength(1);
  });

  it("looks up one step: no record before it was sent, then its send state and reports", async () => {
    const e = env();
    const look = async () => (await readStepReports(new URL("https://x/api/n8n/steps?idem=task_1:1"), e)).json();
    expect(await look()).toEqual({ configured: true, dispatch: null, reports: [] });
    await dispatchStep(post("https://x", envelope()), e, ok(), NOW);
    await receiveStepReport(post("https://x", { eventId: "e1", idempotencyKey: "task_1:1", runId: "wfrun_1", nodeId: "market-research", attemptId: "run_1", kind: "failed", error: "The model call failed.", transient: true, at: "2026-11-15T12:01:00Z" }, CALLBACK), e, NOW);
    const l = await look();
    expect(l.dispatch).toMatchObject({ state: "accepted" });
    expect(l.reports.map((r: { eventId: string }) => r.eventId)).toEqual(["e1"]);
    expect((await readStepReports(new URL("https://x/api/n8n/steps?idem=bad%20key"), e)).status).toBe(400);
    expect(await (await readStepReports(new URL("https://x/api/n8n/steps?idem=task_1:1"), { LIVE: sqliteD1() })).json()).not.toHaveProperty("dispatch");
  });

  it("sends an allow-listed step once, with the token, and answers repeats from the record", async () => {
    const e = env();
    const f = ok();
    const r1 = await (await dispatchStep(post("https://x/api/n8n/steps", envelope()), e, f, NOW)).json();
    expect(r1).toEqual({ state: "accepted" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://khancam15.app.n8n.cloud/webhook/atlas-step-runner");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    const r2 = await (await dispatchStep(post("https://x/api/n8n/steps", envelope()), e, f, NOW)).json();
    expect(r2).toMatchObject({ state: "accepted", duplicate: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses steps outside the allow-list, so approvals and publishing can't be started this way", async () => {
    for (const nodeId of ["publish", "approve-launch", "develop", "monitor"]) {
      const f = ok();
      const res = await dispatchStep(post("https://x", envelope({ nodeId })), env(), f, NOW);
      expect(res.status).toBe(400);
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("refuses when not set up, malformed, oversized or over the daily cap", async () => {
    expect((await dispatchStep(post("https://x", envelope()), { LIVE: sqliteD1() }, ok(), NOW)).status).toBe(503);
    expect((await dispatchStep(post("https://x", envelope({ artifacts: [{ id: "a", label: "a", url: "http://insecure" }] })), env(), ok(), NOW)).status).toBe(400);
    expect((await dispatchStep(post("https://x", envelope({ inputs: { x: "y".repeat(70_000) } })), env(), ok(), NOW)).status).toBe(413);
    const e = env();
    for (let i = 0; i < DAILY_DISPATCH_CAP; i++) await dispatchStep(post("https://x", envelope({ idempotencyKey: `task_1:${i + 1}`, attemptId: `run_${i}` })), e, ok(), NOW);
    const over = await dispatchStep(post("https://x", envelope({ idempotencyKey: "task_9:1" })), e, ok(), NOW);
    expect(over.status).toBe(429);
  });

  it("an unclear answer is reported as unknown, never as failed, and isn't re-sent", async () => {
    const e = env();
    const boom = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect(await (await dispatchStep(post("https://x", envelope()), e, boom as never, NOW)).json()).toMatchObject({ state: "unknown" });
    const again = ok();
    expect(await (await dispatchStep(post("https://x", envelope()), e, again, NOW)).json()).toMatchObject({ state: "unknown", duplicate: true });
    expect(again).not.toHaveBeenCalled();
    const e2 = env();
    expect(await (await dispatchStep(post("https://x", envelope()), e2, vi.fn(async () => new Response("", { status: 502 })), NOW)).json()).toMatchObject({ state: "unknown" });
    expect(await (await dispatchStep(post("https://x", envelope({ idempotencyKey: "task_2:1" })), e2, vi.fn(async () => new Response("", { status: 403 })), NOW)).json()).toMatchObject({ state: "refused" });
  });
});

describe("reports", () => {
  const report = (over: Record<string, unknown> = {}) => ({ eventId: "ev1", idempotencyKey: "task_1:1", runId: "wfrun_1", nodeId: "market-research", attemptId: "run_1", kind: "succeeded", at: "2026-11-15T12:05:00Z", output: { schema: "market-research/1", fields: { ideas: ["a"] }, artifacts: [] }, source: { kind: "person", id: "khaneil", name: "forged" }, ...over });

  async function sent() {
    const e = env();
    await dispatchStep(post("https://x", envelope()), e, ok(), NOW);
    return e;
  }

  it("needs the callback key, not the sync or webhook key", async () => {
    const e = await sent();
    expect((await receiveStepReport(post("https://x", report()), e, NOW)).status).toBe(401);
    expect((await receiveStepReport(post("https://x", report(), TOKEN), e, NOW)).status).toBe(401);
    expect((await receiveStepReport(post("https://x", report(), SYNC), e, NOW)).status).toBe(401);
    expect((await receiveStepReport(post("https://x", report(), CALLBACK), e, NOW)).status).toBe(202);
  });

  it("only for steps Atlas sent, under the same run and attempt", async () => {
    const e = await sent();
    expect((await receiveStepReport(post("https://x", report({ idempotencyKey: "task_x:1" }), CALLBACK), e, NOW)).status).toBe(404);
    expect((await receiveStepReport(post("https://x", report({ attemptId: "run_other" }), CALLBACK), e, NOW)).status).toBe(409);
    expect((await receiveStepReport(post("https://x", report({ runId: "wfrun_2" }), CALLBACK), e, NOW)).status).toBe(409);
    expect((await receiveStepReport(post("https://x", report({ nodeId: "publish" }), CALLBACK), e, NOW)).status).toBe(400);
  });

  it("stores each report id once and hands it back with the source set by the site", async () => {
    const e = await sent();
    await receiveStepReport(post("https://x", report(), CALLBACK), e, NOW);
    await receiveStepReport(post("https://x", report(), CALLBACK), e, NOW);
    const read = (await (await readStepReports(new URL("https://x/api/n8n/steps?since=0"), e)).json()) as { reports: unknown[]; cursor: number };
    expect(read.reports).toHaveLength(1);
    const rep = toExecutionReport(read.reports[0] as never);
    expect(rep.source).toEqual({ kind: "n8n", id: "atlas-step-runner", name: "n8n step runner" });
    const after = (await (await readStepReports(new URL(`https://x/api/n8n/steps?since=${read.cursor}`), e)).json()) as { reports: unknown[] };
    expect(after.reports).toHaveLength(0);
  });

  it("deletes records older than 30 days", async () => {
    const e = await sent();
    await receiveStepReport(post("https://x", report(), CALLBACK), e, NOW);
    await dispatchStep(post("https://x", envelope({ idempotencyKey: "task_3:1" })), e, ok(), NOW + 31 * 86_400_000);
    const read = (await (await readStepReports(new URL("https://x/api/n8n/steps"), e)).json()) as { reports: unknown[] };
    expect(read.reports).toHaveLength(0);
  });
});

describe("Mac app route", () => {
  it("needs the sync key", async () => {
    const e = env();
    expect((await forApp(new Request("https://x/api/hooks/n8n-steps?status=1"), e)).status).toBe(401);
    expect(await (await forApp(new Request("https://x/api/hooks/n8n-steps?status=1", { headers: { authorization: `Bearer ${SYNC}` } }), e)).json()).toEqual({ configured: true });
  });
});
