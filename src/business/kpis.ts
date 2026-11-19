import type { AggregateHealth } from "../modules/operations";
import type { Loaded } from "../properties/state";
import type { SiteSnapshot } from "../properties/types";
import type { WebProperty } from "../properties/registry";
import type { assignmentCounts } from "./assignments";

// Business Operations HQ: a handful of operational KPIs for a business, each read from a check Atlas
// already runs (the site probe and uptime page, GitHub CI, and the automation assignments list).
// A KPI with no data says so and stays "unknown"; it never shows as good.

export type KpiState = "good" | "warn" | "bad" | "unknown";

export interface Kpi {
  id: "site" | "uptime" | "ci" | "automations";
  label: string;
  value: string;
  state: KpiState;
}

export interface KpiInputs {
  sites: { property: WebProperty; snap: Loaded<SiteSnapshot> | undefined }[];
  ci: AggregateHealth;
  automations: ReturnType<typeof assignmentCounts>;
}

function siteKpi(sites: KpiInputs["sites"]): Kpi {
  const base = { id: "site", label: "Website" } as const;
  if (!sites.length) return { ...base, value: "No website registered", state: "unknown" };
  const rows = sites.map(({ property, snap }) => ({ domain: property.domain, probe: snap?.value?.checks.probe }));
  const down = rows.filter((r) => r.probe?.state === "error" || (r.probe?.state === "ok" && r.probe.data.status >= 400));
  if (down.length) return { ...base, value: `Down: ${down.map((r) => r.domain).join(", ")}`, state: "bad" };
  const up = rows.flatMap((r) => (r.probe?.state === "ok" ? [{ domain: r.domain, ms: r.probe.data.ms }] : []));
  if (!up.length) return { ...base, value: "Not checked here", state: "unknown" };
  const one = up.length === 1 ? `${up[0].domain} up · ${Math.round(up[0].ms)} ms` : `${up.length} of ${rows.length} sites up`;
  return { ...base, value: one, state: up.length === rows.length ? "good" : "warn" };
}

function uptimeKpi(sites: KpiInputs["sites"]): Kpi {
  const base = { id: "uptime", label: "Uptime, 24 h" } as const;
  const known = sites.flatMap(({ snap }) => { const u = snap?.value?.checks.uptime; return u?.state === "ok" && u.data.uptime24h !== null ? [u.data.uptime24h] : []; });
  if (!known.length) return { ...base, value: "No uptime monitor connected", state: "unknown" };
  const worst = Math.min(...known);
  return { ...base, value: `${worst.toFixed(worst >= 99.95 ? 0 : 2)}%`, state: worst >= 99 ? "good" : worst >= 95 ? "warn" : "bad" };
}

function ciKpi(ci: AggregateHealth): Kpi {
  return { id: "ci", label: "Build checks", value: ci.summary, state: ci.health === "good" ? "good" : ci.health === "bad" ? "bad" : "unknown" };
}

function automationsKpi(c: KpiInputs["automations"]): Kpi {
  const base = { id: "automations", label: "Automations" } as const;
  if (!c.total) return { ...base, value: "None assigned", state: "unknown" };
  if (c.failing) return { ...base, value: `${c.failing} of ${c.total} failing`, state: "bad" };
  if (!c.observed) return { ...base, value: `${c.total} assigned, no runs seen here`, state: "unknown" };
  return { ...base, value: `${c.observed} of ${c.total} with a run seen, none failing`, state: "good" };
}

/** The business's KPIs, always in the same order. */
export function businessKpis(i: KpiInputs): Kpi[] {
  return [siteKpi(i.sites), uptimeKpi(i.sites), ciKpi(i.ci), automationsKpi(i.automations)];
}
