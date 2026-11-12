import { describe, expect, it } from "vitest";
import type { UsageRecord } from "../usage/model";
import { costPerModel, modelInventory } from "./lab";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const DAY = 86_400_000;
let n = 0;
const rec = (o: Partial<UsageRecord> & { daysAgo?: number }): UsageRecord => ({
  id: `r${n++}`, at: new Date(NOW - (o.daysAgo ?? 1) * DAY).toISOString(), provider: "anthropic", model: "claude-sonnet", agent: "A", project: null,
  requests: 1, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, costUsd: 0.01, costKind: "estimated", source: "atlas", ...o,
});

describe("model intelligence lab", () => {
  it("lists each model used in the last 30 days with its agents, most recent first", () => {
    const rs = [rec({ model: "claude-sonnet", agent: "B", daysAgo: 3 }), rec({ model: "claude-sonnet", agent: "A", daysAgo: 1 }), rec({ model: "gpt-5", provider: "openai", daysAgo: 2 }), rec({ model: "old", daysAgo: 40 })];
    const inv = modelInventory(rs, NOW);
    expect(inv.map((r) => r.model)).toEqual(["claude-sonnet", "gpt-5"]);
    expect(inv[0]).toMatchObject({ agents: ["A", "B"], requests: 2, tokens: 300, providers: ["anthropic"] });
  });

  it("ranks by known cost and gives a per-call cost only when every call is priced", () => {
    const rs = [
      rec({ model: "cheap", costUsd: 0.01 }), rec({ model: "cheap", costUsd: 0.03 }),
      rec({ model: "dear", costUsd: 2 }), rec({ model: "dear", costUsd: null }),
      rec({ model: "plan", costUsd: null, costKind: "plan" }),
    ];
    const c = costPerModel(rs, NOW);
    expect(c.map((r) => r.model)).toEqual(["dear", "cheap", "plan"]);
    expect(c[0]).toMatchObject({ costUsd: 2, unpriced: 1, perRequestUsd: null });
    expect(c[1].perRequestUsd).toBeCloseTo(0.02);
    expect(c[2]).toMatchObject({ costUsd: 0, plan: 1, perRequestUsd: null });
  });

  it("marks billed-only cost and groups calls with no model as unknown", () => {
    const c = costPerModel([rec({ model: null, costKind: "billed", costUsd: 1 })], NOW);
    expect(c[0]).toMatchObject({ model: "Unknown model", billedOnly: true });
    expect(modelInventory([], NOW)).toEqual([]);
  });
});
