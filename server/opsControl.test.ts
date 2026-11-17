import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { D1, D1Statement } from "./live";
import { dispatchStep, type BridgeEnv } from "./n8nBridge";
import { opsControl, readStop } from "./opsControl";

// Phase 9 site-side emergency stop: the site refuses new n8n step sends while it's on, whichever
// client asks. Real in-memory SQLite; n8n is a mock fetcher that must never be called while stopped.

function sqliteD1(): D1 {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => db.prepare(sql).run(...(args as never[])),
    all: async <T,>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
}

const NOW = Date.parse("2026-11-17T12:00:00Z");
const control = (body: unknown, email = "owner@example.com") => new Request("https://x/api/ops/control", { method: "POST", headers: { "content-type": "application/json", "cf-access-authenticated-user-email": email }, body: JSON.stringify(body) });
const envelope = { envelopeVersion: 1, runId: "wfrun_1", taskId: "task_1", attemptId: "run_1", nodeId: "market-research", sourceAgentIds: [], destinationAgentId: "benjaire-product-lab-research", inputSchema: "goal-intake/1", outputSchema: "market-research/1", inputs: {}, artifacts: [], correlationId: "wfrun_1", idempotencyKey: "task_1:1", at: "2026-11-17T12:00:00Z" };
const step = () => new Request("https://x/api/n8n/steps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) });

describe("site emergency stop", () => {
  it("starts off, records who changed it, and validates the body", async () => {
    const LIVE = sqliteD1();
    expect(await readStop(LIVE)).toMatchObject({ active: false });
    expect((await opsControl(control({ active: "yes" }), { LIVE }, NOW)).status).toBe(400);
    const r = await (await opsControl(control({ active: true, reason: "Investigating\nn8n" }), { LIVE }, NOW)).json();
    expect(r).toMatchObject({ active: true, by: "owner@example.com", reason: "Investigating n8n" });
    expect((await LIVE.prepare("SELECT COUNT(*) AS n FROM ops_control_log").all<{ n: number }>()).results[0].n).toBe(1);
    expect((await opsControl(new Request("https://x", { method: "DELETE" }), { LIVE }, NOW)).status).toBe(405);
    expect((await opsControl(control({ active: true }), {}, NOW)).status).toBe(503);
  });

  it("refuses every new n8n step send while on, without calling n8n, and sends again after resume", async () => {
    const env: BridgeEnv = { LIVE: sqliteD1(), N8N_BRIDGE_TOKEN: "t".repeat(40), N8N_BRIDGE_CALLBACK_TOKEN: "c".repeat(40) };
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await opsControl(control({ active: true, reason: "stop" }), env, NOW);
    const held = await dispatchStep(step(), env, f, NOW);
    expect(held.status).toBe(423);
    expect(await held.json()).toMatchObject({ state: "refused" });
    expect(f).not.toHaveBeenCalled();
    await opsControl(control({ active: false }), env, NOW);
    expect(await (await dispatchStep(step(), env, f, NOW)).json()).toMatchObject({ state: "accepted" });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
