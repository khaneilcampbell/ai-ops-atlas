import type { Health } from "../lib/derive";
import type { Loaded } from "../properties/state";
import type { SiteSnapshot, TrafficInfo } from "../properties/types";
import { PROPERTIES, type WebProperty } from "../properties/registry";
import type { StoredReport } from "../reports/model";
import { PRODUCT_LAB_AGENT, type ProductLabReport } from "../reports/productLab";

// What the Growth & Marketing Studio shows, from data Atlas already reads: the workspace's
// marketing sites' traffic (the Cloudflare analytics in the site checks, server/properties.ts) and
// the product research briefs its research agent posts (src/reports). Nothing here calls a model
// or a new service, and nothing is estimated: a number shows only when a check counted it.

/** This workspace's marketing sites, by property id (src/properties/registry.ts). */
export const GROWTH_SITES: readonly string[] = ["benjaire-com"];

/** This workspace's product research agent (src/reports/productLab.ts). */
export const RESEARCH_AGENT = PRODUCT_LAB_AGENT;

export type TrafficState = "counted" | "not-proxied" | "not-set-up" | "not-connected" | "unavailable" | "loading";

export interface SiteTraffic {
  site: Pick<WebProperty, "id" | "domain" | "url">;
  state: TrafficState;
  /** Set only when state is "counted". */
  data: TrafficInfo | null;
  /** What the check needs, or why it failed. */
  note: string | null;
  checkedAt: string | null;
}

export const growthSites = (): WebProperty[] => GROWTH_SITES.flatMap((id) => PROPERTIES.find((p) => p.id === id) ?? []);

/**
 * A site's last 24 hours as Cloudflare counted them. A DNS-only (grey cloud) record sends visitors
 * straight to the host, so a zero there means "not counted", not "no visitors".
 */
export function siteTraffic(site: WebProperty, snap: Loaded<SiteSnapshot> | undefined): SiteTraffic {
  const base = { site: { id: site.id, domain: site.domain, url: site.url }, data: null, note: null, checkedAt: null };
  const s = snap?.value;
  if (!s) {
    if (snap?.state === "error") return { ...base, state: "unavailable", note: snap.message };
    // "off" means this copy of Atlas has no site to ask (a plain local preview, or a Mac without
    // website sync). Nothing failed, so it is not "unavailable".
    if (snap?.state === "off") return { ...base, state: "not-connected", note: snap.message ?? "Site checks aren't connected here" };
    return { ...base, state: "loading" };
  }
  const t = s.checks.traffic;
  if (t.state === "not-configured") return { ...base, state: "not-set-up", note: t.need };
  if (t.state === "error") return { ...base, state: "unavailable", note: t.message, checkedAt: t.checkedAt };
  const probe = s.checks.probe;
  if (probe.state === "ok" && !probe.data.cloudflare && t.data.requests24h === 0) {
    return { ...base, state: "not-proxied", note: "DNS only, so visits go straight to the host and Cloudflare can't count them", checkedAt: t.checkedAt };
  }
  return { ...base, state: "counted", data: t.data, checkedAt: t.checkedAt };
}

export interface ResearchBrief {
  id: number;
  at: string;
  month: string;
  topIdea: string;
  /** The top idea's scorecard total out of 5.00, as the brief's own scorecard has it. */
  score: number;
  validated: boolean;
  runnersUp: string[];
  notionUrl: string | null;
}

const isLab = (r: StoredReport): r is StoredReport<ProductLabReport> => r.body.agent === RESEARCH_AGENT;

/** The newest briefs first, one per month (a re-run for the same month replaces the older one). */
export function researchBriefs(reports: readonly StoredReport[], limit = 4): ResearchBrief[] {
  const byMonth = new Map<string, StoredReport<ProductLabReport>>();
  for (const r of reports.filter(isLab)) {
    const prev = byMonth.get(r.body.month);
    if (!prev || Date.parse(r.at) > Date.parse(prev.at)) byMonth.set(r.body.month, r);
  }
  return [...byMonth.values()]
    .sort((a, b) => b.body.month.localeCompare(a.body.month) || Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit)
    .map(({ id, at, body }) => ({
      id,
      at,
      month: body.month,
      topIdea: body.top.title,
      score: body.scorecard.find((x) => x.idea === body.top.title)?.total ?? 0,
      validated: body.status === "validated",
      runnersUp: body.runners_up.map((p) => p.title),
      notionUrl: body.notion_url,
    }));
}

/** How the research briefs answered (src/reports/client.ts ReportsState.state). */
export type BriefsState = "off" | "loading" | "ready" | "error";

export interface StudioHealth {
  health: Health;
  state: "loading" | "ok" | "partial" | "none";
  summary: string;
}

const TRAFFIC_WORD: Record<TrafficState, string> = {
  counted: "counted", "not-proxied": "not counted (DNS only)", "not-set-up": "not set up", "not-connected": "not connected here",
  unavailable: "unavailable", loading: "loading",
};
const BRIEFS_WORD: Record<BriefsState, string> = { ready: "read from the site", off: "not connected here", error: "unavailable", loading: "loading" };

/**
 * The studio's health, from its own two sources rather than a repository's CI (the building has
 * none). Live only when real data came back from both: Cloudflare counted the site's traffic and
 * the site answered with the research agent's briefs. One of two is "needs a look"; none is
 * "not verified". Nothing here is ever green because a source is quiet or missing.
 */
export function studioHealth(traffic: readonly SiteTraffic[], briefs: BriefsState): StudioHealth {
  const trafficLive = traffic.length > 0 && traffic.every((t) => t.state === "counted");
  const briefsLive = briefs === "ready";
  const trafficState: TrafficState = trafficLive ? "counted" : (traffic.find((t) => t.state !== "counted")?.state ?? "not-set-up");
  const parts = `Site traffic ${TRAFFIC_WORD[trafficState]} · briefs ${BRIEFS_WORD[briefs]}`;
  if (trafficState === "loading" || briefs === "loading") {
    if (!trafficLive && !briefsLive) return { health: "unknown", state: "loading", summary: "Checking the site…" };
  }
  if (trafficLive && briefsLive) return { health: "good", state: "ok", summary: `Live · ${parts}` };
  if (trafficLive || briefsLive) return { health: "warn", state: "partial", summary: `Partly live · ${parts}` };
  return { health: "unknown", state: "none", summary: parts };
}
