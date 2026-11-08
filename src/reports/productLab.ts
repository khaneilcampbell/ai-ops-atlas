// Benjaire Product Lab's monthly next-product brief (an n8n Agent, docs/product-lab.md), as the
// agent posts it to /api/hooks/reports. Atlas never calls a model for it: this file only checks the
// shape and recomputes the scorecard, so a brief whose totals don't add up is refused, not shown.

export const PRODUCT_LAB_AGENT = "benjaire-product-lab" as const;

export const PILLARS = ["digital", "consumer_tech", "digital_product", "lifestyle"] as const;
export const PILLAR_LABEL: Record<(typeof PILLARS)[number], string> = {
  digital: "Digital solution",
  consumer_tech: "Consumer tech",
  digital_product: "Digital product",
  lifestyle: "Lifestyle",
};

/** The Benjaire scorecard (skill "Benjaire Product Scoring"), weights in percent. */
export const CRITERIA = [
  { key: "demand", label: "Demand", weight: 25 },
  { key: "gap", label: "Gap", weight: 20 },
  { key: "fit", label: "Fit", weight: 15 },
  { key: "margin", label: "Margin", weight: 15 },
  { key: "validate", label: "Validate", weight: 15 },
  { key: "synergy", label: "Synergy", weight: 10 },
] as const;
export type Criterion = (typeof CRITERIA)[number]["key"];

export interface ProductPick {
  title: string;
  pillar: (typeof PILLARS)[number];
  offer: string;
  risk: string;
}
export type ScoreRow = { idea: string; total: number } & Record<Criterion, number>;
export interface Source {
  label: string;
  url: string;
}

export interface ProductLabReport {
  agent: typeof PRODUCT_LAB_AGENT;
  at: string;
  /** The month the brief is for, YYYY-MM. */
  month: string;
  topic: string;
  model: string;
  /** A pick stays a hypothesis until real demand evidence (signups, preorders, sales) exists. */
  status: "hypothesis" | "validated";
  evidence: string[];
  top: ProductPick;
  runners_up: [ProductPick, ProductPick];
  scorecard: ScoreRow[];
  sources: Source[];
  /** Week 1 to week 4 of the validation plan. */
  plan: [string, string, string, string];
  metrics: string[];
  change_since_last_month: string;
  notion_url: string | null;
}

/** Weighted total out of 5.00, rounded to two places, computed here and never taken on trust. */
export function scoreTotal(row: Record<Criterion, number>): number {
  return Math.round(CRITERIA.reduce((n, c) => n + row[c.key] * c.weight, 0)) / 100;
}

type J = Record<string, unknown>;
const obj = (x: unknown): x is J => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max: number, empty = false): x is string => typeof x === "string" && x.length <= max && (empty || x.trim().length > 0);
const list = (x: unknown, min: number, max: number, len: number): x is string[] => Array.isArray(x) && x.length >= min && x.length <= max && x.every((s) => text(s, len));
const only = (o: J, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);
const https = (x: unknown): x is string => {
  if (!text(x, 500)) return false;
  try {
    return new URL(x).protocol === "https:";
  } catch {
    return false;
  }
};

const PICK_KEYS = ["title", "pillar", "offer", "risk"] as const;
const ROW_KEYS = ["idea", ...CRITERIA.map((c) => c.key), "total"] as const;
const KEYS = ["agent", "at", "month", "topic", "model", "status", "evidence", "top", "runners_up", "scorecard", "sources", "plan", "metrics", "change_since_last_month", "notion_url"] as const;

function validPick(p: unknown): p is ProductPick {
  return obj(p) && only(p, PICK_KEYS) && text(p.title, 160) && (PILLARS as readonly unknown[]).includes(p.pillar) && text(p.offer, 300) && text(p.risk, 400);
}
function validRow(r: unknown): r is ScoreRow {
  if (!obj(r) || !only(r, ROW_KEYS) || !text(r.idea, 160)) return false;
  if (!CRITERIA.every((c) => Number.isInteger(r[c.key]) && (r[c.key] as number) >= 1 && (r[c.key] as number) <= 5)) return false;
  return typeof r.total === "number" && Math.abs(r.total - scoreTotal(r as Record<Criterion, number>)) < 0.006;
}

/** Every field checked, nothing extra allowed, totals recomputed, picks tied to the scorecard. */
export function validProductLabReport(value: unknown): value is ProductLabReport {
  if (!obj(value) || !only(value, KEYS)) return false;
  const r = value;
  if (r.agent !== PRODUCT_LAB_AGENT) return false;
  if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) return false;
  if (typeof r.month !== "string" || !/^20\d\d-(0[1-9]|1[0-2])$/.test(r.month)) return false;
  if (!text(r.topic, 160) || !text(r.model, 64) || !text(r.change_since_last_month, 600, true)) return false;
  if (r.status !== "hypothesis" && r.status !== "validated") return false;
  if (!list(r.evidence, 0, 6, 300) || (r.status === "validated" && r.evidence.length === 0)) return false;
  if (!validPick(r.top) || !Array.isArray(r.runners_up) || r.runners_up.length !== 2 || !r.runners_up.every(validPick)) return false;
  if (!Array.isArray(r.scorecard) || r.scorecard.length < 3 || r.scorecard.length > 10 || !r.scorecard.every(validRow)) return false;
  const rows = r.scorecard as ScoreRow[];
  const best = Math.max(...rows.map((x) => x.total));
  const row = (title: string) => rows.find((x) => x.idea === title);
  if (row(r.top.title)?.total !== best) return false;
  if (!r.runners_up.every((p) => row(p.title) && p.title !== (r.top as ProductPick).title)) return false;
  if (!Array.isArray(r.sources) || r.sources.length < 1 || r.sources.length > 20 || !r.sources.every((s) => obj(s) && only(s, ["label", "url"]) && text(s.label, 160) && https(s.url))) return false;
  if (!list(r.plan, 4, 4, 400) || !list(r.metrics, 1, 6, 200)) return false;
  return r.notion_url === null || https(r.notion_url);
}
