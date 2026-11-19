import { describe, expect, it, vi } from "vitest";
import { fetchSales, N8N_NAMED_ACTIONS, rangeProblem, salesForApp, salesStatus } from "./stripeSales";

const TOKEN = "t".repeat(40);
const SYNC = "s".repeat(40);
const NOW = Date.parse("2026-11-16T05:00:00Z");
const ask = (body: unknown, headers: Record<string, string> = {}) => new Request("https://atlas.test/api/n8n/sales", { method: "POST", headers, body: JSON.stringify(body) });
const answer = { ok: true, fetchedAt: "2026-11-16T05:00:00Z", since: "2026-10-01T00:00:00Z", until: "2026-11-16T05:00:00Z", sales: [{ orderRef: "cs_live_abc", paymentRef: "pi_1", productRef: "p", date: "2026-10-17", currency: "USD", grossCents: 7900, refundCents: 0, feeCents: 259, chargeStatus: "succeeded", livemode: true, email: "x@example.com" }] };

describe("named n8n action: Stripe sales", () => {
  it("only knows the sales feed", () => {
    expect(Object.keys(N8N_NAMED_ACTIONS)).toEqual(["stripe-sales"]);
  });

  it("says it isn't set up without the bridge key, and calls nothing", async () => {
    const f = vi.fn();
    const r = await (await fetchSales(ask({ since: "2026-10-01T00:00:00Z" }), {}, f, NOW)).json();
    expect(r.state).toBe("unconfigured");
    expect(f).not.toHaveBeenCalled();
    expect(await (await salesStatus({}).json())).toMatchObject({ configured: false });
  });

  it("sends only the two dates to the sales feed webhook with the bridge key, and checks the answer", async () => {
    const f = vi.fn(async () => Response.json(answer));
    const r = await (await fetchSales(ask({ since: "2026-10-01T00:00:00Z", extra: "drop me" }), { N8N_BRIDGE_TOKEN: TOKEN }, f as unknown as typeof fetch, NOW)).json();
    expect(r.state).toBe("ok");
    expect(r.sales).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("example.com");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://khancam15.app.n8n.cloud/webhook/atlas-sales-feed");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init.body))).toEqual({ since: "2026-10-01T00:00:00.000Z", until: "2026-11-16T05:00:00.000Z" });
  });

  it("reports an unpublished workflow, a refused key and a bad answer plainly", async () => {
    const env = { N8N_BRIDGE_TOKEN: TOKEN };
    const run = async (res: Response) => (await fetchSales(ask({ since: "2026-10-01T00:00:00Z" }), env, (async () => res) as unknown as typeof fetch, NOW)).json();
    expect((await run(new Response("", { status: 404 }))).state).toBe("unconfigured");
    expect((await run(new Response("", { status: 403 }))).error).toMatch(/refused the bridge key/);
    expect((await run(Response.json({ hello: 1 }))).state).toBe("error");
  });

  it("refuses bad or too long ranges", () => {
    expect(rangeProblem({ since: "x" }, NOW)).toBe("Bad date.");
    expect(rangeProblem({ since: "2020-01-01T00:00:00Z" }, NOW)).toMatch(/At most/);
    expect(rangeProblem({ since: "2026-11-17T00:00:00Z", until: "2026-11-16T00:00:00Z" }, NOW)).toMatch(/before/);
  });

  it("the Mac route needs the sync key", async () => {
    const f = vi.fn();
    const r = await salesForApp(ask({ since: "2026-10-01T00:00:00Z" }, { authorization: "Bearer wrong" }), { N8N_BRIDGE_TOKEN: TOKEN, USAGE_SYNC_TOKEN: SYNC }, f);
    expect(r.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });
});
