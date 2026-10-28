import { describe, expect, it } from "vitest";
import { parseImport, type UsageRecord } from "./model";
import { toSyncRows } from "./sync";

describe("toSyncRows", () => {
  it("round-trips through the import parser the website uses, keeping cost kind and unknown costs", () => {
    const recs: UsageRecord[] = [
      { id: "a", at: "2026-10-28T01:02:03.000Z", provider: "anthropic", model: "m", agent: "Repo Intel", project: "o/r", requests: 2, input: 10, output: 5, cacheRead: 3, cacheWrite: 1, costUsd: 0.5, costKind: "estimated", source: "atlas" },
      { id: "b", at: "2026-10-28T02:00:00.000Z", provider: "anthropic", model: null, agent: "Repo Intel", project: null, requests: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: null, costKind: "estimated", source: "atlas" },
    ];
    const { records, skipped } = parseImport(JSON.stringify(toSyncRows(recs)), "sync");
    expect(skipped).toBe(0);
    expect(records.map(({ id: _id, source: _s, ...r }) => r)).toEqual(recs.map(({ id: _id, source: _s, ...r }) => r));
  });
});
