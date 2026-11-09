import { describe, expect, it } from "vitest";
import { sessionFindings, sessionHealth, SESSION_RULES } from "./sessions";
import type { UsageRecord } from "./model";

let n = 0;
const session = (requests: number, avgContext: number, over: Partial<UsageRecord> = {}): UsageRecord => ({
  id: `s${n++}`,
  at: "2026-11-08T12:00:00Z",
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  agent: "Claude Code",
  project: "ai-ops-atlas",
  requests,
  input: requests * 1000,
  output: requests * 500,
  cacheRead: requests * (avgContext - 1000),
  cacheWrite: 0,
  costUsd: null,
  costKind: "plan",
  source: "local",
  ...over,
});

describe("sessionHealth", () => {
  it("grades sessions by average context per reply and ignores API agents", () => {
    const rows = sessionHealth([
      session(50, 120_000),
      session(30, 50_000),
      session(250, 20_000),
      session(20, 10_000),
      session(90, 150_000, { agent: "Merge Flow" }),
    ]);
    expect(rows.map((r) => r.level)).toEqual(["fresh", "compact", "compact", "ok"]);
    expect(rows[0].avgContext).toBeCloseTo(120_000);
  });
});

describe("sessionFindings", () => {
  it("says nothing when sessions stay light", () => {
    expect(sessionFindings([session(20, 10_000)])).toEqual([]);
  });

  it("names the heaviest sessions with what to do, and caps the list", () => {
    const f = sessionFindings([session(50, 120_000), session(40, 90_000, { agent: "Codex (ChatGPT)", project: "benjaire.com" }), session(30, 50_000), session(30, 45_000), session(5, 10_000)]);
    expect(f).toHaveLength(SESSION_RULES.maxShown + 1);
    expect(f[0]).toMatchObject({ impact: "high", workflow: "Claude Code" });
    expect(f[0].title).toMatch(/^Start fresh sooner: Claude Code in ai-ops-atlas/);
    expect(f[0].detail).toMatch(/npm run handoff/);
    expect(f[1].title).toMatch(/Codex \(ChatGPT\) in benjaire\.com/);
    expect(f[2]).toMatchObject({ impact: "medium" });
    expect(f[2].detail).toMatch(/\/compact/);
    expect(f[3]).toMatchObject({ id: "session:summary", title: "4 of 5 coding sessions carried a heavy context" });
  });
});
