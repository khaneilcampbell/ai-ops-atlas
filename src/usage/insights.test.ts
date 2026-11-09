import { describe, expect, it } from "vitest";
import { cacheHitRate, findings, isFrontier, rankWorkflows, RULES } from "./insights";
import type { UsageRecord } from "./model";

let n = 0;
const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: `r${n++}`,
  at: "2026-11-08T12:00:00Z",
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  agent: "A",
  project: null,
  requests: 1,
  input: 1000,
  output: 500,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: 0.01,
  costKind: "estimated",
  source: "agent",
  ...over,
});

describe("rankWorkflows", () => {
  it("ranks by cost, then tokens, and computes shares and per-call averages", () => {
    const rows = rankWorkflows([
      rec({ agent: "Cheap", costUsd: 0.1 }),
      rec({ agent: "Big", costUsd: 0.6, requests: 2, input: 4000, output: 1000, cacheRead: 4000 }),
      rec({ agent: "Big", costUsd: 0.3 }),
      rec({ agent: "Unpriced", costUsd: null, input: 90_000 }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["Big", "Cheap", "Unpriced"]);
    const big = rows[0];
    expect(big.costUsd).toBeCloseTo(0.9);
    expect(big.costShare).toBeCloseTo(0.9);
    expect(big.requests).toBe(3);
    expect(big.inputPerRequest).toBeCloseTo((4000 + 4000 + 1000) / 3);
    expect(big.cacheHitRate).toBeCloseTo(4000 / 9000);
    expect(rows[2].costPerRequest).toBeNull();
    expect(rows[2].tokenShare).toBeGreaterThan(0.5);
  });

  it("lists each workflow's models, most expensive first", () => {
    const [row] = rankWorkflows([rec({ model: "claude-haiku-5-5", costUsd: 0.01 }), rec({ model: "claude-opus-5-5", costUsd: 0.5 })]);
    expect(row.models.map((m) => m.model)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
  });

  it("is empty with no records", () => {
    expect(rankWorkflows([])).toEqual([]);
  });
});

describe("cacheHitRate", () => {
  it("is cache reads over all prompt tokens, or null when nothing was sent", () => {
    expect(cacheHitRate({ input: 100, cacheRead: 300, cacheWrite: 100 })).toBeCloseTo(0.6);
    expect(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});

describe("isFrontier", () => {
  it("knows the expensive tiers", () => {
    expect(isFrontier("claude-opus-5-5")).toBe(true);
    expect(isFrontier("claude-fable-5-1")).toBe(true);
    expect(isFrontier("gpt-5")).toBe(true);
    expect(isFrontier("gpt-5-mini")).toBe(false);
    expect(isFrontier("claude-haiku-5-5")).toBe(false);
    expect(isFrontier("claude-sonnet-5-5")).toBe(false);
  });
});

describe("findings", () => {
  it("suggests a smaller model when a frontier model writes short answers", () => {
    const f = findings(rankWorkflows([rec({ agent: "Merge Flow", model: "claude-opus-5-5", output: 400 })]));
    expect(f.map((x) => x.id)).toContain("tier:Merge Flow");
  });

  it("leaves a frontier model alone when it writes long output, like code", () => {
    const f = findings(rankWorkflows([rec({ agent: "Coder", model: "claude-opus-5-5", output: RULES.smallOutputTokens + 1 })]));
    expect(f.some((x) => x.id.startsWith("tier:"))).toBe(false);
  });

  it("flags large repeated prompts that aren't cached, and not ones that are", () => {
    const big = { input: 8000, requests: 1 };
    const uncached = findings(rankWorkflows([rec({ agent: "Scout", ...big }), rec({ agent: "Scout", ...big }), rec({ agent: "Scout", ...big })]));
    expect(uncached.map((x) => x.id)).toContain("cache:Scout");
    const cached = findings(rankWorkflows([rec({ agent: "Scout", requests: 3, input: 3000, cacheRead: 21_000 })]));
    expect(cached.some((x) => x.id.startsWith("cache:"))).toBe(false);
  });

  it("does not flag caching on too few calls", () => {
    const f = findings(rankWorkflows([rec({ agent: "Once", input: 50_000 })]));
    expect(f.some((x) => x.id.startsWith("cache:"))).toBe(false);
  });

  it("calls out one workflow dominating spend, as high impact, first", () => {
    const f = findings(rankWorkflows([rec({ agent: "Heavy", costUsd: 0.8 }), rec({ agent: "Light", costUsd: 0.2 })]));
    expect(f[0]).toMatchObject({ id: "concentration:Heavy", impact: "high" });
  });

  it("asks for prices when a workflow's cost is unknown", () => {
    const f = findings(rankWorkflows([rec({ agent: "Imported", costUsd: null })]));
    expect(f).toEqual([expect.objectContaining({ id: "price:Imported", impact: "low" })]);
  });

  it("finds nothing to change in small, cheap, well-tiered usage", () => {
    expect(findings(rankWorkflows([rec({ agent: "Fine", model: "claude-haiku-5-5" })]))).toEqual([]);
  });
});

describe("agentRecords", () => {
  it("re-validates the site's rows and marks them as agent-reported", async () => {
    const { agentRecords } = await import("./agents");
    const recs = agentRecords({ configured: true, records: [{ at: "2026-11-09T06:00:00Z", provider: "anthropic", agent: "GitHub Merge Flow", input_tokens: 10 }, { provider: "x" }] });
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ source: "agent", agent: "GitHub Merge Flow", input: 10 });
  });
});

describe("ChatGPT Codex rows", () => {
  it("count tokens on a subscription plan without a cost or a missing-price finding", async () => {
    const { localRecords } = await import("./local");
    const recs = localRecords([
      { at: "2026-11-09T09:38:18Z", provider: "openai", model: "gpt-6.1-sol", agent: "Codex (ChatGPT)", project: "AI Ops Atlas", requests: 40, input_tokens: 9000, output_tokens: 1200, cache_read_tokens: 300_000, cost_usd: 5, cost_type: "plan" },
    ], "codex");
    expect(recs[0]).toMatchObject({ source: "local", costKind: "plan", costUsd: null, cacheRead: 300_000 });
    const rows = rankWorkflows(recs);
    expect(rows[0]).toMatchObject({ key: "Codex (ChatGPT)", plan: 1, unpriced: 0, costPerRequest: null });
    expect(rows[0].cacheHitRate).toBeCloseTo(300_000 / 309_000);
    expect(findings(rows).some((f) => f.id.startsWith("price:"))).toBe(false);
  });
});
