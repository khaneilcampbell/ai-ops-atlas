import { describe, expect, it } from "vitest";
import { sample } from "../src/inquiries/fixtures";
import type { D1, D1Statement } from "./live";
import { readInquiries, readInquiriesForApp, receiveInquiry } from "./inquiries";

const TOKEN = "a".repeat(43);
const SYNC = "s".repeat(43);
const NOW = Date.parse("2026-11-01T06:01:00.000Z");

/** An in-memory stand-in for the D1 queries inquiries.ts makes. */
function fakeD1() {
  const rows = new Map<string, { received_at: string; body: string }>();
  const events: { kind: string; body: string }[] = [];
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT OR IGNORE INTO inquiries")) {
        const [id, received_at, body] = args as string[];
        if (!rows.has(id)) rows.set(id, { received_at, body });
      } else if (sql.startsWith("DELETE FROM inquiries")) {
        for (const [id, r] of rows) if (r.received_at < (args[0] as string)) rows.delete(id);
      } else if (sql.startsWith("INSERT INTO events")) {
        events.push({ kind: args[2] as string, body: args[5] as string });
      }
    },
    all: async <T,>() => ({ results: [...rows.values()].sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, args[0] as number) as T[] }),
  });
  const db: D1 = { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
  return { db, rows, events };
}

const post = (body: unknown, token = TOKEN) =>
  new Request("https://x.pages.dev/api/hooks/inquiries", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("the inquiry inbox", () => {
  it("is off until the site has its database and key", async () => {
    expect((await receiveInquiry(post(sample()), { AGENT_FEED_TOKEN: TOKEN })).status).toBe(503);
    expect((await receiveInquiry(post(sample()), { LIVE: fakeD1().db })).status).toBe(503);
  });

  it("refuses a wrong key, bad JSON, a malformed inquiry and anything too big", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN };
    expect((await receiveInquiry(post(sample(), "b".repeat(43)), env)).status).toBe(401);
    expect((await receiveInquiry(post("{nope"), env)).status).toBe(400);
    expect((await receiveInquiry(post({ ...sample(), email: "x" }), env)).status).toBe(400);
    expect((await receiveInquiry(post({ ...sample(), message: "x".repeat(20_000) }), env)).status).toBe(413);
    expect(d.rows.size).toBe(0);
  });

  it("stores once per id, keeps only known fields, and tells the feed without personal data", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN };
    expect((await receiveInquiry(post({ ...sample(), extra: "ignored" }), env, NOW)).status).toBe(202);
    expect((await receiveInquiry(post(sample()), env, NOW)).status).toBe(202);
    expect(d.rows.size).toBe(1);
    expect(JSON.parse([...d.rows.values()][0].body)).not.toHaveProperty("extra");
    expect(d.events[0].kind).toBe("inquiry");
    expect(d.events[0].body).not.toContain("Alex");
    expect(d.events[0].body).not.toContain("@");
  });

  it("deletes inquiries past the retention window", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN };
    await receiveInquiry(post(sample({ id: "old-inquiry-1", received_at: "2026-01-01T00:00:00.000Z" })), env, NOW);
    await receiveInquiry(post(sample()), env, NOW);
    expect([...d.rows.keys()]).toEqual([sample().id]);
  });

  it("reads newest first for the page, and for the app only with the sync key", async () => {
    const d = fakeD1();
    const env = { LIVE: d.db, AGENT_FEED_TOKEN: TOKEN, USAGE_SYNC_TOKEN: SYNC };
    await receiveInquiry(post(sample({ id: "first-inquiry", received_at: "2026-10-30T06:00:00.000Z" })), env, NOW);
    await receiveInquiry(post(sample()), env, NOW);
    const page = (await (await readInquiries(env)).json()) as { configured: boolean; inquiries: { id: string }[] };
    expect(page.configured).toBe(true);
    expect(page.inquiries.map((i) => i.id)).toEqual([sample().id, "first-inquiry"]);
    const get = (key: string) => new Request("https://x.pages.dev/api/hooks/inquiries", { headers: { authorization: `Bearer ${key}` } });
    expect((await readInquiriesForApp(get("x".repeat(43)), env)).status).toBe(401);
    expect((await readInquiriesForApp(get(SYNC), env)).status).toBe(200);
    expect((await readInquiriesForApp(get(SYNC), { LIVE: d.db })).status).toBe(503);
    expect(await (await readInquiries({})).json()).toEqual({ configured: false, reply: { enabled: false }, inquiries: [] });
  });
});
