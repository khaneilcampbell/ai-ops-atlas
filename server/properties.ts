// Site checks for the website property dashboards (docs/website-properties.md). The signed-in
// page asks GET /api/properties?domain=…, the Mac app GET /api/hooks/properties?domain=… with its
// sync key. Only domains in src/properties/registry.ts are checked.
//
// Every source here is public and needs no account: RDAP for the registration, Cloudflare's
// DNS-over-HTTPS resolver for records, Certificate Transparency logs (crt.sh) for the
// certificate, one HTTPS request for reachability, and Google PageSpeed Insights for speed (an
// optional key only raises its quota). Cloudflare analytics and audit events need KC's read-only
// token (server/cloudflare.ts); Uptime Kuma history stays "not configured" until KC supplies it.
//
// Answers are cached per check (Cache API on Pages), so opening a building or polling from both
// devices costs at most one upstream request per check per window.

import { PROPERTY_DOMAINS, propertyByDomain } from "../src/properties/registry";
import { edgeEvents, findZone, NoZone, traffic, type Zone } from "./cloudflare";
import type { Check, CheckName, DnsInfo, DomainInfo, EdgeEvent, PerfInfo, ProbeInfo, SiteSnapshot, TlsInfo, TrafficInfo } from "../src/properties/types";
import { bearerOk } from "./live";
import { reply, type Json as J } from "./http";

export interface PropertyEnv {
  /** Optional Google API key, only to raise the PageSpeed Insights quota. */
  PAGESPEED_API_KEY?: string;
  /** Read-only Cloudflare API token: Zone Read, Zone Analytics Read, Account Settings Read (audit log). */
  CLOUDFLARE_API_TOKEN?: string;
  /** Base URL of KC's Uptime Kuma, e.g. https://status.example.com. Not wired yet. */
  UPTIME_KUMA_URL?: string;
  /** The Mac app's sync key, for /api/hooks/properties. */
  USAGE_SYNC_TOKEN?: string;
}

/** A small key-value cache. Pages uses the Cache API; tests use a Map. */
export interface CheckCache {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: unknown, ttlSec: number): Promise<void>;
}

type Fetcher = typeof fetch;

const TIMEOUT_MS = 15_000;
/** PageSpeed runs a full Lighthouse pass, which often takes 20 seconds or more. */
const PSI_TIMEOUT_MS = 45_000;
const ERROR_TTL = 5 * 60;

/** How long each answer is reused. Registration and certificates change rarely; reachability often. */
export const TTL: Record<"domain" | "dns" | "tls" | "probe" | "performance" | "traffic" | "edgeEvents", number> = {
  domain: 12 * 3600,
  dns: 10 * 60,
  tls: 6 * 3600,
  probe: 60,
  performance: 6 * 3600,
  traffic: 10 * 60,
  edgeEvents: 10 * 60,
};
const ZONE_TTL = 24 * 3600;


