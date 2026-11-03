import { describe, expect, it } from "vitest";
import { checkRunState, deploymentState, fromCheckRuns, fromDeployment, type Deploy } from "./deploys";
import { deployIncidents, incidentsFor, siteIncidents } from "./incidents";
import { PROPERTIES, propertyByDomain, propertyForProject } from "./registry";
import type { SiteSnapshot } from "./types";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const BENJAIRE = PROPERTIES[0];
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const deploy = (state: Deploy["state"], hoursAgo: number, id = String(hoursAgo)): Deploy => ({ id, state, at: at(hoursAgo), finishedAt: state === "in_progress" || state === "queued" ? null : at(hoursAgo - 0.05), sha: "abcdef1234567", url: `https://dash.cloudflare.com/build/${id}`, label: "Workers Builds: benjaire-com" });

const ok = <T,>(data: T, checkedAt = at(0)) => ({ state: "ok" as const, source: "test", checkedAt, data });
const none = { state: "not-configured" as const, source: "test", need: "token" };

function site(over: Partial<SiteSnapshot["checks"]> = {}): SiteSnapshot {
  return {
    domain: "benjaire.com",
    checks: {
      domain: ok({ registrar: "Cloudflare, Inc.", registeredAt: null, expiresAt: "2027-04-02T00:00:00.000Z", updatedAt: null, status: [], nameservers: [], dnssec: null }),
      dns: ok({ a: ["104.21.1.1"], aaaa: [], ns: [], mx: [], caa: [], www: [], validated: false }),
      tls: ok({ issuer: "Google Trust Services", notBefore: at(24 * 40), notAfter: "2026-12-19T00:00:00.000Z", names: ["benjaire.com"], current: 1 }),
      probe: ok({ status: 200, ms: 120, finalUrl: "https://benjaire.com/", cloudflare: true, hsts: true }),
      performance: ok({ strategy: "mobile" as const, score: 92, lcpMs: 1800, cls: 0, tbtMs: 20, field: null, reportUrl: "https://pagespeed.web.dev/x" }),
      traffic: none,
      edgeEvents: none,
      uptime: none,
      ...over,
    },
  };
}

describe("the property registry", () => {
  it("maps each website to its building and back", () => {
    expect(propertyForProject("benjaire-site")?.domain).toBe("benjaire.com");
    expect(propertyForProject("portfolio-site")?.domain).toBe("khaneilcampbell.com");
    expect(propertyForProject("ai-ops-atlas")).toBeNull();
    expect(propertyByDomain("KhaneilCampbell.com")?.id).toBe("khaneilcampbell-com");
  });
});

describe("reading deploys from GitHub", () => {
  it("maps check runs to deploy states", () => {
    expect(checkRunState({ status: "completed", conclusion: "success" })).toBe("success");
    expect(checkRunState({ status: "completed", conclusion: "failure" })).toBe("failure");
    expect(checkRunState({ status: "completed", conclusion: "timed_out" })).toBe("failure");
    expect(checkRunState({ status: "completed", conclusion: "cancelled" })).toBe("cancelled");
    expect(checkRunState({ status: "in_progress" })).toBe("in_progress");
    expect(checkRunState({ status: "queued" })).toBe("queued");
  });

  it("keeps only the deploy's check runs", () => {
    const j = {
      check_runs: [
        { id: 1, name: "Workers Builds: benjaire-com", status: "completed", conclusion: "failure", started_at: at(1), completed_at: at(0.9), details_url: "https://dash.cloudflare.com/b/1" },
        { id: 2, name: "site", status: "completed", conclusion: "success", started_at: at(1) },
      ],
    };
    const d = fromCheckRuns(j, "abc1234", "Workers Builds");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ id: "check:1", state: "failure", url: "https://dash.cloudflare.com/b/1", sha: "abc1234" });
    expect(fromCheckRuns(null as never, "x", "Workers Builds")).toEqual([]);
  });

  it("maps GitHub Pages deployments and their newest status", () => {
    expect(deploymentState({ state: "success" })).toBe("success");
    expect(deploymentState({ state: "error" })).toBe("failure");
    expect(deploymentState({ state: "inactive" })).toBe("success");
    expect(deploymentState({ state: "in_progress" })).toBe("in_progress");
    expect(deploymentState(undefined)).toBe("queued");
    const d = fromDeployment({ id: 9, sha: "f00ba12", environment: "github-pages", created_at: at(2) }, { state: "failure", created_at: at(1.9), log_url: "https://github.com/x/actions/runs/1" }, "https://github.com/khaneilcampbell/khaneilcampbell.com");
    expect(d).toMatchObject({ id: "deployment:9", state: "failure", url: "https://github.com/x/actions/runs/1", label: "github-pages" });
  });
});

