import { describe, expect, it } from "vitest";
import { findZone, NoZone, parseAuditLog, parseTraffic } from "./cloudflare";
import { snapshot, type CheckCache } from "./properties";

const NOW = Date.parse("2026-11-03T12:40:00Z");
const TOKEN = "cf-token-read-only";

const ZONES = { success: true, result: [{ id: "zone123", name: "benjaire.com", account: { id: "acct9" } }] };
const GRAPHQL = { data: { viewer: { zones: [{ httpRequests1hGroups: [{ sum: { requests: 1200, threats: 3, pageViews: 410 } }, { sum: { requests: 800, threats: 0, pageViews: 90 } }] }] } }, errors: null };
const AUDIT = {
  success: true,
  result: [
    { when: "2026-11-02T09:00:00Z", action: { type: "update" }, resource: { type: "DNS_record" }, actor: { email: "kc@example.com" }, metadata: { zone_name: "benjaire.com" } },
    { when: "2026-11-03T08:00:00Z", action: { type: "deploy" }, resource: { type: "script", id: "benjaire-com" }, actor: { type: "system" } },
    { when: "2026-11-03T07:00:00Z", action: { type: "update" }, resource: { type: "script", id: "other-worker" }, actor: { email: "kc@example.com" } },
  ],
};

function fake(over: Record<string, () => Response> = {}) {
  const seen: { url: string; auth: string | null; method: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    seen.push({ url: String(input), auth, method: init?.method ?? "GET" });
    const key = url.host === "api.cloudflare.com" ? url.pathname.replace("/client/v4", "").split("/")[1] : url.host;
    if (over[key]) return over[key]();
    if (url.host === "api.cloudflare.com") {
      if (url.pathname.endsWith("/zones")) return Response.json(url.searchParams.get("name") === "benjaire.com" ? ZONES : { success: true, result: [] });
      if (url.pathname.endsWith("/graphql")) return Response.json(GRAPHQL);
      if (url.pathname.endsWith("/audit_logs")) return Response.json(AUDIT);
    }
    // Every free check: answer something minimal; these tests only look at Cloudflare.
    return Response.json({});
  }) as typeof fetch;
  return { f, seen };
}

const toCloudflare = (url: string) => new URL(url).host === "api.cloudflare.com";

const mapCache = (): CheckCache => {
  const m = new Map<string, unknown>();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) };
};

describe("Cloudflare parsers", () => {
  it("sums 24 hourly groups into requests, page views and threats", () => {
    expect(parseTraffic(GRAPHQL)).toEqual({ requests24h: 2000, visits24h: 500, threats24h: 3 });
    expect(parseTraffic({ data: { viewer: { zones: [] } } })).toEqual({ requests24h: 0, visits24h: null, threats24h: null });
    expect(() => parseTraffic({ errors: [{ message: "not authorized" }] })).toThrow(/not authorized/);
  });

  it("keeps only audit events about this site, newest first", () => {
    const events = parseAuditLog(AUDIT, ["zone123", "benjaire.com", "benjaire-com"]);
    expect(events).toEqual([
      { at: "2026-11-03T08:00:00Z", action: "deploy script", actor: "system" },
      { at: "2026-11-02T09:00:00Z", action: "update DNS_record", actor: "kc@example.com" },
    ]);
  });

  it("says plainly when a domain isn't in the account", async () => {
    const { f } = fake();
    await expect(findZone(f, TOKEN, "khaneilcampbell.com")).rejects.toBeInstanceOf(NoZone);
  });
});

describe("Cloudflare checks in the snapshot", () => {
  it("stays not connected without a token and calls nothing", async () => {
    const { f, seen } = fake();
    const s = await snapshot("benjaire.com", {}, null, f, NOW);
    expect(s.checks.traffic.state).toBe("not-configured");
    expect(seen.some((r) => toCloudflare(r.url))).toBe(false);
  });

  it("reads traffic and events with the token, sending it only to Cloudflare", async () => {
    const { f, seen } = fake();
    const s = await snapshot("benjaire.com", { CLOUDFLARE_API_TOKEN: TOKEN }, null, f, NOW);
    expect(s.checks.traffic).toMatchObject({ state: "ok", data: { requests24h: 2000 } });
    expect(s.checks.edgeEvents.state === "ok" && s.checks.edgeEvents.data).toHaveLength(2);
    expect(seen.find((r) => r.url.includes("/audit_logs"))?.url).toContain("/accounts/acct9/");
    expect(seen.filter((r) => r.auth?.includes(TOKEN)).every((r) => toCloudflare(r.url))).toBe(true);
    // Read-only: the only POST is the GraphQL query.
    expect(seen.filter((r) => r.method !== "GET").map((r) => new URL(r.url).pathname)).toEqual(["/client/v4/graphql"]);
  });

  it("marks a site outside the account as not connected, and remembers it for a day", async () => {
    const { f, seen } = fake();
    const cache = mapCache();
    const s = await snapshot("khaneilcampbell.com", { CLOUDFLARE_API_TOKEN: TOKEN }, cache, f, NOW);
    expect(s.checks.traffic).toMatchObject({ state: "not-configured", need: expect.stringContaining("isn't a zone") });
    const lookups = seen.filter((r) => r.url.includes("/zones")).length;
    await snapshot("khaneilcampbell.com", { CLOUDFLARE_API_TOKEN: TOKEN }, cache, f, NOW);
    expect(seen.filter((r) => r.url.includes("/zones")).length).toBe(lookups);
  });

  it("explains a refused token", async () => {
    const { f } = fake({ zones: () => Response.json({ success: false, errors: [{ message: "Authentication error" }] }, { status: 403 }) });
    const s = await snapshot("benjaire.com", { CLOUDFLARE_API_TOKEN: TOKEN }, null, f, NOW);
    expect(s.checks.traffic).toMatchObject({ state: "error", message: expect.stringContaining("refused the token") });
  });
});
