import { describe, expect, it } from "vitest";
import { agentAccount, checkTrade, deskAlerts, sanitizeJournal, SYNTHETIC_DESK_SNAPSHOT, SYNTHETIC_JOURNAL, TEAM, tradedThisWeek, TRADING_LIMITS, weeklyReport, type Journal } from "./tradingDesk";

const now = new Date("2026-10-29T12:00:00.000Z");
const entry = (over: Record<string, unknown> = {}) => ({ at: "2026-10-28T15:00:00.000Z", seat: "trade-desk", side: "buy", symbol: "DEMOA", asset_class: "equity", amount: 20, check: "passed", status: "filled", note: "Demo", ...over });
const journal = (...entries: Record<string, unknown>[]) => { const r = sanitizeJournal({ entries }, now); if (!r.ok) throw new Error(r.errors.join("; ")); return r.journal; };
const agentic = agentAccount(SYNTHETIC_DESK_SNAPSHOT)!;

describe("trading limits", () => {
  it("are Khaneil's $80 a week, stocks and ETFs only", () => {
    expect(TRADING_LIMITS).toEqual({ weekly_max: 80, allowed: ["equity", "etf"] });
  });

  it("only the Trade Desk seat can trade", () => {
    expect(TEAM.filter((s) => s.can_trade).map((s) => s.id)).toEqual(["trade-desk"]);
    expect(TEAM).toHaveLength(6);
  });
});

describe("sanitizeJournal", () => {
  it("accepts the documented shape and sorts newest first", () => {
    const r = sanitizeJournal({ entries: [entry({ at: "2026-10-27T10:00:00.000Z" }), entry()] }, now);
    expect(r.ok && r.journal.entries.map((e) => e.at)).toEqual(["2026-10-28T15:00:00.000Z", "2026-10-27T10:00:00.000Z"]);
  });

  it("refuses account, credential and money movement fields anywhere, naming fields not values", () => {
    const r = sanitizeJournal({ entries: [entry({ account_number: "123456789" })], token: "x" }, now);
    expect(r).toEqual({ ok: false, errors: ["refused: fields not allowed in Atlas (account_number, token)"] });
  });

  it("refuses long digit runs in notes, sent blocked orders and orders from other seats", () => {
    const r = sanitizeJournal({ entries: [entry({ note: "acct 12345678" }), entry({ check: "blocked", status: "filled" }), entry({ seat: "market-research" })] }, now);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual([
      "entries[0].note: up to 140 characters, no long numbers",
      "entries[1].status: a blocked check can't be sent",
      "entries[2].seat: only the Trade Desk sends orders",
    ]);
  });

  it("drops unknown harmless keys and refuses future times", () => {
    const ok = sanitizeJournal({ entries: [entry({ extra: 1 })] }, now);
    expect(ok.ok && Object.keys(ok.journal.entries[0])).not.toContain("extra");
    expect(sanitizeJournal({ entries: [entry({ at: "2026-11-30T00:00:00.000Z" })] }, now).ok).toBe(false);
  });

  it("accepts the synthetic journal", () => {
    expect(sanitizeJournal(SYNTHETIC_JOURNAL, now).ok).toBe(true);
  });
});

describe("checkTrade (Risk & Limits)", () => {
  it("counts only sent orders from the last 7 days toward the weekly limit", () => {
    const j = journal(entry({ amount: 30 }), entry({ amount: 10, status: "submitted", side: "sell" }), entry({ amount: 50, check: "blocked", status: "blocked" }), entry({ amount: 40, status: "rejected" }), entry({ amount: 70, at: "2026-10-20T00:00:00.000Z" }));
    expect(tradedThisWeek(j, now)).toBe(40);
  });

  it("passes a trade that fits and says what is left", () => {
    expect(checkTrade({ side: "buy", symbol: "DEMOA", asset_class: "equity", amount: 25 }, journal(entry({ amount: 30 })), agentic, now)).toEqual({ ok: true, left_after: 25 });
  });

  it("blocks over the weekly limit, disallowed classes and non-agent accounts", () => {
    const view = SYNTHETIC_DESK_SNAPSHOT.portfolios[1];
    const r = checkTrade({ side: "buy", symbol: "DEMOC", asset_class: "option", amount: 60 }, journal(entry({ amount: 30 })), view, now);
    expect(!r.ok && r.reasons).toEqual([
      "Agents may trade only in the Agentic account",
      "Only equity and etf are allowed",
      "Over the weekly limit: $50 of $80 left this week",
    ]);
    expect(checkTrade({ side: "buy", symbol: "DEMOA", asset_class: "equity", amount: 5 }, { entries: [] }, null, now).ok).toBe(false);
  });

  it("blocks buys above the cash and sells above what is held", () => {
    const empty: Journal = { entries: [] };
    expect(checkTrade({ side: "buy", symbol: "DEMOA", asset_class: "equity", amount: 70 }, empty, agentic, now)).toEqual({ ok: false, reasons: ["More than the account's cash"] });
    expect(checkTrade({ side: "sell", symbol: "DEMOA", asset_class: "equity", amount: 30 }, empty, agentic, now)).toEqual({ ok: false, reasons: ["More than the DEMOA held in the account"] });
  });
});

describe("desk alerts and weekly report", () => {
  it("flags a missing snapshot, the limit and rejected orders, and stays quiet otherwise", () => {
    const j = journal(entry({ amount: 80 }), entry({ status: "rejected" }));
    expect(deskAlerts(null, false, j, now)).toEqual([
      { level: "warn", text: "No account snapshot yet" },
      { level: "bad", text: "Weekly limit reached: $80 of $80" },
      { level: "quiet", text: "No blocked orders this week" },
      { level: "bad", text: "1 order rejected by Robinhood this week" },
    ]);
    expect(deskAlerts(SYNTHETIC_DESK_SNAPSHOT, false, { entries: [] }, now).map((a) => a.level)).toEqual(["quiet", "quiet"]);
  });

  it("totals the week's sent orders", () => {
    expect(weeklyReport(journal(entry({ amount: 20 }), entry({ side: "sell", amount: 5 }), entry({ status: "blocked", check: "blocked" })), now)).toEqual({ trades: 2, bought: 20, sold: 5 });
  });
});
