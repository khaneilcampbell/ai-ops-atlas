import { describe, expect, it } from "vitest";
import { connectionState, dataQualityIssues, portfolioName, sanitizeSnapshot, summarizeChange, SYNTHETIC_SNAPSHOTS, type InvestmentSnapshot } from "./investments";

// Every label, figure and symbol here is synthetic.
const NOW = new Date("2026-10-28T15:00:00Z");
const pf = { label: "Demo", kind: "individual", last4: "0000", agent_tradable: false, cash: 100, positions: [{ symbol: "DEMOA", asset_class: "equity", market_value: 50 }] };
const good = { source: "robinhood", as_of: "2026-10-28T14:00:00Z", portfolios: [pf] };
const withPf = (extra: Record<string, unknown>) => ({ ...good, portfolios: [{ ...pf, ...extra }] });

describe("sanitizeSnapshot", () => {
  it("accepts the allowlisted shape and drops harmless extra keys", () => {
    const r = sanitizeSnapshot({ ...good, note: "x", portfolios: [{ ...pf, color: "blue", positions: [{ ...pf.positions[0], sector: "tech" }] }] }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot).toEqual({ source: "robinhood", as_of: "2026-10-28T14:00:00.000Z", portfolios: [pf] });
  });

  it("refuses account numbers, credentials and orders anywhere in the payload", () => {
    for (const extra of [{ account_number: "000" }, { token: "t" }, { meta: { routing: "1" } }, { orders: [] }]) {
      expect(sanitizeSnapshot({ ...good, ...extra }, NOW).ok).toBe(false);
    }
    expect(sanitizeSnapshot(withPf({ rhs_account_number: "1" }), NOW).ok).toBe(false);
    expect(sanitizeSnapshot(withPf({ positions: [{ ...pf.positions[0], acct_id: "9" }] }), NOW).ok).toBe(false);
  });

  it("keeps only the last four characters of an account number", () => {
    for (const last4 of ["12345678", "123", "12-4", 1234]) expect(sanitizeSnapshot(withPf({ last4 }), NOW).ok).toBe(false);
    expect(sanitizeSnapshot(withPf({ last4: "5UU8" }), NOW).ok).toBe(true);
  });

  it("never echoes values in its errors, so a rejected payload is safe to log", () => {
    const r = sanitizeSnapshot({ ...withPf({ cash: "1234567.89", last4: "98765432", positions: [{ symbol: "secret-value", asset_class: "equity", market_value: 1 }] }), password: "hunter2" }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).not.toMatch(/1234567|98765432|secret-value|hunter2/);
    const r2 = sanitizeSnapshot(withPf({ cash: "1234567.89", last4: "98765432" }), NOW);
    if (!r2.ok) expect(r2.errors.join(" ")).not.toMatch(/1234567|98765432/);
  });

  it("rejects unknown sources, future dates, bad symbols, labels and non-numbers", () => {
    expect(sanitizeSnapshot({ ...good, source: "other" }, NOW).ok).toBe(false);
    expect(sanitizeSnapshot({ ...good, as_of: "2026-10-29T00:00:00Z" }, NOW).ok).toBe(false);
    expect(sanitizeSnapshot(withPf({ positions: [{ symbol: "demo a", asset_class: "equity", market_value: 1 }] }), NOW).ok).toBe(false);
    expect(sanitizeSnapshot(withPf({ cash: Number.NaN }), NOW).ok).toBe(false);
    expect(sanitizeSnapshot(withPf({ label: "<script>" }), NOW).ok).toBe(false);
    expect(sanitizeSnapshot(withPf({ kind: "checking" }), NOW).ok).toBe(false);
    expect(sanitizeSnapshot(withPf({ agent_tradable: "yes" }), NOW).ok).toBe(false);
    expect(sanitizeSnapshot({ ...good, portfolios: "x" }, NOW).ok).toBe(false);
    expect(sanitizeSnapshot([], NOW).ok).toBe(false);
  });

  it("allows at most one account an agent can trade in", () => {
    const two = { ...good, portfolios: [{ ...pf, agent_tradable: true }, { ...pf, last4: "1111", agent_tradable: true }] };
    expect(sanitizeSnapshot(two, NOW).ok).toBe(false);
    expect(sanitizeSnapshot({ ...two, portfolios: [two.portfolios[0], { ...two.portfolios[1], agent_tradable: false }] }, NOW).ok).toBe(true);
  });

  it("accepts the synthetic preview snapshots", () => {
    for (const s of SYNTHETIC_SNAPSHOTS) expect(sanitizeSnapshot(s, NOW).ok).toBe(true);
  });
});

describe("connection, quality and summary", () => {
  it("never shows synthetic data as a connection", () => {
    expect(connectionState(null, NOW)).toBe("not-connected");
    expect(connectionState(SYNTHETIC_SNAPSHOTS[1], NOW)).toBe("not-connected");
  });

  it("marks a real snapshot stale after a day", () => {
    const real: InvestmentSnapshot = { ...SYNTHETIC_SNAPSHOTS[1], source: "robinhood" };
    expect(connectionState(real, NOW)).toBe("synced");
    expect(connectionState(real, new Date("2026-10-30T15:00:00Z"))).toBe("stale");
  });

  it("names an account by label and last four only", () => {
    expect(portfolioName(SYNTHETIC_SNAPSHOTS[0].portfolios[0])).toBe("Demo brokerage ••0000");
  });

  it("flags duplicate, negative and missing values without advice", () => {
    const s: InvestmentSnapshot = { source: "synthetic", as_of: NOW.toISOString(), portfolios: [{ label: "Demo", kind: "individual", last4: "0000", agent_tradable: false, cash: -1, positions: [
      { symbol: "DEMOA", asset_class: "equity", market_value: 1 }, { symbol: "DEMOA", asset_class: "equity", market_value: -2 }, { symbol: "DEMOB", asset_class: "etf", market_value: 0 },
    ] }] };
    expect(dataQualityIssues(s, NOW)).toEqual(["DEMOA appears more than once", "DEMOA has a negative value", "DEMOB has no value; its price may be missing", "Cash is negative"]);
    const two: InvestmentSnapshot = { ...s, portfolios: [s.portfolios[0], { ...s.portfolios[0], label: "Other", last4: "1111", cash: 0, positions: [] }] };
    expect(dataQualityIssues(two, NOW)[0]).toBe("DEMOA appears more than once in Demo ••0000");
  });

  it("describes changes in plain words and never recommends a trade", () => {
    const lines = summarizeChange(SYNTHETIC_SNAPSHOTS[0], SYNTHETIC_SNAPSHOTS[1]);
    expect(lines).toEqual([
      "Total $3,985 across 1 account, 3 positions and $250 cash",
      "Total changed -$415 since the previous snapshot",
      "Cash changed -$150",
      "New in this snapshot: DEMOD",
      "No longer in this snapshot: DEMOC",
    ]);
    expect(lines.join(" ")).not.toMatch(/\b(buy|sell|hold|rebalance|should)\b/i);
  });
});
