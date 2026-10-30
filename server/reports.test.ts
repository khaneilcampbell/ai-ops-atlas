import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { D1, D1Statement } from "./live";
import { KEEP_REPORTS, readReports, readReportsForApp, receiveReport } from "./reports";

const TOKEN = "a".repeat(43);
const SYNC = "s".repeat(43);
const NOW = Date.UTC(2026, 9, 30, 12);
const report = () => JSON.parse(readFileSync(new URL("../ops/opportunity-scout/fixtures/report.json", import.meta.url), "utf8"));

/** An in-memory stand-in for the D1 queries reports.ts makes. */
function fakeD1() {
  const reports: { id: number; agent: string; at: string; body: string }[] = [];
  const events: { kind: string; body: string }[] = [];
  let next = 1;
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT INTO agent_reports")) {
        const [agent, at, body] = args as string[];
        reports.push({ id: next++, agent, at, body });
      } else if (sql.startsWith("DELETE FROM agent_reports")) {
        const [agent, , keep] = args as [string, string, number];
        const kept = new Set(reports.filter((r) => r.agent === agent).slice(-keep).map((r) => r.id));
        for (let i = reports.length - 1; i >= 0; i--) if (reports[i].agent === agent && !kept.has(reports[i].id)) reports.splice(i, 1);
      } else if (sql.startsWith("INSERT INTO events")) {
        events.push({ kind: args[2] as string, body: args[5] as string });
      }
    },
    all: async <T,>() => {
      const [agent, limit] = args as [string, number];
      return { results: reports.filter((r) => r.agent === agent).reverse().slice(0, limit) as T[] };
    },
  });
  const db: D1 = { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
  return { db, reports, events };
}

const post = (body: unknown, token = TOKEN) =>
  new Request("https://x.pages.dev/api/hooks/reports", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const AGENT = "github-opportunity-scout";

describe("storing agent reports", () => {
  it("is off until the site has its database and key", async () => {
    expect((await receiveReport(post(report()), { AGENT_FEED_TOKEN: TOKEN })).status).toBe(503);
    expect((await receiveReport(post(report()), { LIVE: fakeD1().db })).status).toBe(503);
  });

  it("refuses a wrong key, bad JSON, a malformed report and anything too big", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN };
    expect((await receiveReport(post(report(), "b".repeat(43)), env)).status).toBe(401);
    expect((await receiveReport(post("{not json"), env)).status).toBe(400);
    expect((await receiveReport(post({ ...report(), extra: 1 }), env)).status).toBe(400);
    expect((await receiveReport(post({ ...report(), notes: ["x".repeat(400)].concat(Array(40).fill("y".repeat(390))) }), env)).status).toBe(413);
    expect(d.reports).toHaveLength(0);
  });

  it("stores a report and drops a one-line event into the live feed", async () => {
    const d = fakeD1();
    const res = await receiveReport(post(report()), { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN }, NOW);
    expect(res.status).toBe(202);
    expect(d.reports).toHaveLength(1);
    expect(d.reports[0].at).toBe(new Date(NOW).toISOString());
    expect(d.events).toEqual([{ kind: "agent_report", body: JSON.stringify({ agent: AGENT, detail: "2 ideas. Top: Audit service (score 4.2)." }) }]);
  });

  it(`keeps only the newest ${KEEP_REPORTS} per agent and reads them newest first`, async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN };
    for (let n = 0; n < KEEP_REPORTS + 3; n++) await receiveReport(post({ ...report(), model: `m${n}` }), env, NOW + n * 1000);
    expect(d.reports).toHaveLength(KEEP_REPORTS);
    const page = await (await readReports(new URL(`https://x/api/reports?agent=${AGENT}`), env)).json();
    expect(page.configured).toBe(true);
    expect(page.reports[0].body.model).toBe(`m${KEEP_REPORTS + 2}`);
    expect(page.reports.length).toBeLessThanOrEqual(10);
  });
});

describe("reading agent reports", () => {
  it("says when the site has no database, and refuses unknown agents", async () => {
    expect(await (await readReports(new URL(`https://x/api/reports?agent=${AGENT}`), {})).json()).toEqual({ configured: false, reports: [] });
    expect((await readReports(new URL("https://x/api/reports?agent=commerce-loop"), { LIVE: fakeD1().db })).status).toBe(400);
  });

  it("skips a stored row that no longer passes the check", async () => {
    const d = fakeD1();
    d.reports.push({ id: 1, agent: AGENT, at: "2026-10-30T00:00:00.000Z", body: JSON.stringify({ agent: AGENT }) });
    const page = await (await readReports(new URL(`https://x/api/reports?agent=${AGENT}`), { LIVE: d.db })).json();
    expect(page.reports).toEqual([]);
  });

  it("gives the Mac app the same reports with its sync key only", async () => {
    const d = fakeD1();
    await receiveReport(post(report()), { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN }, NOW);
    const get = (key: string) => new Request(`https://x.pages.dev/api/hooks/reports?agent=${AGENT}`, { headers: { authorization: `Bearer ${key}` } });
    expect((await readReportsForApp(get(SYNC), { LIVE: d.db })).status).toBe(503);
    expect((await readReportsForApp(get(TOKEN), { LIVE: d.db, USAGE_SYNC_TOKEN: SYNC })).status).toBe(401);
    const ok = await readReportsForApp(get(SYNC), { LIVE: d.db, USAGE_SYNC_TOKEN: SYNC });
    expect(ok.status).toBe(200);
    expect((await ok.json()).reports).toHaveLength(1);
  });
});