async function getJson(fetcher: Fetcher, url: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<unknown> {
  const r = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

const why = (e: unknown) => (e instanceof Error ? (e.name === "TimeoutError" ? "No answer in time" : e.message) : "Unknown error");

// ---------- RDAP: registration and expiry ----------

const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

function vcardName(entity: J): string | null {
  const card = entity?.vcardArray?.[1];
  if (!Array.isArray(card)) return null;
  const fn = card.find((f: unknown) => Array.isArray(f) && f[0] === "fn");
  return typeof fn?.[3] === "string" && fn[3].trim() ? fn[3].trim() : null;
}

export function parseRdap(j: J): DomainInfo {
  const events: J[] = Array.isArray(j.events) ? j.events : [];
  const at = (action: string) => iso(events.find((e) => e?.eventAction === action)?.eventDate);
  const registrar = (Array.isArray(j.entities) ? j.entities : []).find((e: J) => Array.isArray(e?.roles) && e.roles.includes("registrar"));
  return {
    registrar: registrar ? vcardName(registrar) : null,
    registeredAt: at("registration"),
    expiresAt: at("expiration"),
    updatedAt: at("last changed"),
    status: (Array.isArray(j.status) ? j.status : []).filter((s: unknown): s is string => typeof s === "string"),
    nameservers: (Array.isArray(j.nameservers) ? j.nameservers : [])
      .map((n: J) => String(n?.ldhName ?? "").toLowerCase())
      .filter(Boolean)
      .sort(),
    dnssec: typeof j.secureDNS?.delegationSigned === "boolean" ? j.secureDNS.delegationSigned : null,
  };
}

// ---------- DNS over HTTPS ----------

/** Record data of one type from a DNS JSON answer, without the trailing dot on names. */
export function dohAnswers(j: J, type: number): string[] {
  return (Array.isArray(j.Answer) ? j.Answer : [])
    .filter((a: J) => a?.type === type && typeof a.data === "string")
    .map((a: J) => (a.data as string).replace(/\.$/, ""))
    .sort();
}

const TYPE = { A: 1, NS: 2, CNAME: 5, MX: 15, AAAA: 28, CAA: 257 } as const;

async function dns(domain: string, fetcher: Fetcher): Promise<DnsInfo> {
  const ask = (name: string, type: keyof typeof TYPE) =>
    getJson(fetcher, `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}&do=1`, { headers: { accept: "application/dns-json" } }) as Promise<J>;
  const [a, aaaa, ns, mx, caa, www] = await Promise.all([ask(domain, "A"), ask(domain, "AAAA"), ask(domain, "NS"), ask(domain, "MX"), ask(domain, "CAA"), ask(`www.${domain}`, "A")]);
  if (a.Status === 3) throw new Error(`${domain} doesn't exist in DNS (NXDOMAIN)`);
  return {
    a: dohAnswers(a, TYPE.A),
    aaaa: dohAnswers(aaaa, TYPE.AAAA),
    ns: dohAnswers(ns, TYPE.NS).map((n) => n.toLowerCase()),
    mx: dohAnswers(mx, TYPE.MX),
    caa: dohAnswers(caa, TYPE.CAA),
    www: [...dohAnswers(www, TYPE.CNAME), ...dohAnswers(www, TYPE.A)],
    validated: a.AD === true,
  };
}

// ---------- Certificate Transparency ----------

function covers(names: string[], domain: string): boolean {
  return names.some((n) => n === domain || n === `*.${domain}`);
}

/** The newest unexpired certificate that covers the apex, from crt.sh's JSON. */
export function parseCrtSh(list: unknown, domain: string, now: number): TlsInfo | null {
  if (!Array.isArray(list)) return null;
  const current = list
    .map((c: J) => ({
      names: String(c?.name_value ?? "")
        .split("\n")
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean),
      issuer: typeof c?.issuer_name === "string" ? c.issuer_name : null,
      // crt.sh gives UTC times without a zone.
      notBefore: iso(typeof c?.not_before === "string" ? `${c.not_before.replace(/Z?$/, "")}Z` : null),
      notAfter: iso(typeof c?.not_after === "string" ? `${c.not_after.replace(/Z?$/, "")}Z` : null),
    }))
    .filter((c): c is { names: string[]; issuer: string | null; notBefore: string; notAfter: string } => !!c.notBefore && !!c.notAfter && Date.parse(c.notAfter) > now && Date.parse(c.notBefore) <= now && covers(c.names, domain));
  if (!current.length) return null;
  current.sort((a, b) => Date.parse(b.notBefore) - Date.parse(a.notBefore));
  const newest = current[0];
  const org = newest.issuer?.match(/(?:^|,\s*)O=("?)([^,"]+)\1/)?.[2] ?? newest.issuer;
  return { issuer: org ?? null, notBefore: newest.notBefore, notAfter: newest.notAfter, names: [...new Set(newest.names)].sort(), current: current.length };
}

// ---------- Reachability ----------

