import { describe, expect, it } from "vitest";
import type { AggregateHealth } from "../modules/operations";
import type { Loaded } from "../properties/state";
import type { SiteSnapshot } from "../properties/types";
import { PROPERTIES } from "../properties/registry";
import { businessKpis } from "./kpis";

const property = PROPERTIES.find((p) => p.projectId === "benjaire-site")!;
const ci = (health: AggregateHealth["health"], summary = "CI"): AggregateHealth => ({ health, state: "ok", checked: 1, total: 1, failing: [], summary });
const none = { total: 0, failing: 0, observed: 0 };
const snap = (checks: Partial<SiteSnapshot["checks"]>): Loaded<SiteSnapshot> =>
  ({ state: "ready", message: null, at: "2026-11-12T12:00:00Z", value: { domain: property.domain, checks } as SiteSnapshot });
const ok = <T,>(data: T) => ({ state: "ok" as const, source: "t", checkedAt: "2026-11-12T12:00:00Z", data });
const kpi = (k: ReturnType<typeof businessKpis>, id: string) => k.find((x) => x.id === id)!;

describe("business KPIs", () => {
  it("shows unknown, never good, when nothing is read", () => {
    const k = businessKpis({ sites: [{ property, snap: undefined }], ci: ci("unknown", "No CI"), automations: none });
    expect(k.map((x) => x.id)).toEqual(["site", "uptime", "ci", "automations"]);
    expect(k.every((x) => x.state === "unknown")).toBe(true);
  });

  it("reads the site probe and uptime", () => {
    const up = businessKpis({ sites: [{ property, snap: snap({ probe: ok({ status: 200, ms: 120.4, finalUrl: "", cloudflare: true, hsts: true }), uptime: ok({ uptime24h: 99.5, up: true, lastChange: null }) }) }], ci: ci("good"), automations: none });
    expect(kpi(up, "site")).toMatchObject({ state: "good", value: `${property.domain} up · 120 ms` });
    expect(kpi(up, "uptime")).toMatchObject({ state: "good", value: "99.50%" });
    const down = businessKpis({ sites: [{ property, snap: snap({ probe: ok({ status: 503, ms: 50, finalUrl: "", cloudflare: true, hsts: true }), uptime: ok({ uptime24h: 90, up: false, lastChange: null }) }) }], ci: ci("good"), automations: none });
    expect(kpi(down, "site").state).toBe("bad");
    expect(kpi(down, "uptime").state).toBe("bad");
  });

  it("maps CI and automation counts", () => {
    expect(kpi(businessKpis({ sites: [], ci: ci("bad", "CI failing"), automations: none }), "ci")).toMatchObject({ state: "bad", value: "CI failing" });
    expect(kpi(businessKpis({ sites: [], ci: ci("good"), automations: { total: 10, failing: 1, observed: 3 } }), "automations")).toMatchObject({ state: "bad", value: "1 of 10 failing" });
    expect(kpi(businessKpis({ sites: [], ci: ci("good"), automations: { total: 10, failing: 0, observed: 0 } }), "automations").state).toBe("unknown");
    expect(kpi(businessKpis({ sites: [], ci: ci("good"), automations: { total: 10, failing: 0, observed: 4 } }), "automations").state).toBe("good");
  });
});
