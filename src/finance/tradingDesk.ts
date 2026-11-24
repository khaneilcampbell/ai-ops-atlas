// Trading desk: the limits, the trade journal and the risk check behind the Trading desk tab of
// the Investment Operations Center.
//
// Atlas never trades. When Khaneil switches trading on, a Claude Code session that Khaneil runs on
// the Mac (the Trade Desk seat) is the only thing that may place orders, and only in the one
// account Robinhood lets an agent trade in (Agentic). Before each order that session runs the same
// check as `checkTrade` below and writes the outcome to a journal file in Atlas's app data folder
// (`investments/journal.json`); the Mac app reads that file and passes it through
// `sanitizeJournal`, which keeps only the allowlisted shape and refuses anything that looks like an
// account number, credential or money movement. The website shows only the synthetic journal at
// the bottom. Operational summaries, not investment advice: nothing here suggests what to trade.
//
// Journal file shape (the Trade Desk writes exactly this):
//   { "entries": [ { "at": "<ISO time>", "seat": "trade-desk", "side": "buy", "symbol": "ABC",
//       "asset_class": "equity", "amount": 20, "check": "passed", "status": "filled",
//       "note": "Khaneil asked for this" } ] }
// This file has no Vite imports, so a script or Pages Function can reuse the same check.

import { type AssetClass, type InvestmentSnapshot, type Portfolio } from "./investments";

/** Khaneil's limits (2026-11-24: "for trades $80 max per week"). Changing them is a code change Khaneil reviews. */
export interface TradingLimits {
  /** Most that agent trades (buys and sells together) may add up to in any 7 days, in dollars. */
  weekly_max: number;
  /** Asset classes the Trade Desk may trade. */
  allowed: readonly AssetClass[];
}
export const TRADING_LIMITS: TradingLimits = { weekly_max: 80, allowed: ["equity", "etf"] };
export const WEEK_MS = 7 * 24 * 3600_000;

export const SEATS = ["trade-desk", "portfolio-sync", "risk-limits", "trade-journal", "market-research", "reporting"] as const;
export type Seat = (typeof SEATS)[number];
export const SIDES = ["buy", "sell"] as const;
export type Side = (typeof SIDES)[number];
export const CHECKS = ["passed", "blocked"] as const;
export type Check = (typeof CHECKS)[number];
/** proposed: checked, not sent. submitted/filled/rejected/cancelled: what Robinhood said after it was sent. */
export const STATUSES = ["proposed", "blocked", "submitted", "filled", "rejected", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];

export interface JournalEntry { at: string; seat: Seat; side: Side; symbol: string; asset_class: AssetClass; amount: number; check: Check; status: Status; note: string }
export interface Journal { entries: JournalEntry[] }

/** The six seats of the trading team and what each may do. Only the Trade Desk may ever send an order. */
export interface SeatInfo { id: Seat; name: string; role: string; uses_ai: boolean; can_trade: boolean }
export const TEAM: readonly SeatInfo[] = [
  { id: "trade-desk", name: "Trade Desk", role: "Claude Code, run by you. Places orders on the Agentic account only, within your limits.", uses_ai: true, can_trade: true },
  { id: "portfolio-sync", name: "Portfolio Sync", role: "Reads balances and holdings into the snapshot on your Mac.", uses_ai: false, can_trade: false },
  { id: "risk-limits", name: "Risk and Limits", role: "Checks every order against your limits. Can block, never place.", uses_ai: false, can_trade: false },
  { id: "trade-journal", name: "Trade Journal", role: "Logs each order: who, what, why and the result.", uses_ai: false, can_trade: false },
  { id: "market-research", name: "Market Research", role: "Watchlist quotes, earnings dates and news. Facts only, no picks.", uses_ai: true, can_trade: false },
  { id: "reporting", name: "Reporting", role: "Weekly totals of agent trades from the journal.", uses_ai: false, can_trade: false },
];

const ENTRY_KEYS = new Set(["at", "seat", "side", "symbol", "asset_class", "amount", "check", "status", "note"]);
/** Never in a journal, even nested: account numbers, credentials and money movement. */
const FORBIDDEN_KEY = /account|acct|routing|token|secret|password|ssn|tax_?id|transfer|bank|card/i;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
/** A short plain note. Digit runs of 6+ are refused so an account number can't hide in it. */
const NOTE = /^[^\n\r<>]{0,140}$/;
const MAX_ENTRIES = 500;
const ASSET_CLASSES: readonly AssetClass[] = ["equity", "etf", "crypto", "option", "cash", "other"];

export type JournalResult = { ok: true; journal: Journal } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = (list: readonly string[], v: unknown) => (list as readonly unknown[]).includes(v);

