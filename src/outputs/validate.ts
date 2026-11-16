import { OUTPUT_CATEGORIES, OUTPUT_TYPES, type AgentOutput, type ChartData, type OutputCategory, type TableData } from "./types";

// Checks every output before it's drawn. Outputs are data from outside Atlas (n8n, GitHub, a
// person), so text is redacted, links must be https without credentials, numbers must be finite
// and sizes are capped. Nothing here executes or embeds content.

export const MAX_TEXT = 20_000;
export const MAX_ROWS = 500;
export const MAX_COLUMNS = 12;
export const MAX_BARS = 40;
export const MAX_SOURCES = 20;

/** An https URL without user or password, or null. Every link and image in the Studio goes through this. */
export function safeUrl(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 2000) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
/** Raster images only (no SVG, which can carry script), over https. */
export const safeImageUrl = (u: unknown): string | null => {
  const s = safeUrl(u);
  return s && IMAGE_EXT.test(new URL(s).pathname) ? s : null;
};

const SECRETS: RegExp[] = [
  /\b(?:sk|pk|rk)[-_](?:live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{12,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /\b(api[_-]?key|access[_-]?token|secret|password|passwd|token)\s*[:=]\s*["']?[^\s"',;]{4,}/gi,
];

/** Hides credentials that may have leaked into an output. Applied to every string the Studio shows. */
export function redact(s: string): string {
  let out = s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
  for (const re of SECRETS) out = out.replace(re, (m, key?: string) => (typeof key === "string" && /[:=]/.test(m) ? `${key}: [redacted]` : "[redacted]"));
  return out;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A chart's data, or null when any value isn't a real number. Values are never invented or clamped. */
export function chartData(d: unknown): ChartData | null {
  if (!d || typeof d !== "object") return null;
  const c = d as Partial<ChartData>;
  if (!Array.isArray(c.series) || c.series.length === 0 || c.series.length > MAX_BARS) return null;
  if (!c.series.every((p) => p && isStr(p.label) && finite(p.value) && p.value >= 0)) return null;
  if (c.max !== undefined && (!finite(c.max) || c.max <= 0)) return null;
  if (c.unit !== undefined && !isStr(c.unit)) return null;
  return { series: c.series.map((p) => ({ label: redact(p.label).slice(0, 120), value: p.value })), unit: c.unit, max: c.max };
}

export function tableData(d: unknown): TableData | null {
  if (!d || typeof d !== "object") return null;
  const t = d as Partial<TableData>;
  if (!Array.isArray(t.columns) || !t.columns.length || t.columns.length > MAX_COLUMNS || !t.columns.every(isStr)) return null;
  if (!Array.isArray(t.rows) || !t.rows.every((r) => Array.isArray(r) && r.every((c) => isStr(c) || finite(c)))) return null;
  return { columns: t.columns.map(redact), rows: t.rows.map((r) => r.slice(0, t.columns!.length).map((c) => (isStr(c) ? redact(c) : c))) };
}

/**
 * Pulls "name — 82" style scores out of a ranked list. Returns null unless every item has one
 * number, so a chart is only drawn from numbers that are actually in the record.
 */
export function parseScores(items: readonly string[]): ChartData | null {
  if (!items.length || items.length > MAX_BARS) return null;
  const re = /^(?:\d+[.)]\s+)?(.+?)\s*(?:[-—–:|(]|\bscore\b)\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*\)?\s*$/i;
  const out: ChartData["series"] = [];
  let outOf: number | undefined;
  for (const raw of items) {
    const m = re.exec(raw.trim());
    if (!m) return null;
    out.push({ label: m[1].trim(), value: Number(m[2]) });
    if (m[3]) outOf = Math.max(outOf ?? 0, Number(m[3]));
  }
  return chartData({ series: out, max: outOf });
}

/** Every reason an output can't be drawn as it is; empty when it can. */
export function outputProblems(o: unknown): string[] {
  if (!o || typeof o !== "object") return ["Not an output."];
  const x = o as Partial<AgentOutput>;
  const errs: string[] = [];
  for (const k of ["id", "workflowRunId", "taskId", "agentId", "nodeId", "title", "createdAt"] as const) if (!isStr(x[k])) errs.push(`Missing ${k}.`);
  if (!OUTPUT_TYPES.includes(x.type as never)) errs.push("Unknown output type.");
  if (!OUTPUT_CATEGORIES.includes(x.category as never)) errs.push("Unknown category.");
  if (!["verified", "unverified", "simulated"].includes(x.verificationStatus as never)) errs.push("Unknown verification status.");
  if (x.mode === "simulation" && x.verificationStatus !== "simulated") errs.push("A simulated output must be labelled simulated.");
  if (x.mode === "live" && x.verificationStatus === "simulated") errs.push("A live output can't be simulated.");
  if (x.verificationStatus === "verified" && x.state !== "complete") errs.push("Only a complete output can be verified.");
  if (x.artifact && !safeUrl(x.artifact.url)) errs.push("Artifact link isn't a safe https link.");
  const d = x.structuredData;
  if (x.type === "chart" && !chartData(d)) errs.push("Chart data isn't a list of real numbers.");
  if (x.type === "table" && !tableData(d)) errs.push("Table data isn't rows and columns.");
  if ((x.type === "link" || x.type === "document" || x.type === "image") && !x.artifact && !(x.type === "document" && d)) errs.push("No artifact to open.");
  if (x.type === "image" && x.artifact && !safeImageUrl(x.artifact.url)) errs.push("Only https PNG, JPEG, WebP or GIF images are shown.");
  return errs;
}

/** One card per id: a repeated execution event rebuilds the same id, and the last copy wins. */
export function dedupe(list: readonly AgentOutput[]): AgentOutput[] {
  const m = new Map<string, AgentOutput>();
  for (const o of list) m.set(o.id, o);
  return [...m.values()];
}

export type OutputFilter = "all" | OutputCategory;

export function filterOutputs(list: readonly AgentOutput[], f: OutputFilter, opts: { history?: boolean; nodeId?: string | null } = {}): AgentOutput[] {
  return list.filter((o) => {
    if (!opts.history && !o.latest) return false;
    if (opts.nodeId && o.nodeId !== opts.nodeId) return false;
    if (f === "all") return true;
    if (f === "errors") return o.category === "errors";
    return o.category === f;
  });
}

/**
 * Keeps only outputs this view may show: live ones from runs held on this device for the active
 * mode, simulated ones only in simulation. An id from anywhere else is refused, so having an id
 * never grants access. (Atlas has one owner and no tenants; the site itself sits behind
 * Cloudflare Access and ALLOWED_EMAILS.)
 */
export function scopeOutputs(list: readonly AgentOutput[], scope: { mode: "live" | "simulation"; runIds: ReadonlySet<string> }): AgentOutput[] {
  return list.filter((o) => o.mode === scope.mode && scope.runIds.has(o.workflowRunId));
}
