import { fixIssueUrl } from "../lib/fixWithClaude";
import type { Deploy } from "./deploys";
import type { WebProperty } from "./registry";
import type { SiteSnapshot } from "./types";
import { formatTime } from "../lib/timezone";

// Incidents on a website building: something Khaneil should act on, each with the links to act. They
// come only from observed data (a failed build, an expiring certificate, a site that didn't
// answer). A check that couldn't run is shown on the dashboard as unknown, never as an incident
// and never as healthy.

export type Severity = "critical" | "warning";

export interface IncidentAction {
  label: string;
  url: string;
}

export interface Incident {
  /** Identifies this occurrence, so dismissing it lasts until the next one. */
  key: string;
  propertyId: string;
  kind: "deploy-failed" | "deploy-stuck" | "site-down" | "no-address" | "tls-expiring" | "domain-expiring" | "slow";
  severity: Severity;
  title: string;
  detail: string;
  since: string;
  actions: IncidentAction[];
}

const DAY = 86_400_000;
/** Cloudflare renews edge certificates about 30 days ahead, so two weeks left means renewal failed. */
export const TLS_WARN_DAYS = 14;
export const TLS_CRITICAL_DAYS = 3;

/**
 * Warning and critical thresholds in days for a certificate. Issuers renew with about a third of
 * the lifetime left, so a short-lived certificate (Let's Encrypt's 45- or 6-day ones) is normal
 * with fewer days left than a 90-day one: the thresholds shrink with the lifetime.
 */
export function tlsThresholds(notBefore: string, notAfter: string): { warn: number; critical: number } {
  const life = (Date.parse(notAfter) - Date.parse(notBefore)) / DAY;
  if (!(life > 0)) return { warn: TLS_WARN_DAYS, critical: TLS_CRITICAL_DAYS };
  return { warn: Math.min(TLS_WARN_DAYS, life / 6), critical: Math.min(TLS_CRITICAL_DAYS, life / 20) };
}
/** Registrars auto-renew about a month ahead; inside that, check auto-renew and the card. */
export const DOMAIN_WARN_DAYS = 30;
export const DOMAIN_CRITICAL_DAYS = 7;
export const SLOW_SCORE = 50;
export const STUCK_MS = 30 * 60_000;

const days = (ms: number) => Math.max(0, Math.floor(ms / DAY));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const dateOnly = (iso: string) => iso.slice(0, 10);

/** What deploy incidents need to know about where they happened. */
export type DeployTarget = Pick<WebProperty, "id" | "domain" | "repository" | "deployConsole">;

function fixLink(p: Pick<WebProperty, "domain" | "repository">, title: string, detail: string, evidence: IncidentAction[]): IncidentAction[] {
  const url = fixIssueUrl({ kind: "Website incident", title: `${p.domain}: ${title}`, detail, repo: p.repository, links: evidence });
  return url ? [{ label: "Fix with Claude", url }] : [];
}

