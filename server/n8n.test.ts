import { describe, expect, it } from "vitest";
import { DEFAULT_INSTANCE, instanceOf, intervalCron, n8nSnapshot, parseRun, readN8n, readN8nForApp, scheduleRules, summarize } from "./n8n";
import type { CheckCache } from "./properties";

const NOW = Date.parse("2026-11-10T17:00:00Z");
const KEY = "n8n_api_" + "k".repeat(40);
const SYNC = "s".repeat(43);

const WORKFLOWS = { data: [
  { id: "iQdSJGMQi6TBHlar", name: "Flow · 1 Intake", active: true, nodes: [{ name: "Webhook" }] },
  { id: "FXEm2O630Yw6h1iw", name: "Flow · 3 Reply reminders", active: true },
  { id: "u3B7KFesmHzyEimO", name: "Flow · 5 Missed run check", active: false },
  { id: "old", name: "Archived test", active: false, isArchived: true },
] };
const EXECUTIONS = { data: [
  { id: "901", workflowId: "FXEm2O630Yw6h1iw", status: "error", mode: "trigger", startedAt: "2026-11-10T14:00:00.000Z", stoppedAt: "2026-11-10T14:00:03.000Z" },
  { id: "900", workflowId: "FXEm2O630Yw6h1iw", status: "success", mode: "trigger", startedAt: "2026-11-10T10:00:00.000Z", stoppedAt: "2026-11-10T10:00:02.000Z" },
  { id: "850", workflowId: "FXEm2O630Yw6h1iw", status: "crashed", mode: "trigger", startedAt: "2026-11-08T10:00:00.000Z", stoppedAt: null },
  { id: "800", workflowId: "iQdSJGMQi6TBHlar", finished: true, mode: "webhook", startedAt: "2026-11-01T12:00:00.000Z", stoppedAt: "2026-11-01T12:00:04.000Z" },
] };

function fakeFetch(status = 200) {
  const calls: { url: string; key: string | null; method: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, key: new Headers(init?.headers).get("x-n8n-api-key"), method: init?.method ?? "GET" });
    if (status !== 200) return new Response("{}", { status });
    return Response.json(url.includes("/workflows") ? WORKFLOWS : EXECUTIONS);
  }) as typeof fetch;
  return { f, calls };
}

const memCache = (): CheckCache => {
  const m = new Map<string, unknown>();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) };
};

describe("n8n runs on the site", () => {
  it("asks for a key instead of guessing when none is set", async () => {
    const { f, calls } = fakeFetch();
    expect(await n8nSnapshot({}, null, f, NOW)).toEqual({ state: "not-configured", need: expect.stringContaining("N8N_API_KEY") });
    expect(calls).toEqual([]);
  });

  it("reads only with GET and the key in a header, never in the URL", async () => {
    const { f, calls } = fakeFetch();
    await n8nSnapshot({ N8N_API_KEY: KEY }, null, f, NOW);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
    expect(calls.every((c) => c.key === KEY && !c.url.includes(KEY) && c.url.startsWith(`${DEFAULT_INSTANCE}/api/v1/`))).toBe(true);
    expect(calls.find((c) => c.url.includes("/executions"))?.url).toContain("includeData=false");
  });

  it("summarizes each workflow's runs, newest first, and counts failures in the last day", () => {
    const rows = summarize(WORKFLOWS.data, EXECUTIONS.data, NOW);
    expect(rows.map((r) => r.name)).toEqual(["Flow · 1 Intake", "Flow · 3 Reply reminders", "Flow · 5 Missed run check"]);
    const reminders = rows[1];
    expect(reminders.runs.map((r) => r.id)).toEqual(["901", "900", "850"]);
    expect(reminders.failures24h).toBe(1);
    expect(rows[0].runs[0].status).toBe("success"); // finished with no status, from an older n8n
    expect(rows[2]).toMatchObject({ active: false, runs: [], failures24h: 0 });
    expect(JSON.stringify(rows)).not.toContain("nodes");
  });

  it("keeps unknown statuses as unknown, not success", () => {
    expect(parseRun({ id: 1, status: "paused-forever" })?.status).toBe("unknown");
    expect(parseRun({ id: 2 })?.status).toBe("unknown");
    expect(parseRun({})).toBeNull();
  });

  it("only talks to an https instance", () => {
    expect(instanceOf({ N8N_BASE_URL: "http://evil.example" })).toBe(DEFAULT_INSTANCE);
    expect(instanceOf({ N8N_BASE_URL: "https://other.app.n8n.cloud/path" })).toBe("https://other.app.n8n.cloud");
    expect(instanceOf({ N8N_BASE_URL: "not a url" })).toBe(DEFAULT_INSTANCE);
  });

  it("reuses one answer for a minute", async () => {
    const { f, calls } = fakeFetch();
    const cache = memCache();
    await n8nSnapshot({ N8N_API_KEY: KEY }, cache, f, NOW);
    await n8nSnapshot({ N8N_API_KEY: KEY }, cache, f, NOW);
    expect(calls).toHaveLength(2);
  });

  it("says plainly when n8n refuses the key", async () => {
    const r = await readN8n({ N8N_API_KEY: KEY }, null, fakeFetch(401).f);
    expect(r.status).toBe(502);
    expect(((await r.json()) as { message: string }).message).toContain("refused the API key");
  });

  it("serves the Mac app only with the sync key", async () => {
    const req = (auth?: string) => new Request("https://atlas.example/api/hooks/n8n", { headers: auth ? { authorization: auth } : {} });
    const env = { N8N_API_KEY: KEY, USAGE_SYNC_TOKEN: SYNC };
    expect((await readN8nForApp(req(), env, null, fakeFetch().f)).status).toBe(401);
    expect((await readN8nForApp(req("Bearer wrong"), env, null, fakeFetch().f)).status).toBe(401);
    expect((await readN8nForApp(req(`Bearer ${SYNC}`), { N8N_API_KEY: KEY }, null, fakeFetch().f)).status).toBe(503);
    const ok = await readN8nForApp(req(`Bearer ${SYNC}`), env, null, fakeFetch().f);
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toContain(KEY);
  });
});

