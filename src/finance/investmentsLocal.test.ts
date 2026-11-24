import { describe, expect, it } from "vitest";
import { parseLocalJournal, parseLocalSnapshot, readLocalJournal, readLocalSnapshot } from "./investmentsLocal";

// Synthetic data only.
const NOW = new Date("2026-10-28T15:00:00Z");
const path = "/Users/demo/Library/Application Support/atlas/investments/snapshot.json";
const snapshot = { source: "robinhood", as_of: "2026-10-28T14:00:00Z", portfolios: [{ label: "Demo", kind: "roth_ira", last4: "0000", agent_tradable: false, cash: 1, positions: [] }] };

describe("parseLocalSnapshot", () => {
  it("is 'none' before the first sync", () => {
    expect(parseLocalSnapshot({ path, contents: null, modified_ms: null }, NOW)).toEqual({ kind: "none", path });
  });

  it("shows a snapshot only after it passes the allowlist", () => {
    const r = parseLocalSnapshot({ path, contents: JSON.stringify(snapshot), modified_ms: 1 }, NOW);
    expect(r.kind).toBe("ok");
    const leaked = parseLocalSnapshot({ path, contents: JSON.stringify({ ...snapshot, account_number: "12345678" }), modified_ms: 1 }, NOW);
    expect(leaked.kind).toBe("refused");
    expect(JSON.stringify(leaked)).not.toContain("12345678");
  });

  it("refuses text that isn't JSON", () => {
    expect(parseLocalSnapshot({ path, contents: "not json", modified_ms: 1 }, NOW)).toEqual({ kind: "refused", path, errors: ["snapshot: not valid JSON"] });
  });

  it("reads nothing on the website", async () => {
    expect(await readLocalSnapshot()).toEqual({ kind: "web" });
  });
});

describe("parseLocalJournal", () => {
  const entry = { at: "2026-10-28T14:00:00Z", seat: "trade-desk", side: "buy", symbol: "DEMOA", asset_class: "equity", amount: 10, check: "passed", status: "filled", note: "Demo" };
  it("is 'none' before the first trade, 'ok' after the allowlist, and refused otherwise", () => {
    expect(parseLocalJournal({ path, contents: null, modified_ms: null }, NOW)).toEqual({ kind: "none" });
    expect(parseLocalJournal({ path, contents: JSON.stringify({ entries: [entry] }), modified_ms: 1 }, NOW).kind).toBe("ok");
    expect(parseLocalJournal({ path, contents: "{", modified_ms: 1 }, NOW)).toEqual({ kind: "refused", errors: ["journal: not valid JSON"] });
    expect(parseLocalJournal({ path, contents: JSON.stringify({ entries: [{ ...entry, bank: "x" }] }), modified_ms: 1 }, NOW).kind).toBe("refused");
  });

  it("reads nothing on the website", async () => {
    expect(await readLocalJournal()).toEqual({ kind: "web" });
  });
});