/** The newest finished deploy decides whether production is broken; an older failure followed by a success is history. */
export function deployIncidents(p: DeployTarget, deploys: Deploy[], now: number): Incident[] {
  const out: Incident[] = [];
  const finished = deploys.find((d) => d.state === "success" || d.state === "failure");
  if (finished?.state === "failure") {
    const evidence = [{ label: "Build log", url: finished.url }, p.deployConsole].filter((a) => /^https:\/\//.test(a.url));
    const title = "Production deploy failed";
    const detail = `${finished.label} failed on ${finished.sha.slice(0, 7)}. The site keeps serving the last good deploy until a new one succeeds.`;
    out.push({ key: `${p.id}:deploy:${finished.id}`, propertyId: p.id, kind: "deploy-failed", severity: "critical", title, detail, since: finished.finishedAt ?? finished.at, actions: [...evidence, ...fixLink(p, title, detail, evidence)] });
  }
  const running = deploys.find((d) => d.state === "in_progress" || d.state === "queued");
  if (running && now - Date.parse(running.at) > STUCK_MS) {
    out.push({
      key: `${p.id}:stuck:${running.id}`,
      propertyId: p.id,
      kind: "deploy-stuck",
      severity: "warning",
      title: "Deploy hasn't finished",
      detail: `${running.label} on ${running.sha.slice(0, 7)} has been ${running.state === "queued" ? "queued" : "running"} for over ${Math.round((now - Date.parse(running.at)) / 60_000)} minutes.`,
      since: running.at,
      actions: [{ label: "Build log", url: running.url }, p.deployConsole].filter((a) => /^https:\/\//.test(a.url)),
    });
  }
  return out;
}

export function siteIncidents(p: WebProperty, s: SiteSnapshot, now: number): Incident[] {
  const out: Incident[] = [];
  const { probe, dns, tls, domain, performance } = s.checks;

  if (probe.state === "ok" && probe.data.status >= 500) {
    const detail = `${p.url} answered HTTP ${probe.data.status} when checked ${formatTime(probe.checkedAt)}.`;
    out.push({ key: `${p.id}:down:${dateOnly(probe.checkedAt)}`, propertyId: p.id, kind: "site-down", severity: "critical", title: "Site is returning errors", detail, since: probe.checkedAt, actions: [{ label: "Open the site", url: p.url }, p.deployConsole, ...fixLink(p, "Site is returning errors", detail, [])] });
  } else if (probe.state === "error" && dns.state === "ok") {
    // DNS answered but the site didn't: the site is down, not the checker.
    const detail = `${p.url} didn't answer: ${probe.message}.`;
    out.push({ key: `${p.id}:down:${dateOnly(probe.checkedAt)}`, propertyId: p.id, kind: "site-down", severity: "critical", title: "Site didn't answer", detail, since: probe.checkedAt, actions: [{ label: "Open the site", url: p.url }, p.deployConsole] });
  }

  if (dns.state === "ok" && !dns.data.a.length && !dns.data.aaaa.length) {
    out.push({ key: `${p.id}:no-address:${dateOnly(dns.checkedAt)}`, propertyId: p.id, kind: "no-address", severity: "critical", title: "Domain has no address records", detail: `${p.domain} has no A or AAAA records, so browsers can't find the site.`, since: dns.checkedAt, actions: [{ label: "DNS records", url: "https://dash.cloudflare.com/?to=/:account/:zone/dns/records" }] });
  }

  if (tls.state === "ok") {
    const left = Date.parse(tls.data.notAfter) - now;
    const { warn, critical } = tlsThresholds(tls.data.notBefore, tls.data.notAfter);
    if (left < warn * DAY) {
      const d = days(left);
      out.push({
        key: `${p.id}:tls:${tls.data.notAfter}`,
        propertyId: p.id,
        kind: "tls-expiring",
        severity: left < critical * DAY ? "critical" : "warning",
        title: `Certificate expires in ${plural(d, "day")}`,
        detail: `The newest logged certificate for ${p.domain} (${tls.data.issuer ?? "unknown issuer"}) ends ${dateOnly(tls.data.notAfter)}. Automatic renewal normally happens weeks earlier.`,
        since: new Date(Date.parse(tls.data.notAfter) - warn * DAY).toISOString(),
        actions: [p.host === "GitHub Pages" ? { label: "Pages settings", url: `https://github.com/${p.repository}/settings/pages` } : { label: "Certificates", url: "https://dash.cloudflare.com/?to=/:account/:zone/ssl-tls/edge-certificates" }, { label: "Certificate log", url: `https://crt.sh/?q=${encodeURIComponent(p.domain)}` }],
      });
    }
  }

  if (domain.state === "ok" && domain.data.expiresAt) {
    const left = Date.parse(domain.data.expiresAt) - now;
    if (left < DOMAIN_WARN_DAYS * DAY) {
      const d = days(left);
      out.push({
        key: `${p.id}:domain:${domain.data.expiresAt}`,
        propertyId: p.id,
        kind: "domain-expiring",
        severity: d < DOMAIN_CRITICAL_DAYS ? "critical" : "warning",
        title: `Domain expires in ${plural(d, "day")}`,
        detail: `${p.domain} is registered until ${dateOnly(domain.data.expiresAt)}${domain.data.registrar ? ` with ${domain.data.registrar}` : ""}. Check that auto-renew is on and the card is current.`,
        since: new Date(Date.parse(domain.data.expiresAt) - DOMAIN_WARN_DAYS * DAY).toISOString(),
        actions: [{ label: "Registrar", url: "https://dash.cloudflare.com/?to=/:account/domains" }],
      });
    }
  }

  if (performance.state === "ok" && performance.data.score !== null && performance.data.score < SLOW_SCORE) {
    out.push({
      key: `${p.id}:slow:${dateOnly(performance.checkedAt)}`,
      propertyId: p.id,
      kind: "slow",
      severity: "warning",
      title: `Mobile speed score ${performance.data.score}`,
      detail: `PageSpeed Insights scored ${p.url} ${performance.data.score} of 100 on mobile (below ${SLOW_SCORE}).`,
      since: performance.checkedAt,
      actions: [{ label: "PageSpeed report", url: performance.data.reportUrl }],
    });
  }
  return out;
}

const RANK: Record<Severity, number> = { critical: 0, warning: 1 };

export function incidentsFor(p: WebProperty, site: SiteSnapshot | null, deploys: Deploy[] | null, now: number): Incident[] {
  return [...(deploys ? deployIncidents(p, deploys, now) : []), ...(site ? siteIncidents(p, site, now) : [])].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.since.localeCompare(a.since));
}

/** Days until an ISO date, for the dashboard tiles. */
export const daysUntil = (iso: string, now: number) => Math.floor((Date.parse(iso) - now) / DAY);
