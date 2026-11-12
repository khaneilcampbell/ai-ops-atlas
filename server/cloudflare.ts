// Cloudflare traffic and change events for the website dashboards, read with Khaneil's read-only API
// token (CLOUDFLARE_API_TOKEN on the site). Nothing here writes: zone lookup, the GraphQL
// analytics API and the account audit log are all GET-style reads.
//
// A domain whose DNS isn't in Khaneil's Cloudflare account (for example a GitHub Pages site on
// another registrar's nameservers) has no zone, so its traffic and events say "not in your
// Cloudflare account" rather than zero.

import type { EdgeEvent, TrafficInfo } from "../src/properties/types";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Fetcher = typeof fetch;

const API = "https://api.cloudflare.com/client/v4";
const TIMEOUT_MS = 15_000;
/** How far back the events tile looks. */
export const EVENTS_DAYS = 7;
const MAX_EVENTS = 20;

export interface Zone {
  id: string;
  accountId: string;
}

/** Thrown when the domain has no zone the token can see. */
export class NoZone extends Error {}

async function cf(fetcher: Fetcher, token: string, path: string, init: RequestInit = {}): Promise<J> {
  const r = await fetcher(`${API}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}`, "content-type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const j = (await r.json().catch(() => null)) as J | null;
  if (!r.ok || j?.success === false) {
    const msg = j?.errors?.[0]?.message;
    if (r.status === 401 || r.status === 403) throw new Error(`Cloudflare refused the token${msg ? `: ${msg}` : ""}. Check its permissions.`);
    throw new Error(`Cloudflare answered ${r.status}${msg ? `: ${msg}` : ""}`);
  }
  return j ?? {};
}

export async function findZone(fetcher: Fetcher, token: string, domain: string): Promise<Zone> {
  const j = await cf(fetcher, token, `/zones?name=${encodeURIComponent(domain)}&per_page=1`);
  const z = Array.isArray(j.result) ? j.result[0] : null;
  if (!z?.id || !z?.account?.id) throw new NoZone(`${domain} isn't a zone in your Cloudflare account, so Cloudflare has no traffic or events for it.`);
  return { id: String(z.id), accountId: String(z.account.id) };
}

const TRAFFIC_QUERY = `query Traffic($zone: String!, $since: Time!, $until: Time!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequests1hGroups(limit: 25, filter: { datetime_geq: $since, datetime_lt: $until }) {
      sum { requests threats pageViews }
    }
  } }
}`;

/** Sums the hourly groups. Page views stand in for visits; unique visitors can't be summed across hours. */
export function parseTraffic(j: J): TrafficInfo {
  if (Array.isArray(j.errors) && j.errors.length) throw new Error(`Cloudflare analytics: ${j.errors[0]?.message ?? "query failed"}`);
  const groups: J[] = j.data?.viewer?.zones?.[0]?.httpRequests1hGroups ?? [];
  const sum = (k: string) => groups.reduce((n, g) => n + (typeof g?.sum?.[k] === "number" ? g.sum[k] : 0), 0);
  return { requests24h: sum("requests"), visits24h: groups.length ? sum("pageViews") : null, threats24h: groups.length ? sum("threats") : null };
}

export async function traffic(fetcher: Fetcher, token: string, zone: Zone, now: number): Promise<TrafficInfo> {
  const until = new Date(Math.floor(now / 3_600_000) * 3_600_000);
  const since = new Date(until.getTime() - 24 * 3_600_000);
  const j = await cf(fetcher, token, "/graphql", { method: "POST", body: JSON.stringify({ query: TRAFFIC_QUERY, variables: { zone: zone.id, since: since.toISOString(), until: until.toISOString() } }) });
  return parseTraffic(j);
}

/** Audit log entries that concern this site: its zone, its domain, or its Worker. */
export function parseAuditLog(j: J, match: string[]): EdgeEvent[] {
  const needles = match.filter(Boolean).map((m) => m.toLowerCase());
  return (Array.isArray(j.result) ? j.result : [])
    .filter((e: J) => {
      const text = JSON.stringify(e).toLowerCase();
      return needles.some((n) => text.includes(n));
    })
    .map((e: J): EdgeEvent => {
      const what = [e.action?.type, e.resource?.type].filter((s) => typeof s === "string" && s).join(" ");
      return { at: String(e.when ?? ""), action: what || "change", actor: typeof e.actor?.email === "string" ? e.actor.email : typeof e.actor?.type === "string" ? e.actor.type : null };
    })
    .filter((e: EdgeEvent) => !Number.isNaN(Date.parse(e.at)))
    .sort((a: EdgeEvent, b: EdgeEvent) => b.at.localeCompare(a.at))
    .slice(0, MAX_EVENTS);
}

export async function edgeEvents(fetcher: Fetcher, token: string, zone: Zone, domain: string, worker: string | undefined, now: number): Promise<EdgeEvent[]> {
  const since = new Date(now - EVENTS_DAYS * 86_400_000).toISOString();
  const j = await cf(fetcher, token, `/accounts/${zone.accountId}/audit_logs?since=${encodeURIComponent(since)}&direction=desc&per_page=100`);
  return parseAuditLog(j, [zone.id, domain, worker ?? ""]);
}