describe("deploy incidents", () => {
  it("opens one actionable incident when the newest deploy failed", () => {
    const [i, ...rest] = deployIncidents(BENJAIRE, [deploy("failure", 1, "a"), deploy("success", 5, "b")], NOW);
    expect(rest).toEqual([]);
    expect(i).toMatchObject({ kind: "deploy-failed", severity: "critical", key: "benjaire-com:deploy:a" });
    expect(i.actions.map((a) => a.label)).toEqual(["Build log", "Cloudflare builds", "Fix with Claude"]);
    expect(i.actions[2].url).toContain("labels=claude-fix");
  });

  it("treats a failure followed by a good deploy as history", () => {
    expect(deployIncidents(BENJAIRE, [deploy("success", 1), deploy("failure", 5)], NOW)).toEqual([]);
    // A running deploy doesn't hide the failure before it.
    expect(deployIncidents(BENJAIRE, [deploy("in_progress", 0.1), deploy("failure", 5)], NOW).map((i) => i.kind)).toEqual(["deploy-failed"]);
  });

  it("flags a deploy that has run too long", () => {
    expect(deployIncidents(BENJAIRE, [deploy("in_progress", 1)], NOW).map((i) => i.kind)).toEqual(["deploy-stuck"]);
    expect(deployIncidents(BENJAIRE, [deploy("in_progress", 0.2)], NOW)).toEqual([]);
  });
});

describe("site incidents", () => {
  it("has none for a healthy site", () => {
    expect(siteIncidents(BENJAIRE, site(), NOW)).toEqual([]);
  });

  it("raises a site that errors or doesn't answer", () => {
    expect(siteIncidents(BENJAIRE, site({ probe: ok({ status: 503, ms: 50, finalUrl: "https://benjaire.com/", cloudflare: true, hsts: false }) }), NOW)[0]).toMatchObject({ kind: "site-down", severity: "critical" });
    const down = site({ probe: { state: "error", source: "t", checkedAt: at(0), message: "No answer in time" } });
    expect(siteIncidents(BENJAIRE, down, NOW).map((i) => i.kind)).toEqual(["site-down"]);
    // If DNS couldn't be checked either, the checker may be the problem: unknown, not an incident.
    expect(siteIncidents(BENJAIRE, { ...down, checks: { ...down.checks, dns: { state: "error", source: "t", checkedAt: at(0), message: "x" } } }, NOW)).toEqual([]);
  });

  it("warns two weeks before the certificate ends and turns critical in the last days", () => {
    const tls = (days: number) => site({ tls: ok({ issuer: "GTS", notBefore: at(24 * 80), notAfter: new Date(NOW + days * 86_400_000).toISOString(), names: [], current: 1 }) });
    expect(siteIncidents(BENJAIRE, tls(20), NOW)).toEqual([]);
    expect(siteIncidents(BENJAIRE, tls(10), NOW)[0]).toMatchObject({ kind: "tls-expiring", severity: "warning", title: "Certificate expires in 10 days" });
    expect(siteIncidents(BENJAIRE, tls(1.5), NOW)[0]).toMatchObject({ severity: "critical", title: "Certificate expires in 1 day" });
  });

  it("warns a month before the domain registration ends", () => {
    const dom = (days: number) => site({ domain: ok({ registrar: "Cloudflare, Inc.", registeredAt: null, expiresAt: new Date(NOW + days * 86_400_000).toISOString(), updatedAt: null, status: [], nameservers: [], dnssec: null }) });
    expect(siteIncidents(BENJAIRE, dom(45), NOW)).toEqual([]);
    expect(siteIncidents(BENJAIRE, dom(20), NOW)[0]).toMatchObject({ kind: "domain-expiring", severity: "warning" });
    expect(siteIncidents(BENJAIRE, dom(3), NOW)[0].severity).toBe("critical");
  });

  it("flags missing addresses and a poor mobile score", () => {
    const kinds = siteIncidents(BENJAIRE, site({ dns: ok({ a: [], aaaa: [], ns: [], mx: [], caa: [], www: [], validated: false }), performance: ok({ strategy: "mobile" as const, score: 31, lcpMs: null, cls: null, tbtMs: null, field: null, reportUrl: "https://pagespeed.web.dev/x" }) }), NOW).map((i) => i.kind);
    expect(kinds).toEqual(["no-address", "slow"]);
  });

  it("puts critical incidents first", () => {
    const list = incidentsFor(BENJAIRE, site({ performance: ok({ strategy: "mobile" as const, score: 31, lcpMs: null, cls: null, tbtMs: null, field: null, reportUrl: "https://pagespeed.web.dev/x" }) }), [deploy("failure", 1)], NOW);
    expect(list.map((i) => i.severity)).toEqual(["critical", "warning"]);
    expect(incidentsFor(BENJAIRE, null, null, NOW)).toEqual([]);
  });
});
