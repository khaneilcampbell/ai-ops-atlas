import { describe, expect, it } from "vitest";
import { PROPERTIES } from "../src/properties/registry";
import { dohAnswers, parseCrtSh, parsePsi, parseRdap, readProperty, readPropertyForApp, snapshot, type CheckCache } from "./properties";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const SYNC = "s".repeat(43);

const RDAP = {
  objectClassName: "domain",
  ldhName: "BENJAIRE.COM",
  status: ["client transfer prohibited"],
  events: [
    { eventAction: "registration", eventDate: "2025-04-02T18:11:04Z" },
    { eventAction: "expiration", eventDate: "2027-04-02T18:11:04Z" },
    { eventAction: "last changed", eventDate: "2026-04-03T10:00:00Z" },
  ],
  nameservers: [{ ldhName: "NOVA.NS.CLOUDFLARE.COM" }, { ldhName: "ADAM.NS.CLOUDFLARE.COM" }],
  secureDNS: { delegationSigned: false },
  entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Cloudflare, Inc."]]] }],
};

const CRT = [
  { issuer_name: "C=US, O=Google Trust Services, CN=WE1", name_value: "benjaire.com\n*.benjaire.com", not_before: "2026-09-20T01:00:00", not_after: "2026-12-19T01:00:00" },
  { issuer_name: "C=US, O=Let's Encrypt, CN=E6", name_value: "benjaire.com", not_before: "2026-08-01T00:00:00", not_after: "2026-10-30T00:00:00" },
  { issuer_name: "C=US, O=Let's Encrypt, CN=E6", name_value: "mail.benjaire.com", not_before: "2026-10-01T00:00:00", not_after: "2026-12-30T00:00:00" },
];

const PSI = {
  lighthouseResult: {
    categories: { performance: { score: 0.93 } },
    audits: { "largest-contentful-paint": { numericValue: 1840.2 }, "cumulative-layout-shift": { numericValue: 0.01 }, "total-blocking-time": { numericValue: 30 } },
  },
  loadingExperience: { overall_category: "FAST", metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1900 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 2 } } },
};

const doh = (type: number, data: string[], extra = {}) => ({ Status: 0, AD: true, Answer: data.map((d) => ({ type, data: d })), ...extra });

/** Answers each upstream by host, and counts the calls. */
function fakeFetch(overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.host);
    if (overrides[url.host]) return overrides[url.host]();
    if (url.host === "rdap.org") return Response.json(RDAP);
    if (url.host === "crt.sh") return Response.json(CRT);
    if (url.host === "www.googleapis.com") return Response.json(PSI);
    if (url.host === "cloudflare-dns.com") {
      const type = url.searchParams.get("type");
      const name = url.searchParams.get("name");
      if (name?.startsWith("www.")) return Response.json(type === "A" ? doh(5, ["benjaire.com."]) : doh(1, []));
      const answers: Record<string, ReturnType<typeof doh>> = { A: doh(1, ["104.21.1.1", "172.67.1.1"]), AAAA: doh(28, ["2606:4700::1"]), NS: doh(2, ["nova.ns.cloudflare.com.", "adam.ns.cloudflare.com."]), MX: doh(15, ["10 route1.mx.cloudflare.net."]), CAA: doh(257, []) };
      return Response.json(answers[type!]);
    }
    if (url.host === "benjaire.com") return new Response("ok", { status: 200, headers: { "cf-ray": "abc", "strict-transport-security": "max-age=1" } });
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

function mapCache(): CheckCache & { keys: () => string[] } {
  const m = new Map<string, unknown>();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), keys: () => [...m.keys()] };
}

describe("site check parsers", () => {
  it("reads registration, expiry, registrar and nameservers from RDAP", () => {
    expect(parseRdap(RDAP)).toEqual({
      registrar: "Cloudflare, Inc.",
      registeredAt: "2025-04-02T18:11:04.000Z",
      expiresAt: "2027-04-02T18:11:04.000Z",
      updatedAt: "2026-04-03T10:00:00.000Z",
      status: ["client transfer prohibited"],
      nameservers: ["adam.ns.cloudflare.com", "nova.ns.cloudflare.com"],
      dnssec: false,
    });
    expect(parseRdap({}).expiresAt).toBeNull();
  });

  it("keeps only the asked record type and drops trailing dots", () => {
    expect(dohAnswers({ Answer: [{ type: 5, data: "x.example." }, { type: 1, data: "1.2.3.4" }] }, 1)).toEqual(["1.2.3.4"]);
    expect(dohAnswers({}, 1)).toEqual([]);
  });

  it("picks the newest current certificate that covers the apex", () => {
    const tls = parseCrtSh(CRT, "benjaire.com", NOW)!;
    expect(tls.issuer).toBe("Google Trust Services");
    expect(tls.notAfter).toBe("2026-12-19T01:00:00.000Z");
    expect(tls.names).toEqual(["*.benjaire.com", "benjaire.com"]);
    // The expired one and the subdomain-only one don't count.
    expect(tls.current).toBe(1);
    expect(parseCrtSh([], "benjaire.com", NOW)).toBeNull();
    expect(parseCrtSh("garbage", "benjaire.com", NOW)).toBeNull();
  });

  it("turns PageSpeed into a 0-100 score with lab and field numbers", () => {
    const p = parsePsi(PSI, "https://benjaire.com/");
    expect(p.score).toBe(93);
    expect(p.lcpMs).toBeCloseTo(1840.2);
    expect(p.field).toEqual({ lcpP75: 1900, inpP75: null, clsP75: 0.02, overall: "FAST" });
    expect(p.reportUrl).toContain("pagespeed.web.dev");
    expect(parsePsi({}, "https://x/").score).toBeNull();
  });
});