function forbiddenKeys(v: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (Array.isArray(v)) return v.flatMap((x) => forbiddenKeys(x, depth + 1));
  if (!isObj(v)) return [];
  return Object.entries(v).flatMap(([k, x]) => [...(FORBIDDEN_KEY.test(k) ? [k] : []), ...forbiddenKeys(x, depth + 1)]);
}

/** Checks a journal file against the allowlist. Errors name fields, never values. */
export function sanitizeJournal(input: unknown, now: Date = new Date()): JournalResult {
  if (!isObj(input)) return { ok: false, errors: ["journal: expected an object"] };
  const banned = [...new Set(forbiddenKeys(input))];
  if (banned.length) return { ok: false, errors: [`refused: fields not allowed in Atlas (${banned.join(", ")})`] };
  if (!Array.isArray(input.entries)) return { ok: false, errors: ["entries: a list"] };
  const errors: string[] = [];
  if (input.entries.length > MAX_ENTRIES) errors.push(`entries: at most ${MAX_ENTRIES}; keep the latest`);
  const entries: JournalEntry[] = [];
  input.entries.slice(0, MAX_ENTRIES).forEach((e, i) => {
    const at = `entries[${i}]`;
    if (!isObj(e)) return errors.push(`${at}: expected an object`);
    const before = errors.length;
    const when = typeof e.at === "string" ? new Date(e.at) : null;
    if (!when || Number.isNaN(when.getTime())) errors.push(`${at}.at: an ISO date and time`);
    else if (when.getTime() > now.getTime() + 5 * 60_000) errors.push(`${at}.at: in the future`);
    if (!oneOf(SEATS, e.seat)) errors.push(`${at}.seat: one of ${SEATS.join(", ")}`);
    if (!oneOf(SIDES, e.side)) errors.push(`${at}.side: buy or sell`);
    if (typeof e.symbol !== "string" || !SYMBOL.test(e.symbol)) errors.push(`${at}.symbol: a ticker symbol`);
    if (!oneOf(ASSET_CLASSES, e.asset_class)) errors.push(`${at}.asset_class: one of ${ASSET_CLASSES.join(", ")}`);
    if (typeof e.amount !== "number" || !Number.isFinite(e.amount) || e.amount <= 0 || e.amount > 1e7) errors.push(`${at}.amount: a dollar amount above 0`);
    if (!oneOf(CHECKS, e.check)) errors.push(`${at}.check: passed or blocked`);
    if (!oneOf(STATUSES, e.status)) errors.push(`${at}.status: one of ${STATUSES.join(", ")}`);
    if (typeof e.note !== "string" || !NOTE.test(e.note) || /\d{6,}/.test(e.note)) errors.push(`${at}.note: up to 140 characters, no long numbers`);
    if (e.check === "blocked" && e.status !== "blocked") errors.push(`${at}.status: a blocked check can't be sent`);
    if (e.seat !== "trade-desk" && oneOf(["submitted", "filled", "rejected", "cancelled"], e.status)) errors.push(`${at}.seat: only the Trade Desk sends orders`);
    if (errors.length === before) entries.push(Object.fromEntries(Object.entries(e).filter(([k]) => ENTRY_KEYS.has(k))) as unknown as JournalEntry);
  });
  if (errors.length) return { ok: false, errors };
  entries.sort((a, b) => b.at.localeCompare(a.at));
  return { ok: true, journal: { entries } };
}

/** Sent orders count toward the weekly limit; proposals, blocks, rejections and cancellations don't. */
const COUNTS = new Set<Status>(["submitted", "filled"]);

/** Dollars traded by agents in the last 7 days. */
export function tradedThisWeek(journal: Journal, now: Date): number {
  const from = now.getTime() - WEEK_MS;
  return journal.entries
    .filter((e) => COUNTS.has(e.status) && new Date(e.at).getTime() > from && new Date(e.at).getTime() <= now.getTime())
    .reduce((a, e) => a + e.amount, 0);
}

export interface Proposal { side: Side; symbol: string; asset_class: AssetClass; amount: number }
export type CheckResult = { ok: true; left_after: number } | { ok: false; reasons: string[] };

/**
 * The Risk and Limits check: whether a proposed agent trade fits the limits. Facts about the limits
 * only; it never judges whether a trade is a good idea.
 */
