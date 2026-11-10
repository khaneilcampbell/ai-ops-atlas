import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Loaded } from "../properties/state";
import type { SiteSnapshot } from "../properties/types";
import type { StoredReport } from "../reports/model";
import { growthSites, researchBriefs, siteTraffic } from "./studio";

const AT = "2026-11-10T12:00:00.000Z";
const ok = <T,>(data: T) => ({ state: "ok" as const, source: "test", checkedAt: AT, data });
const none = { state: "not-configured" as const, source: "test", need: "A read-only Cloudflare API token" };

function snap(traffic: SiteSnapshot["checks"]["traffic"], cloudflare = true): Loaded<SiteSnapshot> {
  const value = {
    domain: "benjaire.com",
    checks: { probe: ok({ status: 200, ms: 100, finalUrl: "https://benjaire.com/", cloudflare, hsts: true }), traffic },
  } as unknown as SiteSnapshot;
  return { state: "ready", message: null, value, at: AT };
}

const SITE = growthSites()[0];
const lab = () => JSON.parse(readFileSync(new URL("../../ops/product-lab/fixtures/report.json", import.meta.url), "utf8"));
const stored = (id: number, at: string, month: string, over: Record<string, unknown> = {}): StoredReport => ({ id, at, body: { ...lab(), month, ...over } });

describe("Growth & Marketing Studio site traffic", () => {
  it("watches the Benjaire site", () => {
    expect(growthSites().map((s) => s.domain)).toEqual(["benjaire.com"]);
  });

  it("shows Cloudflare's counts when the check counted them", () => {
    const t = siteTraffic(SITE, snap(ok({ requests24h: 5120, visits24h: 812, threats24h: 3 })));
    expect(t).toMatchObject({ state: "counted", data: { requests24h: 5120, visits24h: 812, threats24h: 3 }, checkedAt: AT });
  });

  it("never reads a DNS-only zero as no visitors", () => {
    expect(siteTraffic(SITE, snap(ok({ requests24h: 0, visits24h: 0, threats24h: 0 }), false))).toMatchObject({ state: "not-proxied", data: null });
    // Proxied through Cloudflare, a zero is a real zero.
    expect(siteTraffic(SITE, snap(ok({ requests24h: 0, visits24h: 0, threats24h: 0 }), true)).state).toBe("counted");
  });

  it("says what is missing instead of a number", () => {
    expect(siteTraffic(SITE, snap(none))).toMatchObject({ state: "not-set-up", note: "A read-only Cloudflare API token", data: null });
    expect(siteTraffic(SITE, snap({ state: "error", source: "test", checkedAt: AT, message: "Cloudflare answered 403" }))).toMatchObject({ state: "unavailable", note: "Cloudflare answered 403" });
    expect(siteTraffic(SITE, { state: "error", message: "The site answered 502", value: null, at: null })).toMatchObject({ state: "unavailable", note: "The site answered 502" });
    expect(siteTraffic(SITE, { state: "loading", message: null, value: null, at: null }).state).toBe("loading");
    expect(siteTraffic(SITE, undefined).state).toBe("loading");
  });
});

describe("Growth & Marketing Studio research briefs", () => {
  it("lists the newest month first with the brief's own top score", () => {
    const list = researchBriefs([stored(1, "2026-10-01T09:00:00Z", "2026-10"), stored(2, "2026-11-01T09:00:00Z", "2026-11")]);
    expect(list.map((b) => b.month)).toEqual(["2026-11", "2026-10"]);
    expect(list[0]).toMatchObject({ id: 2, topIdea: "Flow for dental clinics", score: 4.55, validated: false });
    expect(list[0].runnersUp).toHaveLength(2);
  });

  it("keeps only the latest run for a month and caps the list", () => {
    const list = researchBriefs([stored(1, "2026-11-01T09:00:00Z", "2026-11"), stored(3, "2026-11-02T09:00:00Z", "2026-11"), stored(4, "2026-09-01T09:00:00Z", "2026-09")], 1);
    expect(list.map((b) => b.id)).toEqual([3]);
  });

  it("leaves out other agents' reports", () => {
    const scout = { id: 9, at: AT, body: { ...lab(), agent: "github-opportunity-scout" } } as unknown as StoredReport;
    expect(researchBriefs([scout])).toEqual([]);
  });
});
