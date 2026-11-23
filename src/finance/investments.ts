// Investment Operations Center: the read-only connector boundary.
//
// Atlas never talks to a brokerage. A source outside Atlas (later an n8n workflow) may deliver a
// snapshot; everything passes through `sanitizeSnapshot`, which keeps only the allowlisted shape
// below and refuses anything that looks like an account number, credential or order. Nothing here
// stores data: the snapshot lives in memory for the panel and is gone on reload.
//
// There is no supported read-only brokerage connection today (docs/benjaire-finance.md), so the
// only source is the synthetic preview at the bottom of this file. No real figures exist in git.
// This file has no Vite imports, so a Pages Function can reuse the same check later.

/** Where a snapshot may come from. Only `synthetic` exists today. */
export const INVESTMENT_SOURCES = ["synthetic"] as const;
export type InvestmentSource = (typeof INVESTMENT_SOURCES)[number];

export const ASSET_CLASSES = ["equity", "etf", "cash", "other"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** One position: a symbol, its class and its value. No quantity, cost basis, lots or account. */
export interface Position { symbol: string; asset_class: AssetClass; market_value: number }
export interface InvestmentSnapshot { source: InvestmentSource; as_of: string; cash: number; positions: Position[] }

const POSITION_KEYS = new Set(["symbol", "asset_class", "market_value"]);
/** Keys that must never reach Atlas, even nested: refusing is safer than silently dropping them. */
const FORBIDDEN_KEY = /account|acct|routing|token|secret|password|ssn|tax_?id|order|transfer|bank/i;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const MAX_POSITIONS = 200;

export type SanitizeResult = { ok: true; snapshot: InvestmentSnapshot } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const money = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e12;

function forbiddenKeys(v: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (Array.isArray(v)) return v.flatMap((x) => forbiddenKeys(x, depth + 1));
  if (!isObj(v)) return [];
  return Object.entries(v).flatMap(([k, x]) => [...(FORBIDDEN_KEY.test(k) ? [k] : []), ...forbiddenKeys(x, depth + 1)]);
}

/**
 * Checks an inbound snapshot against the allowlist. Errors name fields, never values, so a
 * rejected payload can be logged without leaking figures. Unknown harmless keys are dropped.
 */
export function sanitizeSnapshot(input: unknown, now: Date = new Date()): SanitizeResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["snapshot: expected an object"] };
  const banned = [...new Set(forbiddenKeys(input))];
  if (banned.length) return { ok: false, errors: [`refused: fields not allowed in Atlas (${banned.join(", ")})`] };
  const source = input.source;
  if (!(INVESTMENT_SOURCES as readonly unknown[]).includes(source)) errors.push(`source: one of ${INVESTMENT_SOURCES.join(", ")}`);
  const asOf = typeof input.as_of === "string" ? new Date(input.as_of) : null;
  if (!asOf || Number.isNaN(asOf.getTime())) errors.push("as_of: an ISO date and time");
  else if (asOf.getTime() > now.getTime() + 5 * 60_000) errors.push("as_of: in the future");
  if (!money(input.cash)) errors.push("cash: a number");
  const raw = Array.isArray(input.positions) ? input.positions : null;
  if (!raw) errors.push("positions: a list");
  else if (raw.length > MAX_POSITIONS) errors.push(`positions: at most ${MAX_POSITIONS}`);
  const positions: Position[] = [];
  (raw ?? []).slice(0, MAX_POSITIONS).forEach((p, i) => {
    if (!isObj(p)) return errors.push(`positions[${i}]: expected an object`);
    if (typeof p.symbol !== "string" || !SYMBOL.test(p.symbol)) return errors.push(`positions[${i}].symbol: a ticker symbol`);
    if (!(ASSET_CLASSES as readonly unknown[]).includes(p.asset_class)) return errors.push(`positions[${i}].asset_class: one of ${ASSET_CLASSES.join(", ")}`);
    if (!money(p.market_value)) return errors.push(`positions[${i}].market_value: a number`);
    positions.push(Object.fromEntries(Object.entries(p).filter(([k]) => POSITION_KEYS.has(k))) as unknown as Position);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, snapshot: { source: source as InvestmentSource, as_of: asOf!.toISOString(), cash: input.cash as number, positions } };
}

