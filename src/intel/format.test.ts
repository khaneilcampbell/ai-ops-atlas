import { describe, expect, it } from "vitest";
import { duration, lastRuns, rollup, runTone, scheduleLabel, usd } from "./format";
import type { Run } from "./types";

function run(p: Partial<Run>): Run {
  return {
    id: "run_1",
    repo: "o/a",
    trigger: "manual",
    depth: "standard",
    model: "claude-sonnet-5-5",
    force: false,
    status: "succeeded",
    queued_at: "2026-10-27T00:00:00Z",
    started_at: "2026-10-27T00:00:00Z",
    finished_at: null,
    duration_ms: null,
    error: null,
    attempts: 1,
    github_requests: 12,
    usage: null,
    estimate: null,
    cost_usd: null,
    trace: [],
    ...p,
  };
}

describe("cost rollup", () => {
  it("sums estimated cost per repository and for this month", () => {
    const runs = [
      run({ id: "1", repo: "o/a", cost_usd: 0.02, usage: { input_tokens: 3000, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, served_by: null, fallback: false } }),
      run({ id: "2", repo: "o/b", cost_usd: 0.05 }),
      run({ id: "3", repo: "o/a", cost_usd: 0.01, started_at: "2026-09-12T00:00:00Z" }),
      run({ id: "4", repo: "o/a", status: "reused", attempts: 0 }),
    ];
    const r = rollup(runs, new Date("2026-10-28T00:00:00Z"));
    expect(r.total).toBeCloseTo(0.08);
    expect(r.month).toBeCloseTo(0.07);
    expect(r.runsWithCost).toBe(3);
    expect(r.inputTokens).toBe(3000);
    expect(r.byRepo[0]).toMatchObject({ repo: "o/b", cost: 0.05 });
    expect(r.byRepo.find((x) => x.repo === "o/a")).toMatchObject({ runs: 3, calls: 2 });
  });

  it("is empty with no runs rather than inventing numbers", () => {
    const r = rollup([]);
    expect(r.total).toBe(0);
    expect(r.byRepo).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats money for small amounts", () => {
    expect(usd(0.0042)).toBe("$0.0042");
    expect(usd(0.104)).toBe("$0.104");
    expect(usd(5)).toBe("$5.00");
    expect(usd(null)).toBe("–");
  });

  it("formats durations", () => {
    expect(duration(850)).toBe("850 ms");
    expect(duration(12_400)).toBe("12.4 s");
    expect(duration(75_000)).toBe("1 min 15 s");
  });

  it("never shows a failure with a success tone", () => {
    for (const s of ["failed", "interrupted", "blocked"] as const) expect(runTone(s)).toBe("attention");
  });

  it("finds the last success and failure", () => {
    const runs = [run({ id: "3", status: "failed" }), run({ id: "2", status: "reused" }), run({ id: "1", status: "succeeded" })];
    const l = lastRuns(runs);
    expect(l.latest?.id).toBe("3");
    expect(l.lastSuccess?.id).toBe("1");
    expect(l.lastFailure?.id).toBe("3");
  });
});

describe("scheduleLabel", () => {
  it("names the days in order with the time", () => {
    expect(scheduleLabel({ enabled: true, days: [4, 0, 2], at: "08:00", consent_at: null })).toBe("Mon, Wed and Fri at 08:00");
    expect(scheduleLabel({ enabled: true, days: [6], at: "21:30", consent_at: null })).toBe("Sun at 21:30");
    expect(scheduleLabel({ enabled: false, days: [], at: "08:00", consent_at: null })).toBe("No days chosen");
  });
});