describe("n8n schedules for the agents' routine", () => {
  it("reads Schedule Trigger intervals as cron", () => {
    expect(intervalCron({ field: "hours", hoursInterval: 4, triggerAtMinute: 48 })).toEqual({ cron: "48 */4 * * *" });
    expect(intervalCron({ triggerAtHour: 11 })).toEqual({ cron: "0 11 * * *" });
    expect(intervalCron({ field: "weeks", triggerAtDay: [4, 1], triggerAtHour: 10 })).toEqual({ cron: "0 10 * * 1,4" });
    expect(intervalCron({ field: "weeks", triggerAtDay: [0], triggerAtHour: 9, weeksInterval: 2 })).toEqual({ cron: "0 9 * * 0", everyWeeks: 2 });
    expect(intervalCron({ field: "cronExpression", expression: "0 20 7 * * *" })).toEqual({ cron: "20 7 * * *" });
    expect(intervalCron({ field: "cronExpression", expression: "={{ $json.cron }}" })).toBeNull();
  });
  it("lists every enabled schedule node and skips disabled ones", () => {
    const nodes = [
      { type: "n8n-nodes-base.scheduleTrigger", name: "Every 4 hours", parameters: { rule: { interval: [{ field: "hours", hoursInterval: 4, triggerAtMinute: 48 }] } } },
      { type: "n8n-nodes-base.scheduleTrigger", name: "Off", disabled: true, parameters: { rule: { interval: [{ triggerAtHour: 3 }] } } },
      { type: "n8n-nodes-base.cron", name: "Old cron", parameters: { triggerTimes: { item: [{ mode: "everyDay", hour: 7, minute: 20 }] } } },
      { type: "n8n-nodes-base.webhook", name: "Webhook" },
    ];
    expect(scheduleRules(nodes)).toEqual([
      { label: "Every 4 hours", cron: "48 */4 * * *" },
      { label: "Old cron", cron: "20 7 * * *" },
    ]);
  });
  it("carries the time zone and whether successful runs are kept", () => {
    const [w] = summarize([{ id: "a", name: "Inventory", active: true, nodes: [{ type: "n8n-nodes-base.scheduleTrigger", name: "Daily", parameters: { rule: { interval: [{ triggerAtHour: 7, triggerAtMinute: 20 }] } } }], settings: { timezone: "America/New_York", saveDataSuccessExecution: "none" } }], [], Date.parse("2026-11-18T12:00:00Z"));
    expect(w).toMatchObject({ schedules: [{ label: "Daily", cron: "20 7 * * *" }], timezone: "America/New_York", savesSuccess: false });
  });
});
