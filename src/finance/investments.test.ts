import { describe, expect, it } from "vitest";
import { connectionState, dataQualityIssues, sanitizeSnapshot, summarizeChange, SYNTHETIC_SNAPSHOTS, type InvestmentSnapshot } from "./investments";

// Every figure and symbol here is synthetic.
const NOW = new Date("2026-10-28T15:00:00Z");
const good = { source: "synthetic", as_of: "2026-10-28T14:00:00Z", cash: 100, positions: [{ symbol: "DEMOA", asset_class: "equity", market_value: 50 }] };

describe("sanitizeSnapshot", () => {
  it("accepts the allowlisted shape and drops harmless extra keys", () => {
    const r = sanitizeSnapshot({ ...good, note: "x", positions: [{ ...good.positions[0], sector: "tech" }] }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot).toEqual({ source: "synthetic", as_of: "2026-10-28T14:00:00.000Z", cash: 100, positions: [{ symbol: "DEMOA", asset_class: "equity", market_value: 50 }] });
  });

  it("refuses account numbers, credentials and orders anywhere in the payload", () => {
    for (const extra of [{ account_number: "000" }, { token: "t" }, { meta: { routing: "1" } }, { orders: [] }]) {
      const r = sanitizeSnapshot({ ...good, ...extra }, NOW);
      expect(r.ok).toBe(false);
    }
    const nested = sanitizeSnapshot({ ...good, positions: [{ ...good.positions[0], acct_id: "9" }] }, NOW);
    expect(nested.ok).toBe(false);
  });

  it("never echoes values in its errors, so a rejected payload is safe to log", () => {
    const r = sanitizeSnapshot({ ...good, cash: "1234567.89", positions: [{ symbol: "secret-value", asset_class: "equity", market_value: 1 }], password: "hunter2" }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).not.toMatch(/1234567|secret-value|hunter2/);
  });

  it("rejects unknown sources, future dates, bad symbols and non-numbers", () => {
    expect(sanitizeSnapshot({ ...good, source: "robinhood" }, NOW).ok).toBe(false);
    expect(sanitizeSnapshot({ ...good, as_of: "2026-10-29T00:00:00Z" }, NOW).ok).toBe(false);
    expect(sanitizeSnapshot({ ...good, positions: [{ symbol: "demo a", asset_class: "equity", market_value: 1 }] }, NOW).ok).toBe(false);
    expect(sanitizeSnapshot({ ...good, cash: Number.NaN }, NOW).ok).toBe(false);
    expect(sanitizeSnapshot([], NOW).ok).toBe(false);
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
    const real = { ...SYNTHETIC_SNAPSHOTS[1], source: "brokerage" } as unknown as InvestmentSnapshot;
    expect(connectionState(real, NOW)).toBe("synced");
    expect(connectionState(real, new Date("2026-10-30T15:00:00Z"))).toBe("stale");
  });

  it("flags duplicate, negative and missing values without advice", () => {
    const s: InvestmentSnapshot = { source: "synthetic", as_of: NOW.toISOString(), cash: -1, positions: [
      { symbol: "DEMOA", asset_class: "equity", market_value: 1 }, { symbol: "DEMOA", asset_class: "equity", market_value: -2 }, { symbol: "DEMOB", asset_class: "etf", market_value: 0 },
    ] };
    expect(dataQualityIssues(s, NOW)).toEqual(["DEMOA appears more than once", "DEMOA has a negative value", "DEMOB has no value; its price may be missing", "Cash is negative"]);
  });

  it("describes changes in plain words and never recommends a trade", () => {
    const lines = summarizeChange(SYNTHETIC_SNAPSHOTS[0], SYNTHETIC_SNAPSHOTS[1]);
    expect(lines).toEqual([
      "Total $3,985 across 3 positions and $250 cash",
      "Total changed -$415 since the previous snapshot",
      "Cash changed -$150",
      "New in this snapshot: DEMOD",
      "No longer in this snapshot: DEMOC",
    ]);
    expect(lines.join(" ")).not.toMatch(/\b(buy|sell|hold|rebalance|should)\b/i);
  });
});
