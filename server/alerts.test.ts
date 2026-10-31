import { describe, expect, it } from "vitest";
import { alertOnRun, REMIND_MS, type AlertEnv } from "./alerts";
import type { D1, D1Statement } from "./live";

const NOW = Date.UTC(2026, 9, 29, 8);
const ENV: AlertEnv = { RESEND_API_KEY: "re_test", ALERT_EMAIL_TO: "kc@example.com", ALERT_EMAIL_FROM: "Atlas <alerts@example.com>" };
const run = (status: string, agents = ["order-delivery"]) => ({ project: "commerce-pipeline", agents, phase: "Delivery", status, detail: "SMTP refused", at: "2026-10-29T07:59:00Z" });

/** Just enough of D1 for the alert_state table. */
function fakeD1() {
  const state = new Map<string, { failing: number; emailed_at: string }>();
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT")) {
        const [agent, at] = args as [string, string];
        state.set(agent, { failing: sql.includes("1, ?") ? 1 : 0, emailed_at: at });
      }
    },
    all: async <T,>() => ({ results: (state.has(args[0] as string) ? [state.get(args[0] as string)] : []) as T[] }),
  });
  const db: D1 = { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
  return { db, state };
}

function fakeResend(ok = true) {
  const sent: { subject: string; text: string; to: string[]; auth: string | null }[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ subject: body.subject, text: body.text, to: body.to, auth: new Headers(init.headers).get("authorization") });
    return new Response("{}", { status: ok ? 200 : 500 });
  }) as unknown as typeof fetch;
  return { fetcher, sent };
}

describe("email alerts", () => {
  it("stays off until all three settings exist", async () => {
    const d = fakeD1();
    const r = fakeResend();
    expect(await alertOnRun(d.db, { RESEND_API_KEY: "re_test" }, run("failed"), NOW, r.fetcher)).toEqual([]);
    expect(r.sent).toHaveLength(0);
  });

  it("emails once when an agent starts failing, reminds after 12 hours, and says when it recovers", async () => {
    const d = fakeD1();
    const r = fakeResend();
    expect(await alertOnRun(d.db, ENV, run("failed"), NOW, r.fetcher)).toEqual(["order-delivery"]);
    expect(r.sent[0]).toMatchObject({ subject: "Atlas alert: order-delivery failed", to: ["kc@example.com"], auth: "Bearer re_test" });
    expect(r.sent[0].text).toContain("Detail: SMTP refused");

    await alertOnRun(d.db, ENV, run("failed"), NOW + 60_000, r.fetcher);
    await alertOnRun(d.db, ENV, run("skipped"), NOW + 120_000, r.fetcher);
    expect(r.sent).toHaveLength(1);

    await alertOnRun(d.db, ENV, run("failed"), NOW + REMIND_MS, r.fetcher);
    expect(r.sent[1].subject).toBe("Atlas alert: order-delivery is still failing");

    await alertOnRun(d.db, ENV, run("ok"), NOW + REMIND_MS + 1, r.fetcher);
    expect(r.sent[2].subject).toBe("Atlas: order-delivery recovered");
    // Healthy runs after that send nothing.
    await alertOnRun(d.db, ENV, run("ok"), NOW + REMIND_MS + 2, r.fetcher);
    expect(r.sent).toHaveLength(3);
  });

  it("tries again on the next failure when an email couldn't be sent", async () => {
    const d = fakeD1();
    expect(await alertOnRun(d.db, ENV, run("failed"), NOW, fakeResend(false).fetcher)).toEqual([]);
    expect(d.state.size).toBe(0);
    expect(await alertOnRun(d.db, ENV, run("failed"), NOW + 1, fakeResend().fetcher)).toEqual(["order-delivery"]);
  });

  it("never throws, even when the database does", async () => {
    const broken: D1 = { prepare: () => { throw new Error("D1 down"); }, batch: async () => undefined };
    expect(await alertOnRun(broken, ENV, run("failed"), NOW, fakeResend().fetcher)).toEqual([]);
  });
});
