// Investment Operations Center: the read-only connector boundary.
//
// Atlas never talks to a brokerage. On the Mac, Claude Code (with every Robinhood trading tool
// denied) reads the accounts and writes one snapshot file in Atlas's app data folder; the Mac app
// reads that file (src-tauri/src/investments.rs) and everything passes through `sanitizeSnapshot`,
// which keeps only the allowlisted shape below and refuses anything that looks like a full account
// number, credential or order. Disconnect deletes the file. Nothing is sent anywhere, and no real
// figures exist in git: tests and screenshots use the synthetic snapshots at the bottom.
//
// Snapshot file shape (the sync writes exactly this):
//   { "source": "robinhood", "as_of": "<ISO time>", "portfolios": [
//       { "label": "Individual", "kind": "individual", "last4": "1234", "agent_tradable": false,
//         "cash": 12.5, "positions": [{ "symbol": "ABC", "asset_class": "equity", "market_value": 100 }] } ] }
// Only the last four characters of an account number, never the whole number.
// This file has no Vite imports, so a script or Pages Function can reuse the same check.

/** Where a snapshot may come from. */
export const INVESTMENT_SOURCES = ["synthetic", "robinhood"] as const;
export type InvestmentSource = (typeof INVESTMENT_SOURCES)[number];

export const ASSET_CLASSES = ["equity", "etf", "crypto", "option", "cash", "other"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const PORTFOLIO_KINDS = ["individual", "roth_ira", "traditional_ira", "joint", "custodial", "other"] as const;
export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];

/** One position: a symbol, its class and its value. No quantity, cost basis, lots or account. */
export interface Position { symbol: string; asset_class: AssetClass; market_value: number }
/**
 * One brokerage account, minimized: a display label, its kind, the last four characters of its
 * number, whether an agent may trade in it (Robinhood allows exactly one), its cash and positions.
 */
export interface Portfolio { label: string; kind: PortfolioKind; last4: string; agent_tradable: boolean; cash: number; positions: Position[] }
export interface InvestmentSnapshot { source: InvestmentSource; as_of: string; portfolios: Portfolio[] }