export function checkTrade(p: Proposal, journal: Journal, account: Portfolio | null, now: Date, limits: TradingLimits = TRADING_LIMITS): CheckResult {
  const reasons: string[] = [];
  if (!account) reasons.push("No agent trading account in the latest snapshot");
  else if (!account.agent_tradable) reasons.push("Agents may trade only in the Agentic account");
  if (!SYMBOL.test(p.symbol)) reasons.push("Not a ticker symbol");
  if (!limits.allowed.includes(p.asset_class)) reasons.push(`Only ${limits.allowed.join(" and ")} are allowed`);
  if (!(p.amount > 0)) reasons.push("Amount must be above $0");
  const left = limits.weekly_max - tradedThisWeek(journal, now);
  if (p.amount > left) reasons.push(`Over the weekly limit: $${round(left)} of $${limits.weekly_max} left this week`);
  if (account && p.side === "buy" && p.amount > account.cash) reasons.push("More than the account's cash");
  if (account && p.side === "sell") {
    const held = account.positions.find((x) => x.symbol === p.symbol)?.market_value ?? 0;
    if (p.amount > held) reasons.push(`More than the ${p.symbol} held in the account`);
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, left_after: round(left - p.amount) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The one account agents may trade in, if the snapshot has it. */
export const agentAccount = (s: InvestmentSnapshot | null) => s?.portfolios.find((p) => p.agent_tradable) ?? null;

export type AlertLevel = "warn" | "bad" | "quiet";
export interface DeskAlert { level: AlertLevel; text: string }

/** Alerts for the desk: facts about data, limits and blocked or rejected orders. Never advice. */
export function deskAlerts(snapshot: InvestmentSnapshot | null, stale: boolean, journal: Journal, now: Date, limits: TradingLimits = TRADING_LIMITS): DeskAlert[] {
  const out: DeskAlert[] = [];
  if (!snapshot) out.push({ level: "warn", text: "No account snapshot yet" });
  else if (stale) out.push({ level: "warn", text: "Account snapshot is more than a day old" });
  if (snapshot && !agentAccount(snapshot)) out.push({ level: "warn", text: "No agent trading account in the snapshot" });
  const used = tradedThisWeek(journal, now);
  if (used >= limits.weekly_max) out.push({ level: "bad", text: `Weekly limit reached: $${round(used)} of $${limits.weekly_max}` });
  else if (used >= limits.weekly_max * 0.75) out.push({ level: "warn", text: `$${round(used)} of the $${limits.weekly_max} weekly limit used` });
  const week = journal.entries.filter((e) => new Date(e.at).getTime() > now.getTime() - WEEK_MS);
  const blocked = week.filter((e) => e.status === "blocked").length;
  const rejected = week.filter((e) => e.status === "rejected").length;
  out.push(blocked ? { level: "warn", text: `${blocked} order${blocked === 1 ? "" : "s"} blocked by the limits this week` } : { level: "quiet", text: "No blocked orders this week" });
  out.push(rejected ? { level: "bad", text: `${rejected} order${rejected === 1 ? "" : "s"} rejected by Robinhood this week` } : { level: "quiet", text: "No rejected orders this week" });
  return out;
}

/** Reporting seat: plain totals for the last 7 days. */
export function weeklyReport(journal: Journal, now: Date) {
  const week = journal.entries.filter((e) => COUNTS.has(e.status) && new Date(e.at).getTime() > now.getTime() - WEEK_MS);
  const sum = (side: Side) => round(week.filter((e) => e.side === side).reduce((a, e) => a + e.amount, 0));
  return { trades: week.length, bought: sum("buy"), sold: sum("sell") };
}

/** Synthetic journal for the website preview, tests and screenshots. Invented symbols and amounts. */
export const SYNTHETIC_JOURNAL: Journal = { entries: [
  { at: "2026-10-28T15:02:00.000Z", seat: "trade-desk", side: "buy", symbol: "DEMOA", asset_class: "equity", amount: 20, check: "passed", status: "filled", note: "Demo entry" },
  { at: "2026-10-27T19:40:00.000Z", seat: "trade-desk", side: "buy", symbol: "DEMOC", asset_class: "option", amount: 30, check: "blocked", status: "blocked", note: "Demo entry: options are not allowed" },
  { at: "2026-10-27T15:10:00.000Z", seat: "trade-desk", side: "buy", symbol: "DEMOB", asset_class: "etf", amount: 25, check: "passed", status: "filled", note: "Demo entry" },
] };

/** Synthetic accounts for the desk preview: an invented agent trading account and one view-only account. */
export const SYNTHETIC_DESK_SNAPSHOT: InvestmentSnapshot = { source: "synthetic", as_of: "2026-10-28T16:00:00.000Z", portfolios: [
  { label: "Demo agentic", kind: "individual", last4: "0000", agent_tradable: true, cash: 60, positions: [
    { symbol: "DEMOA", asset_class: "equity", market_value: 21 },
    { symbol: "DEMOB", asset_class: "etf", market_value: 26 },
  ] },
  { label: "Demo brokerage", kind: "individual", last4: "1111", agent_tradable: false, cash: 250, positions: [
    { symbol: "DEMOD", asset_class: "etf", market_value: 900 },
  ] },
] };
