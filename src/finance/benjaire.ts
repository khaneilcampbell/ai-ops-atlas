import yaml from "js-yaml";
import type { ManifestIssue } from "../catalog/types";
import { WORKSPACE } from "../modules/workspace";

// Benjaire finance: the business data each Financial District building will hold.
// catalog/workspace/finance.yaml describes only the shape (data sets, fields, sources). Figures are
// never in the repository; a data set's status is worked out when the app runs, from the feeds
// Atlas already has and, later, from records in the local finance store. Nothing in the file can
// mark a data set as live. Format and where imports write: docs/benjaire-finance.md.

export const FINANCE_SCHEMA = "atlas/finance-v1";

/** Atlas feeds that already exist and can serve a data set. */
export const FINANCE_FEEDS = ["ai-spend", "spend-caps"] as const;
export type FinanceFeed = (typeof FINANCE_FEEDS)[number];

export interface FinanceDataset {
  id: string;
  label: string;
  holds: string;
  fields: string[];
  sources: string[];
  feed?: FinanceFeed;
}

export interface BuildingFinance {
  key: string;
  focus: string;
  /** Second line of the facade sign; the first is the workspace name. */
  sign?: string;
  datasets: FinanceDataset[];
}

export interface FinancePlan {
  buildings: Record<string, BuildingFinance>;
}

/** not-connected: no data yet. imported: records from a local import. live: an Atlas feed has data. */
export type FinanceStatus = "not-connected" | "imported" | "live";
export const FINANCE_STATUS_LABEL: Record<FinanceStatus, string> = { "not-connected": "Not connected", imported: "Imported", live: "Live" };

export interface DatasetState {
  dataset: FinanceDataset;
  status: FinanceStatus;
  /** When the data was last updated (ISO), when there is any. */
  asOf: string | null;
  /** Where the shown data came from, when there is any. */
  source: string | null;
}

/** What a feed has right now: null while it has nothing (or isn't loaded). */
export type FeedSnapshot = Partial<Record<FinanceFeed, { asOf: string | null } | null>>;
/** Records already imported into the local store, by data set id. Empty until imports exist. */
export type ImportSnapshot = Readonly<Record<string, { asOf: string; source: string } | undefined>>;

const SIGN_MAX = 22;
const KEY_RE = /^service:financial:[a-z0-9][a-z0-9-]*$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Parses the finance plan. Problems are reported in `issues`, never thrown. */
export function parseFinancePlan(file: string, text: string, issues: ManifestIssue[]): FinancePlan {
  const fail = (message: string) => issues.push({ file, message });
  const empty: FinancePlan = { buildings: {} };
  let doc: unknown;
  try {
    doc = yaml.load(text, { schema: yaml.DEFAULT_SCHEMA });
  } catch (e) {
    fail(`file: invalid YAML (${(e as Error).message.split("\n")[0]})`);
    return empty;
  }
  const root = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  if (root.schema !== FINANCE_SCHEMA) fail(`schema: must be "${FINANCE_SCHEMA}"`);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : []);
  const raw = root.buildings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("buildings: expected a mapping of building ids");
    return empty;
  }
  const buildings: Record<string, BuildingFinance> = {};
  const seen = new Set<string>();
  for (const [key, b] of Object.entries(raw as Record<string, unknown>)) {
    const at = `buildings.${key}`;
    if (!KEY_RE.test(key)) { fail(`${at}: use a Financial District building id such as "service:financial:banks"`); continue; }
    const o = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    const focus = str(o.focus);
    if (!focus) { fail(`${at}.focus: is required`); continue; }
    const sign = str(o.sign);
    if (sign && sign.length > SIGN_MAX) fail(`${at}.sign: at most ${SIGN_MAX} characters, so it fits the facade sign`);
    const datasets: FinanceDataset[] = [];
    (Array.isArray(o.datasets) ? o.datasets : []).forEach((d, i) => {
      const where = `${at}.datasets[${i}]`;
      const r = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
      const id = str(r.id), label = str(r.label), holds = str(r.holds);
      if (!id || !ID_RE.test(id)) return fail(`${where}.id: lowercase letters, numbers and dashes`);
      if (seen.has(id)) return fail(`${where}.id: "${id}" is used by another data set`);
      if (!label || !holds) return fail(`${where}: label and holds are required`);
      const fields = list(r.fields), sources = list(r.sources);
      if (!fields.length || !sources.length) return fail(`${where}: fields and sources need at least one entry`);
      if ("status" in r || "as_of" in r || "value" in r) return fail(`${where}: status, dates and figures are worked out at run time, never written here`);
      const feed = str(r.feed);
      if (feed && !(FINANCE_FEEDS as readonly string[]).includes(feed)) return fail(`${where}.feed: one of ${FINANCE_FEEDS.join(", ")}`);
      seen.add(id);
      datasets.push({ id, label, holds, fields, sources, ...(feed ? { feed: feed as FinanceFeed } : {}) });
    });
    if (!datasets.length) { fail(`${at}.datasets: needs at least one data set`); continue; }
    buildings[key] = { key, focus, ...(sign && sign.length <= SIGN_MAX ? { sign } : {}), datasets };
  }
  return { buildings };
}

/**
 * A data set's status. Live only when its existing Atlas feed has data right now; Imported when the
 * local store holds records for it; otherwise Not connected. Never anything greener than the data.
 */
export function datasetState(dataset: FinanceDataset, feeds: FeedSnapshot, imports: ImportSnapshot = {}): DatasetState {
  const fed = dataset.feed ? feeds[dataset.feed] : null;
  if (fed) return { dataset, status: "live", asOf: fed.asOf, source: dataset.sources[0] ?? null };
  const imported = imports[dataset.id];
  if (imported) return { dataset, status: "imported", asOf: imported.asOf, source: imported.source };
  return { dataset, status: "not-connected", asOf: null, source: null };
}

const files = import.meta.glob("../../catalog/workspace/finance.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const issues: ManifestIssue[] = [];
/** This workspace's finance plan. */
export const FINANCE_PLAN: FinancePlan = Object.values(files).map((t) => parseFinancePlan("workspace/finance.yaml", t, issues))[0] ?? { buildings: {} };
export const financePlanIssues: readonly ManifestIssue[] = issues;

/** The finance data a building holds, when it has a place in the plan. */
export const buildingFinance = (key: string, plan: FinancePlan = FINANCE_PLAN): BuildingFinance | undefined => plan.buildings[key];

/** The business that owns the Financial District: the workspace's own name (workspace.yaml). */
export const FINANCE_BUSINESS = WORKSPACE.name;

/**
 * The two lines of a Financial District facade sign: the workspace name, then the building's
 * `sign`. Undefined when the building has no `sign`, so it keeps its own sign art.
 */
export function financeSignLines(key: string, plan: FinancePlan = FINANCE_PLAN, business: string = FINANCE_BUSINESS): [string, string] | undefined {
  const sign = plan.buildings[key]?.sign;
  return sign && business ? [business, sign] : undefined;
}
