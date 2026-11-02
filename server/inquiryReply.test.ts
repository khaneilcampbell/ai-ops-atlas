import { describe, expect, it, vi } from "vitest";
import { sample } from "../src/inquiries/fixtures";
import type { D1, D1Statement } from "./live";
import { DAILY_CAP, resendPayload, sendReply, sendReplyForApp, validReply } from "./inquiryReply";

const SYNC = "s".repeat(43);
const NOW = Date.parse("2026-11-01T12:00:00.000Z");

function fakeD1(inquiries = [sample()]) {
  const stored = new Map(inquiries.map((i) => [i.id, JSON.stringify(i)]));
  const replies = new Map<string, { inquiry_id: string; sent_at: string; status: string }>();
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT OR REPLACE INTO inquiry_replies")) replies.set(args[0] as string, { inquiry_id: args[1] as string, sent_at: args[2] as string, status: "sent" });
    },
    all: async <T,>() => {
      if (sql.startsWith("SELECT body FROM inquiries")) return { results: (stored.has(args[0] as string) ? [{ body: stored.get(args[0] as string) }] : []) as T[] };
      if (sql.startsWith("SELECT status")) return { results: (replies.has(args[0] as string) ? [{ status: "sent" }] : []) as T[] };
      if (sql.startsWith("SELECT COUNT")) return { results: [{ n: [...replies.values()].filter((r) => r.sent_at > (args[0] as string)).length }] as T[] };
      return { results: [] as T[] };
    },
  });
  const db: D1 = { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
  return { db, replies };
}

const env = (db: D1) => ({ LIVE: db, RESEND_API_KEY: "re_x", REPLY_FROM: "Benjaire <contact@benjaire.com>", REPLY_BCC: "kc@gmail.example", USAGE_SYNC_TOKEN: SYNC });
const good = { id: sample().id, key: "key-12345678", subject: "Re: your inquiry", body: "Hi Maya,\n\nThanks for writing." };
const post = (body: unknown, token?: string) =>
  new Request("https://x.pages.dev/api/inquiries/reply", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
const okFetch = () => vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("sending a reply from Atlas", () => {
  it("is off until the site has the mail key, sender and copy address", async () => {
    const d = fakeD1();
    expect((await sendReply(post(good), { LIVE: d.db }, okFetch(), NOW)).status).toBe(503);
    expect((await sendReply(post(good), { ...env(d.db), REPLY_BCC: undefined }, okFetch(), NOW)).status).toBe(503);
  });

  it("validates the request", () => {
    expect(validReply(good)).toBe(true);
    expect(validReply({ ...good, subject: "a\nb" })).toBe(false);
    expect(validReply({ ...good, subject: "" })).toBe(false);
    expect(validReply({ ...good, body: "  " })).toBe(false);
    expect(validReply({ ...good, key: "x" })).toBe(false);
    expect(validReply({ ...good, body: "x".repeat(10_001) })).toBe(false);
  });

  it("sends the designed email to the stored address, with a copy to KC, and records it", async () => {
    const d = fakeD1();
    const f = okFetch();
    const r = await sendReply(post({ ...good, to: "attacker@evil.example" }), env(d.db), f, NOW);
    expect(r.status).toBe(200);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const sent = JSON.parse(init.body as string);
    expect(sent.to).toEqual([sample().email]);
    expect(sent.bcc).toEqual(["kc@gmail.example"]);
    expect(sent.html).toContain("email-header-banner.png");
    expect(sent.html).toContain("Thanks for writing.");
    expect(sent.text).toBe(good.body);
    expect(d.replies.size).toBe(1);
  });

  it("sends a retried tap only once", async () => {
    const d = fakeD1();
    const f = okFetch();
    await sendReply(post(good), env(d.db), f, NOW);
    const again = await sendReply(post(good), env(d.db), f, NOW);
    expect(await again.json()).toMatchObject({ sent: true, duplicate: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses an unknown inquiry and stops at the daily cap", async () => {
    const d = fakeD1();
    const f = okFetch();
    expect((await sendReply(post({ ...good, id: "missing-id" }), env(d.db), f, NOW)).status).toBe(404);
    for (let n = 0; n < DAILY_CAP; n++) d.replies.set(`k${n}`, { inquiry_id: "x", sent_at: new Date(NOW - 1000).toISOString(), status: "sent" });
    expect((await sendReply(post(good), env(d.db), f, NOW)).status).toBe(429);
    expect(f).not.toHaveBeenCalled();
  });

  it("doesn't record a reply the mail service refused", async () => {
    const d = fakeD1();
    const f = vi.fn(async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 })) as unknown as typeof fetch;
    const r = await sendReply(post(good), env(d.db), f, NOW);
    expect(r.status).toBe(502);
    expect((await r.json()).message).toContain("domain not verified");
    expect(d.replies.size).toBe(0);
  });

  it("checks the sync key on the Mac app's route", async () => {
    const d = fakeD1();
    const f = okFetch();
    expect((await sendReplyForApp(post(good, "b".repeat(43)), env(d.db), f)).status).toBe(401);
    expect((await sendReplyForApp(post(good), env(d.db), f)).status).toBe(401);
    expect((await sendReplyForApp(post(good, SYNC), env(d.db), f)).status).toBe(200);
  });

  it("only sets reply_to when configured", () => {
    const d = fakeD1();
    expect(resendPayload(env(d.db), sample(), good).reply_to).toBeUndefined();
    expect(resendPayload({ ...env(d.db), REPLY_REPLY_TO: "contact@benjaire.com" }, sample(), good).reply_to).toBe("contact@benjaire.com");
  });
});