const POSITION_KEYS = new Set(["symbol", "asset_class", "market_value"]);
/** Keys that must never reach Atlas, even nested: refusing is safer than silently dropping them. */
const FORBIDDEN_KEY = /account|acct|routing|token|secret|password|ssn|tax_?id|order|transfer|bank/i;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const LABEL = /^[A-Za-z0-9 &'()-]{1,40}$/;
const LAST4 = /^[A-Z0-9]{4}$/;
const MAX_POSITIONS = 200;
const MAX_PORTFOLIOS = 10;

export type SanitizeResult = { ok: true; snapshot: InvestmentSnapshot } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const money = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e12;
const oneOf = (list: readonly string[], v: unknown) => (list as readonly unknown[]).includes(v);

function forbiddenKeys(v: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (Array.isArray(v)) return v.flatMap((x) => forbiddenKeys(x, depth + 1));
  if (!isObj(v)) return [];
  return Object.entries(v).flatMap(([k, x]) => [...(FORBIDDEN_KEY.test(k) ? [k] : []), ...forbiddenKeys(x, depth + 1)]);
}

function sanitizePositions(raw: unknown, at: string, errors: string[]): Position[] {
  if (!Array.isArray(raw)) { errors.push(`${at}.positions: a list`); return []; }
  if (raw.length > MAX_POSITIONS) errors.push(`${at}.positions: at most ${MAX_POSITIONS}`);
  const out: Position[] = [];
  raw.slice(0, MAX_POSITIONS).forEach((p, i) => {
    const here = `${at}.positions[${i}]`;
    if (!isObj(p)) return errors.push(`${here}: expected an object`);
    if (typeof p.symbol !== "string" || !SYMBOL.test(p.symbol)) return errors.push(`${here}.symbol: a ticker symbol`);
    if (!oneOf(ASSET_CLASSES, p.asset_class)) return errors.push(`${here}.asset_class: one of ${ASSET_CLASSES.join(", ")}`);
    if (!money(p.market_value)) return errors.push(`${here}.market_value: a number`);
    out.push(Object.fromEntries(Object.entries(p).filter(([k]) => POSITION_KEYS.has(k))) as unknown as Position);
  });
  return out;
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
  if (!oneOf(INVESTMENT_SOURCES, source)) errors.push(`source: one of ${INVESTMENT_SOURCES.join(", ")}`);
  const asOf = typeof input.as_of === "string" ? new Date(input.as_of) : null;
  if (!asOf || Number.isNaN(asOf.getTime())) errors.push("as_of: an ISO date and time");
  else if (asOf.getTime() > now.getTime() + 5 * 60_000) errors.push("as_of: in the future");
  const raw = Array.isArray(input.portfolios) ? input.portfolios : null;
  if (!raw) errors.push("portfolios: a list");
  else if (raw.length > MAX_PORTFOLIOS) errors.push(`portfolios: at most ${MAX_PORTFOLIOS}`);
  const portfolios: Portfolio[] = [];
  (raw ?? []).slice(0, MAX_PORTFOLIOS).forEach((p, i) => {
    const at = `portfolios[${i}]`;
    if (!isObj(p)) return errors.push(`${at}: expected an object`);
    const before = errors.length;
    if (typeof p.label !== "string" || !LABEL.test(p.label)) errors.push(`${at}.label: a short name`);
    if (!oneOf(PORTFOLIO_KINDS, p.kind)) errors.push(`${at}.kind: one of ${PORTFOLIO_KINDS.join(", ")}`);
    if (typeof p.last4 !== "string" || !LAST4.test(p.last4)) errors.push(`${at}.last4: exactly the last four characters`);
    if (typeof p.agent_tradable !== "boolean") errors.push(`${at}.agent_tradable: true or false`);
    if (!money(p.cash)) errors.push(`${at}.cash: a number`);
    const positions = sanitizePositions(p.positions, at, errors);
    if (errors.length === before) portfolios.push({ label: p.label as string, kind: p.kind as PortfolioKind, last4: p.last4 as string, agent_tradable: p.agent_tradable as boolean, cash: p.cash as number, positions });
  });
  if (portfolios.filter((p) => p.agent_tradable).length > 1) errors.push("portfolios: at most one may be agent_tradable");
  if (errors.length) return { ok: false, errors };
  return { ok: true, snapshot: { source: source as InvestmentSource, as_of: asOf!.toISOString(), portfolios } };
}

/** How fresh the connection is. Never greener than the data. */
export type ConnectionState = "not-connected" | "synced" | "stale";
export const STALE_AFTER_MS = 26 * 3600_000; // a daily sync plus two hours of slack

export function connectionState(snapshot: InvestmentSnapshot | null, now: Date): ConnectionState {
  if (!snapshot || snapshot.source === "synthetic") return "not-connected";
  return now.getTime() - new Date(snapshot.as_of).getTime() > STALE_AFTER_MS ? "stale" : "synced";
}

export const portfolioTotal = (p: Portfolio) => p.cash + p.positions.reduce((a, x) => a + x.market_value, 0);
export const total = (s: InvestmentSnapshot) => s.portfolios.reduce((a, p) => a + portfolioTotal(p), 0);
const cashOf = (s: InvestmentSnapshot) => s.portfolios.reduce((a, p) => a + p.cash, 0);
const positionCount = (s: InvestmentSnapshot) => s.portfolios.reduce((a, p) => a + p.positions.length, 0);
/** "Individual ••1234": the only way an account is named on screen. */
export const portfolioName = (p: Portfolio) => `${p.label} ••${p.last4}`;

/** Data-quality issues worth a look. Facts about the data, never advice. */
export function dataQualityIssues(s: InvestmentSnapshot, now: Date): string[] {
  const issues: string[] = [];
  const many = s.portfolios.length > 1;
  for (const pf of s.portfolios) {
    const where = many ? ` in ${portfolioName(pf)}` : "";
    const seen = new Set<string>();
    for (const p of pf.positions) {
      if (seen.has(p.symbol)) issues.push(`${p.symbol} appears more than once${where}`);
      seen.add(p.symbol);
      if (p.market_value < 0) issues.push(`${p.symbol} has a negative value${where}`);
      if (p.market_value === 0) issues.push(`${p.symbol} has no value${where}; its price may be missing`);
    }
    if (pf.cash < 0) issues.push(`Cash is negative${where}`);
  }
  if (s.source !== "synthetic" && now.getTime() - new Date(s.as_of).getTime() > STALE_AFTER_MS) issues.push("Snapshot is more than a day old");
  return issues;
}

export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;

/**
 * Plain-words operational summary of what changed between two snapshots. Describes, never
 * recommends: no buy, sell, hold or rebalance wording.
 */
export function summarizeChange(prev: InvestmentSnapshot | null, cur: InvestmentSnapshot): string[] {
  const n = cur.portfolios.length;
  const lines = [`Total ${usd(total(cur))} across ${n} account${n === 1 ? "" : "s"}, ${positionCount(cur)} positions and ${usd(cashOf(cur))} cash`];
  if (!prev) return lines;
  lines.push(`Total changed ${signed(total(cur) - total(prev))} since the previous snapshot`);
  if (cashOf(cur) !== cashOf(prev)) lines.push(`Cash changed ${signed(cashOf(cur) - cashOf(prev))}`);
  const symbols = (s: InvestmentSnapshot) => new Set(s.portfolios.flatMap((p) => p.positions.map((x) => x.symbol)));
  const before = symbols(prev);
  const after = symbols(cur);
  const added = [...after].filter((x) => !before.has(x));
  const removed = [...before].filter((x) => !after.has(x));
  if (added.length) lines.push(`New in this snapshot: ${added.join(", ")}`);
  if (removed.length) lines.push(`No longer in this snapshot: ${removed.join(", ")}`);
  return lines;
}

/**
 * Synthetic preview data: invented labels, symbols and figures, not anyone's accounts. Used for
 * the panel preview on the web, tests and screenshots.
 */
export const SYNTHETIC_SNAPSHOTS: readonly [InvestmentSnapshot, InvestmentSnapshot] = [
  { source: "synthetic", as_of: "2026-10-27T21:00:00.000Z", portfolios: [
    { label: "Demo brokerage", kind: "individual", last4: "0000", agent_tradable: false, cash: 400, positions: [
      { symbol: "DEMOA", asset_class: "equity", market_value: 1200 },
      { symbol: "DEMOB", asset_class: "etf", market_value: 2500 },
      { symbol: "DEMOC", asset_class: "equity", market_value: 300 },
    ] },
  ] },
  { source: "synthetic", as_of: "2026-10-28T14:00:00.000Z", portfolios: [
    { label: "Demo brokerage", kind: "individual", last4: "0000", agent_tradable: false, cash: 250, positions: [
      { symbol: "DEMOA", asset_class: "equity", market_value: 1260 },
      { symbol: "DEMOB", asset_class: "etf", market_value: 2475 },
      { symbol: "DEMOD", asset_class: "etf", market_value: 0 },
    ] },
  ] },
];