/** How fresh the connection is. Never greener than the data. */
export type ConnectionState = "not-connected" | "synced" | "stale";
export const STALE_AFTER_MS = 26 * 3600_000; // a daily sync plus two hours of slack

export function connectionState(snapshot: InvestmentSnapshot | null, now: Date): ConnectionState {
  if (!snapshot || snapshot.source === "synthetic") return "not-connected";
  return now.getTime() - new Date(snapshot.as_of).getTime() > STALE_AFTER_MS ? "stale" : "synced";
}

export const total = (s: InvestmentSnapshot) => s.cash + s.positions.reduce((a, p) => a + p.market_value, 0);

/** Data-quality issues worth a look. Facts about the data, never advice. */
export function dataQualityIssues(s: InvestmentSnapshot, now: Date): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const p of s.positions) {
    if (seen.has(p.symbol)) issues.push(`${p.symbol} appears more than once`);
    seen.add(p.symbol);
    if (p.market_value < 0) issues.push(`${p.symbol} has a negative value`);
    if (p.market_value === 0) issues.push(`${p.symbol} has no value; its price may be missing`);
  }
  if (s.cash < 0) issues.push("Cash is negative");
  if (s.source !== "synthetic" && now.getTime() - new Date(s.as_of).getTime() > STALE_AFTER_MS) issues.push("Snapshot is more than a day old");
  return issues;
}

const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;

/**
 * Plain-words operational summary of what changed between two snapshots. Describes, never
 * recommends: no buy, sell, hold or rebalance wording.
 */
export function summarizeChange(prev: InvestmentSnapshot | null, cur: InvestmentSnapshot): string[] {
  const lines = [`Total ${usd(total(cur))} across ${cur.positions.length} positions and ${usd(cur.cash)} cash`];
  if (!prev) return lines;
  lines.push(`Total changed ${signed(total(cur) - total(prev))} since the previous snapshot`);
  if (cur.cash !== prev.cash) lines.push(`Cash changed ${signed(cur.cash - prev.cash)}`);
  const before = new Map(prev.positions.map((p) => [p.symbol, p]));
  const now = new Set(cur.positions.map((p) => p.symbol));
  const added = cur.positions.filter((p) => !before.has(p.symbol)).map((p) => p.symbol);
  const removed = prev.positions.filter((p) => !now.has(p.symbol)).map((p) => p.symbol);
  if (added.length) lines.push(`New in this snapshot: ${added.join(", ")}`);
  if (removed.length) lines.push(`No longer in this snapshot: ${removed.join(", ")}`);
  return lines;
}

/**
 * Synthetic preview data: invented symbols and figures, not anyone's holdings. Used for the panel
 * preview, tests and screenshots until a supported read-only source exists.
 */
export const SYNTHETIC_SNAPSHOTS: readonly [InvestmentSnapshot, InvestmentSnapshot] = [
  { source: "synthetic", as_of: "2026-10-27T21:00:00.000Z", cash: 400, positions: [
    { symbol: "DEMOA", asset_class: "equity", market_value: 1200 },
    { symbol: "DEMOB", asset_class: "etf", market_value: 2500 },
    { symbol: "DEMOC", asset_class: "equity", market_value: 300 },
  ] },
  { source: "synthetic", as_of: "2026-10-28T14:00:00.000Z", cash: 250, positions: [
    { symbol: "DEMOA", asset_class: "equity", market_value: 1260 },
    { symbol: "DEMOB", asset_class: "etf", market_value: 2475 },
    { symbol: "DEMOD", asset_class: "etf", market_value: 0 },
  ] },
];