describe("the site snapshot", () => {
  it("runs every free check and says what the rest need", async () => {
    const { f } = fakeFetch();
    const s = await snapshot("benjaire.com", {}, null, f, NOW);
    expect(s.checks.domain.state).toBe("ok");
    expect(s.checks.dns.state === "ok" && s.checks.dns.data).toMatchObject({ a: ["104.21.1.1", "172.67.1.1"], www: ["benjaire.com"], validated: true });
    expect(s.checks.tls.state).toBe("ok");
    expect(s.checks.probe.state === "ok" && s.checks.probe.data).toMatchObject({ status: 200, cloudflare: true, hsts: true });
    expect(s.checks.performance.state === "ok" && s.checks.performance.data.score).toBe(93);
    for (const k of ["traffic", "edgeEvents", "uptime"] as const) expect(s.checks[k].state).toBe("not-configured");
  });

  it("reports a failing source as an error without hiding the others", async () => {
    const { f } = fakeFetch({ "crt.sh": () => new Response("busy", { status: 502 }), "benjaire.com": () => { throw new TypeError("connection refused"); } });
    const s = await snapshot("benjaire.com", {}, null, f, NOW);
    expect(s.checks.tls).toMatchObject({ state: "error", message: "crt.sh answered 502" });
    expect(s.checks.probe).toMatchObject({ state: "error", message: "connection refused" });
    expect(s.checks.domain.state).toBe("ok");
  });

  it("asks each upstream once per cache window", async () => {
    const { f, calls } = fakeFetch();
    const cache = mapCache();
    await snapshot("benjaire.com", {}, cache, f, NOW);
    const first = calls.length;
    await snapshot("benjaire.com", {}, cache, f, NOW);
    expect(calls.length).toBe(first);
    expect(cache.keys()).toContain("tls:benjaire.com");
  });

  it("passes the optional PageSpeed key and never sends anything else", async () => {
    const seen: string[] = [];
    const { f } = fakeFetch();
    const spy = (async (u: RequestInfo | URL, i?: RequestInit) => (seen.push(String(u)), f(u, i))) as typeof fetch;
    await snapshot("benjaire.com", { PAGESPEED_API_KEY: "k123" }, null, spy, NOW);
    expect(seen.find((u) => u.includes("pagespeedonline"))).toContain("key=k123");
    expect(seen.filter((u) => u.includes("k123"))).toHaveLength(1);
  });
});

describe("a slow PageSpeed run", () => {
  it("answers without it after the budget and lets it finish into the cache", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { f } = fakeFetch();
    const slowFetch = (async (u: RequestInfo | URL, i?: RequestInit) => {
      if (String(u).includes("pagespeedonline")) await gate;
      return f(u, i);
    }) as typeof fetch;
    const cache = mapCache();
    const pending: Promise<unknown>[] = [];
    const s = await snapshot("benjaire.com", {}, cache, slowFetch, NOW, { waitUntil: (p) => pending.push(p), slowBudgetMs: 10 });
    expect(s.checks.performance).toMatchObject({ state: "error", message: expect.stringContaining("still testing") });
    expect(cache.keys()).not.toContain("performance:benjaire.com");
    release();
    await Promise.all(pending);
    expect(cache.keys()).toContain("performance:benjaire.com");
  });
});

describe("the property routes", () => {
  const get = (path: string, token?: string) => new Request(`https://x.pages.dev${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

  it("checks only the registered domains", async () => {
    const { f } = fakeFetch();
    expect((await readProperty(get("/api/properties?domain=example.com"), {}, null, f)).status).toBe(400);
    expect((await readProperty(get("/api/properties"), {}, null, f)).status).toBe(400);
    const ok = await readProperty(get("/api/properties?domain=BENJAIRE.COM"), {}, null, f);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { domain: string }).domain).toBe("benjaire.com");
  });

  it("lets the Mac app in only with the sync key", async () => {
    const { f } = fakeFetch();
    expect((await readPropertyForApp(get("/api/hooks/properties?domain=benjaire.com", SYNC), {}, null, f)).status).toBe(503);
    expect((await readPropertyForApp(get("/api/hooks/properties?domain=benjaire.com", "w".repeat(43)), { USAGE_SYNC_TOKEN: SYNC }, null, f)).status).toBe(401);
    expect((await readPropertyForApp(get("/api/hooks/properties?domain=benjaire.com", SYNC), { USAGE_SYNC_TOKEN: SYNC }, null, f)).status).toBe(200);
  });

  it("covers both websites", () => {
    expect(PROPERTIES.map((p) => p.domain)).toEqual(["benjaire.com", "khaneilcampbell.com"]);
  });
});
