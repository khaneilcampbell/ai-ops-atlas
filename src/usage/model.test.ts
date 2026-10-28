import { describe, expect, it } from "vitest";
import type { Run } from "../intel/types";
import { bucketEdges, groupRows, money, parseImport, recordsFromRuns, summarize, topAgents, type UsageRecord } from "./model";

const run = (over: Partial<Run>): Run => ({
  id: "r1",
  repo: "khaneilcampbell/ai-ops-atlas",
  trigger: "manual",
  depth: "standard",
  model: "claude-sonnet",
  force: false,
  status: "succeeded",
  queued_at: "2026-10-27T10:00:00Z",
  started_at: "2026-10-27T10:00:01Z",
  finished_at: null,
  duration_ms: null,
  error: null,
  attempts: 1,
  github_requests: 0,
  usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 50, cache_read_input_tokens: 300, served_by: null, fallback: false },
  estimate: null,
  cost_usd: 0.012,
  trace: [],
  ...over,
});

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: Math.random().toString(),
  at: "2026-10-27T12:00:00Z",
  provider: "anthropic",
  model: "m",
  agent: "A",
  project: null,
  requests: 1,
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: 1,
  costKind: "estimated",
  source: "import",
  ...over,
});

describe("recordsFromRuns", () => {
  it("keeps only runs that reached the provider, as estimated Anthropic usage", () => {
    const out = recordsFromRuns([run({}), run({ id: "r2", usage: null, cost_usd: null, status: "reused" })], "Repo Intel");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ provider: "anthropic", agent: "Repo Intel", project: "khaneilcampbell/ai-ops-atlas", input: 1000, cacheRead: 300, cacheWrite: 50, costUsd: 0.012, costKind: "estimated" });
  });
  it("prices nothing it wasn't told: a missing price stays unknown", () => {
    const [r] = recordsFromRuns([run({ cost_usd: null })], "X");
    expect(r.costUsd).toBeNull();
    const s = summarize([r], "month", new Date("2026-10-28T00:00:00Z"));
    expect(s.totals.unpriced).toBe(1);
    expect(s.totals.estimatedUsd).toBe(0);
  });
});

describe("parseImport", () => {
  it("accepts arrays and {records}, and treats cost as an estimate unless marked billed", () => {
    const a = parseImport(JSON.stringify([{ at: "2026-10-27", provider: "OpenAI", input_tokens: 5, cost_usd: 0.5 }]), "a.json");
    expect(a.records[0]).toMatchObject({ provider: "openai", costKind: "estimated", agent: "Unattributed" });
    const b = parseImport(JSON.stringify({ records: [{ at: "2026-10-27T00:00:00Z", provider: "anthropic", cost_usd: 2, cost_type: "billed" }] }), "b.json");
    expect(b.records[0].costKind).toBe("billed");
  });
  it("skips rows it can't validate instead of guessing", () => {
    const r = parseImport(JSON.stringify([{ provider: "openai" }, { at: "nope", provider: "x" }, { at: "2026-10-27", provider: "x", input_tokens: -1 }, { at: "2026-10-27", provider: "x" }]), "c.json");
    expect(r.records).toHaveLength(1);
    expect(r.skipped).toBe(3);
  });
  it("rejects files that aren't usage JSON", () => {
    expect(() => parseImport("not json", "d")).toThrow(/valid JSON/);
    expect(() => parseImport("{}", "d")).toThrow(/records/);
  });
});

describe("summarize", () => {
  const now = new Date(2026, 9, 28, 15, 30);
  it("uses 24 hourly buckets for a day and local calendar days otherwise", () => {
    expect(bucketEdges("day", now)).toHaveLength(25);
    expect(bucketEdges("week", now)).toHaveLength(8);
    expect(bucketEdges("month", now)).toHaveLength(31);
  });
  it("totals only the window and keeps billed and estimated apart", () => {
    const inside = new Date(2026, 9, 28, 9).toISOString();
    const old = new Date(2026, 8, 1).toISOString();
    const s = summarize([rec({ at: inside }), rec({ at: inside, costKind: "billed", costUsd: 3 }), rec({ at: old })], "week", now);
    expect(s.totals.records).toBe(2);
    expect(s.totals.estimatedUsd).toBe(1);
    expect(s.totals.billedUsd).toBe(3);
    const last = s.buckets[s.buckets.length - 1];
    expect(last.requests).toBe(2);
    expect(s.buckets.reduce((n, b) => n + b.requests, 0)).toBe(2);
  });
});

describe("grouping", () => {
  it("ranks the top agents by known cost and drops agents with none", () => {
    const rs = [rec({ agent: "A", costUsd: 1 }), rec({ agent: "B", costUsd: 5 }), rec({ agent: "A", costUsd: 2 }), rec({ agent: "C", costUsd: null })];
    expect(topAgents(rs).map((r) => r.key)).toEqual(["B", "A"]);
    expect(groupRows(rs, "agent").find((r) => r.key === "C")?.unpriced).toBe(1);
  });
  it("formats small amounts honestly", () => {
    expect(money(0)).toBe("$0.00");
    expect(money(0.004)).toBe("<$0.01");
    expect(money(12.5)).toBe("$12.50");
  });
});
