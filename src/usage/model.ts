// API usage records and their aggregation. Pure functions so the numbers are testable.
// Nothing here calls a provider or a model: records come from runs Atlas already logged
// (token counts the provider reported, priced locally) or from a file the user imported.
import type { Run } from "../intel/types";
import { isReviewRun, REVIEW_AGENT_NAME } from "../intel/ecosystem";

/** "estimated" = reported tokens × the prices configured in Atlas. "billed" = the provider's own cost figure. */
export type CostKind = "estimated" | "billed";

export interface UsageRecord {
  id: string;
  at: string;
  /** Lowercase provider id: "anthropic", "openai", or whatever an import names. */
  provider: string;
  model: string | null;
  agent: string;
  /** GitHub repository (owner/name) or project the usage belongs to, when known. */
  project: string | null;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** null when no price was configured for the model, so the cost is unknown. */
  costUsd: number | null;
  costKind: CostKind;
  source: "atlas" | "import" | "sync";
}

/** Runs the repository intelligence agent logged. Only runs that reached the provider carry usage. */
export function recordsFromRuns(runs: Run[], agent: string): UsageRecord[] {
  const out: UsageRecord[] = [];
  for (const r of runs) {
    if (!r.usage) continue;
    const u = r.usage;
    out.push({
      id: `atlas:${r.id}`,
      at: r.started_at ?? r.queued_at,
      provider: "anthropic",
      model: u.served_by ?? r.model ?? null,
      agent: isReviewRun(r) ? REVIEW_AGENT_NAME : agent,
      project: isReviewRun(r) ? "All catalog repositories" : r.repo || null,
      requests: Math.max(1, r.attempts),
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens,
      cacheWrite: u.cache_creation_input_tokens,
      costUsd: r.cost_usd,
      costKind: "estimated",
      source: "atlas",
    });
  }
  return out;
}

// ── Imported records ─────────────────────────────────────────────────────────

export const MAX_IMPORTED = 5_000;

/**
 * Parses a usage file: a JSON array of records, or `{ "records": [...] }`. The format is in
 * docs/api-usage.md. Rows that don't validate are skipped and counted, never guessed at.
 */
export function parseImport(text: string, fileName: string): { records: UsageRecord[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file isn't valid JSON. See docs/api-usage.md for the format.");
  }
  const rows = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { records?: unknown }).records) ? (data as { records: unknown[] }).records : null;
  if (!rows) throw new Error('Expected a JSON array of usage records, or an object with a "records" array.');

  const records: UsageRecord[] = [];
  let skipped = 0;
  rows.slice(0, MAX_IMPORTED).forEach((row, i) => {
    const rec = importRow(row, `import:${fileName}:${i}`);
    if (rec) records.push(rec);
    else skipped++;
  });
  skipped += Math.max(0, rows.length - MAX_IMPORTED);
  return { records, skipped };
}

function num(v: unknown): number | undefined {
  if (v == null) return 0;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;
}

function importRow(row: unknown, id: string): UsageRecord | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const raw = str(r.at) ?? str(r.date);
  // A bare date is a local calendar day, not UTC midnight.
  const at = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw;
  const provider = str(r.provider)?.toLowerCase();
  if (!at || !provider || Number.isNaN(Date.parse(at))) return null;
  const requests = num(r.requests);
  const input = num(r.input_tokens);
  const output = num(r.output_tokens);
  const cacheRead = num(r.cache_read_tokens ?? r.cached_tokens);
  const cacheWrite = num(r.cache_write_tokens);
  const cost = r.cost_usd == null ? null : num(r.cost_usd);
  if ([requests, input, output, cacheRead, cacheWrite, cost].some((v) => v === undefined)) return null;
  // A cost is provider-billed only when the file says so; anything else stays an estimate.
  const costKind: CostKind = r.cost_type === "billed" ? "billed" : "estimated";
  return {
    id,
    at: new Date(at).toISOString(),
    provider,
    model: str(r.model),
    agent: str(r.agent) ?? "Unattributed",
    project: str(r.project),
    requests: requests!,
    input: input!,
    output: output!,
    cacheRead: cacheRead!,
    cacheWrite: cacheWrite!,
    costUsd: cost ?? null,
    costKind,
    source: "import",
  };
}

// ── Aggregation ──────────────────────────────────────────────────────────────