async function probe(domain: string, fetcher: Fetcher): Promise<ProbeInfo> {
  const started = Date.now();
  const r = await fetcher(`https://${domain}/`, { redirect: "follow", headers: { "user-agent": "Atlas site check" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const ms = Date.now() - started;
  // Only the headers are needed; don't download the page.
  await r.body?.cancel().catch(() => undefined);
  return { status: r.status, ms, finalUrl: r.url || `https://${domain}/`, cloudflare: r.headers.has("cf-ray"), hsts: r.headers.has("strict-transport-security") };
}

// ---------- PageSpeed Insights ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parsePsi(j: J, url: string): PerfInfo {
  const lh = j.lighthouseResult ?? {};
  const audit = (id: string) => num(lh.audits?.[id]?.numericValue);
  const score = num(lh.categories?.performance?.score);
  const m = j.loadingExperience?.metrics;
  const p75 = (k: string) => num(m?.[k]?.percentile);
  const field = m
    ? {
        lcpP75: p75("LARGEST_CONTENTFUL_PAINT_MS"),
        inpP75: p75("INTERACTION_TO_NEXT_PAINT"),
        // CrUX reports CLS multiplied by 100.
        clsP75: p75("CUMULATIVE_LAYOUT_SHIFT_SCORE") === null ? null : p75("CUMULATIVE_LAYOUT_SHIFT_SCORE")! / 100,
        overall: typeof j.loadingExperience?.overall_category === "string" ? j.loadingExperience.overall_category : null,
      }
    : null;
  return {
    strategy: "mobile",
    score: score === null ? null : Math.round(score * 100),
    lcpMs: audit("largest-contentful-paint"),
    cls: audit("cumulative-layout-shift"),
    tbtMs: audit("total-blocking-time"),
    field,
    reportUrl: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=mobile`,
  };
}

async function performance(domain: string, env: PropertyEnv, fetcher: Fetcher): Promise<PerfInfo> {
  const url = `https://${domain}/`;
  const q = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  if (env.PAGESPEED_API_KEY) q.set("key", env.PAGESPEED_API_KEY);
  const j = (await getJson(fetcher, `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, {}, PSI_TIMEOUT_MS)) as J;
  return parsePsi(j, url);
}

// ---------- Putting it together ----------

const SOURCES = {
  domain: "RDAP (rdap.org)",
  dns: "Cloudflare DNS over HTTPS (1.1.1.1)",
  tls: "Certificate Transparency logs (crt.sh)",
  probe: "HTTPS request from Cloudflare's network",
  performance: "Google PageSpeed Insights, mobile",
  traffic: "Cloudflare analytics",
  edgeEvents: "Cloudflare audit log",
  uptime: "Uptime Kuma",
} satisfies Record<CheckName, string>;

async function cached<T>(name: keyof typeof TTL, domain: string, cache: CheckCache | null, now: number, run: () => Promise<T>): Promise<Check<T>> {
  const key = `${name}:${domain}`;
  const hit = (await cache?.get(key).catch(() => null)) as Check<T> | null | undefined;
  if (hit) return hit;
  const checkedAt = new Date(now).toISOString();
  let out: Check<T>;
  try {
    out = { state: "ok", source: SOURCES[name], checkedAt, data: await run() };
  } catch (e) {
    out = { state: "error", source: SOURCES[name], checkedAt, message: why(e) };
  }
  await cache?.put(key, out, out.state === "ok" ? TTL[name] : ERROR_TTL).catch(() => undefined);
  return out;
}

export interface SnapshotOptions {
  /** Keeps a slow check running after the answer is sent (Pages' waitUntil), so its result lands in the cache. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** How long to wait for PageSpeed before answering without it. The Mac app gives up after 20 seconds. */
  slowBudgetMs?: number;
}

const SLOW_BUDGET_MS = 12_000;

/** Waits up to the budget for a slow check; past it, answers "still running" and lets the check finish into the cache. */
async function slow<T>(run: Promise<Check<T>>, opts: SnapshotOptions): Promise<Check<T>> {
  if (!opts.waitUntil) return run;
  opts.waitUntil(run);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Check<T>>((resolve) => {
    timer = setTimeout(() => resolve({ state: "error", source: SOURCES.performance, checkedAt: new Date().toISOString(), message: "PageSpeed is still testing the site; check again in a minute" }), opts.slowBudgetMs ?? SLOW_BUDGET_MS);
  });
  try {
    return await Promise.race([run, late]);
  } finally {
    clearTimeout(timer);
  }
}

const CF_NEED = "A read-only Cloudflare API token on the site (CLOUDFLARE_API_TOKEN): Zone Read, Zone Analytics Read and Account Settings Read.";

/** Traffic and audit events, or why they can't be read. The zone lookup is cached for a day. */
async function cloudflareChecks(domain: string, env: PropertyEnv, cache: CheckCache | null, fetcher: Fetcher, now: number): Promise<[Check<TrafficInfo>, Check<EdgeEvent[]>]> {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) return [{ state: "not-configured", source: SOURCES.traffic, need: CF_NEED }, { state: "not-configured", source: SOURCES.edgeEvents, need: CF_NEED }];
  let zone: Zone;
  try {
    const key = `cfzone:${domain}`;
    const hit = (await cache?.get(key).catch(() => null)) as Zone | { none: string } | null | undefined;
    if (hit && "none" in hit) throw new NoZone(hit.none);
    if (hit) zone = hit;
    else {
      try {
        zone = await findZone(fetcher, token, domain);
        await cache?.put(key, zone, ZONE_TTL).catch(() => undefined);
      } catch (e) {
        if (e instanceof NoZone) await cache?.put(key, { none: e.message }, ZONE_TTL).catch(() => undefined);
        throw e;
      }
    }
  } catch (e) {
    const checkedAt = new Date(now).toISOString();
    if (e instanceof NoZone) return [{ state: "not-configured", source: SOURCES.traffic, need: e.message }, { state: "not-configured", source: SOURCES.edgeEvents, need: e.message }];
    return [{ state: "error", source: SOURCES.traffic, checkedAt, message: why(e) }, { state: "error", source: SOURCES.edgeEvents, checkedAt, message: why(e) }];
  }
  const worker = propertyByDomain(domain)?.cloudflareWorker;
  return Promise.all([cached("traffic", domain, cache, now, () => traffic(fetcher, token, zone, now)), cached("edgeEvents", domain, cache, now, () => edgeEvents(fetcher, token, zone, domain, worker, now))]);
}

export async function snapshot(domain: string, env: PropertyEnv, cache: CheckCache | null, fetcher: Fetcher = fetch, now = Date.now(), opts: SnapshotOptions = {}): Promise<SiteSnapshot> {
  const [d, n, t, p, perf] = await Promise.all([
    cached("domain", domain, cache, now, async () => parseRdap((await getJson(fetcher, `https://rdap.org/domain/${domain}`, { headers: { accept: "application/rdap+json" } })) as J)),
    cached("dns", domain, cache, now, () => dns(domain, fetcher)),
    cached("tls", domain, cache, now, async () => {
      const info = parseCrtSh(await getJson(fetcher, `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json&exclude=expired`), domain, now);
      if (!info) throw new Error("No current certificate for the domain is in the public logs");
      return info;
    }),
    cached("probe", domain, cache, now, () => probe(domain, fetcher)),
    slow(cached("performance", domain, cache, now, () => performance(domain, env, fetcher)), opts),
  ]);
  const [tr, ev] = await cloudflareChecks(domain, env, cache, fetcher, now);
  return {
    domain,
    checks: {
      domain: d,
      dns: n,
      tls: t,
      probe: p,
      performance: perf,
      traffic: tr,
      edgeEvents: ev,
      uptime: {
        state: "not-configured",
        source: SOURCES.uptime,
        need: env.UPTIME_KUMA_URL ? "The Kuma URL is set on the site; reading it ships in the next pull request." : "The address of KC's Uptime Kuma and a public status page with a monitor for this site (UPTIME_KUMA_URL).",
      },
    },
  };
}

/** The Cache API, keyed by a URL that never leaves the worker. */
export function edgeCache(): CheckCache | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!c) return null;
  const req = (key: string) => new Request(`https://atlas-property-cache.invalid/${encodeURIComponent(key)}`);
  return {
    async get(key) {
      const r = await c.match(req(key));
      return r ? r.json() : null;
    },
    async put(key, value, ttlSec) {
      await c.put(req(key), Response.json(value, { headers: { "cache-control": `max-age=${ttlSec}` } }));
    },
  };
}

function domainOf(url: URL): string | null {
  const d = (url.searchParams.get("domain") ?? "").trim().toLowerCase();
  return PROPERTY_DOMAINS.includes(d) ? d : null;
}

/** GET /api/properties?domain=…, behind Access. */
export async function readProperty(req: Request, env: PropertyEnv, cache = edgeCache(), fetcher: Fetcher = fetch, opts: SnapshotOptions = {}): Promise<Response> {
  const domain = domainOf(new URL(req.url));
  if (!domain) return reply(400, { message: `Unknown property. Atlas checks only: ${PROPERTY_DOMAINS.join(", ")}.` });
  return reply(200, await snapshot(domain, env, cache, fetcher, Date.now(), opts));
}

/** GET /api/hooks/properties?domain=…: the same for the Mac app, with its sync key instead of Access. */
export async function readPropertyForApp(req: Request, env: PropertyEnv, cache = edgeCache(), fetcher: Fetcher = fetch, opts: SnapshotOptions = {}): Promise<Response> {
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { message: "Website sync isn't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  return readProperty(req, env, cache, fetcher, opts);
}