export type Period = "day" | "week" | "month";
export const PERIODS: { id: Period; label: string; span: string }[] = [
  { id: "day", label: "Daily", span: "last 24 hours" },
  { id: "week", label: "Weekly", span: "last 7 days" },
  { id: "month", label: "Monthly", span: "last 30 days" },
];

export interface Totals {
  records: number;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  estimatedUsd: number;
  billedUsd: number;
  /** Records with no cost because no price was configured for their model. */
  unpriced: number;
}

export interface Bucket {
  start: number;
  end: number;
  requests: number;
  tokens: number;
  estimatedUsd: number;
  billedUsd: number;
}

export type GroupBy = "agent" | "project" | "provider" | "model";

export interface GroupRow extends Totals {
  key: string;
  providers: string[];
  last: string;
}

const HOUR = 3_600_000;

function emptyTotals(): Totals {
  return { records: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estimatedUsd: 0, billedUsd: 0, unpriced: 0 };
}

function add(t: Totals, r: UsageRecord) {
  t.records++;
  t.requests += r.requests;
  t.input += r.input;
  t.output += r.output;
  t.cacheRead += r.cacheRead;
  t.cacheWrite += r.cacheWrite;
  if (r.costUsd == null) t.unpriced++;
  else if (r.costKind === "billed") t.billedUsd += r.costUsd;
  else t.estimatedUsd += r.costUsd;
}

/** Bucket edges for a period: 24 hourly buckets, or 7 / 30 local calendar days ending today. */
export function bucketEdges(period: Period, now: Date): number[] {
  if (period === "day") {
    const top = new Date(now);
    top.setMinutes(0, 0, 0);
    const end = top.getTime() + HOUR;
    return Array.from({ length: 25 }, (_, i) => end - (24 - i) * HOUR);
  }
  const days = period === "week" ? 7 : 30;
  const edges: number[] = [];
  for (let i = days - 1; i >= -1; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    edges.push(d.getTime());
  }
  return edges;
}

export interface Summary {
  totals: Totals;
  buckets: Bucket[];
  inWindow: UsageRecord[];
}

export function summarize(records: UsageRecord[], period: Period, now = new Date()): Summary {
  const edges = bucketEdges(period, now);
  const buckets: Bucket[] = edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1], requests: 0, tokens: 0, estimatedUsd: 0, billedUsd: 0 }));
  const totals = emptyTotals();
  const inWindow: UsageRecord[] = [];
  for (const r of records) {
    const t = Date.parse(r.at);
    if (!(t >= edges[0] && t < edges[edges.length - 1])) continue;
    inWindow.push(r);
    add(totals, r);
    const b = buckets.find((x) => t >= x.start && t < x.end);
    if (!b) continue;
    b.requests += r.requests;
    b.tokens += r.input + r.output + r.cacheRead + r.cacheWrite;
    if (r.costUsd != null) {
      if (r.costKind === "billed") b.billedUsd += r.costUsd;
      else b.estimatedUsd += r.costUsd;
    }
  }
  return { totals, buckets, inWindow };
}

function groupKey(r: UsageRecord, by: GroupBy): string {
  if (by === "agent") return r.agent;
  if (by === "project") return r.project ?? "No project";
  if (by === "provider") return r.provider;
  return r.model ?? "Unknown model";
}

export function groupRows(records: UsageRecord[], by: GroupBy): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const r of records) {
    const key = groupKey(r, by);
    let row = map.get(key);
    if (!row) {
      row = { key, providers: [], last: r.at, ...emptyTotals() };
      map.set(key, row);
    }
    add(row, r);
    if (!row.providers.includes(r.provider)) row.providers.push(r.provider);
    if (r.at > row.last) row.last = r.at;
  }
  return [...map.values()];
}

export const cost = (t: Totals) => t.estimatedUsd + t.billedUsd;

/** The five agents with the highest known cost in the window; agents with no known cost are left out. */
export function topAgents(records: UsageRecord[], n = 5): GroupRow[] {
  return groupRows(records, "agent")
    .filter((r) => cost(r) > 0)
    .sort((a, b) => cost(b) - cost(a))
    .slice(0, n);
}

export function providerLabel(id: string): string {
  if (id === "anthropic") return "Anthropic";
  if (id === "openai") return "OpenAI";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

export function money(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return "<$0.01";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
