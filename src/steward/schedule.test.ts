import { describe, expect, it } from "vitest";
import type { StewardRun } from "./check";
import { changedChecks, due, localDay, validTime } from "./schedule";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const sample = (state: "clear" | "attention" | "unknown", detail = "detail", signature?: string): StewardRun => ({ id: "run", startedAt: "", finishedAt: "", status: "completed", requests: 1, checks: [{ id: "ci", label: "CI", state, detail, signature, url: "https://github.com" }] });
describe("daily Steward schedule", () => {
  it("runs only after the chosen local time, with at most one attempt per calendar day", () => {
    const s = { enabled: true, time: "09:00" };
    expect(due(s, at(28, 8, 59))).toBe(false);
    expect(due(s, at(28, 9))).toBe(true);
    expect(due({ ...s, lastAttemptDay: localDay(at(28, 9)) }, at(28, 23))).toBe(false);
    expect(due({ ...s, lastAttemptDay: "2026-10-28" }, at(29, 9))).toBe(true);
    expect(due({ ...s, enabled: false }, at(28, 10))).toBe(false);
  });
  it("rejects invalid times and handles midnight without a 24-hour elapsed-time assumption", () => {
    for (const time of ["24:00", "09:60", "9:00", "", null]) expect(validTime(time)).toBe(false);
    expect(due({ enabled: true, time: "00:00", lastAttemptDay: "2026-10-28" }, at(29, 0))).toBe(true);
  });
  it("keeps healthy baselines and unchanged observations quiet; flags coverage loss and recovery", () => {
    expect(changedChecks(undefined, sample("clear"))).toEqual([]);
    expect(changedChecks(undefined, sample("unknown"))).toEqual(["CI"]);
    expect(changedChecks(sample("unknown"), sample("unknown"))).toEqual([]);
    expect(changedChecks(sample("clear"), sample("unknown"))).toEqual(["CI"]);
    expect(changedChecks(sample("unknown"), sample("clear"))).toEqual(["CI"]);
    expect(changedChecks(sample("clear", "10 workflows"), sample("clear", "11 workflows"))).toEqual([]);
  });
  it("detects replaced alerts at the same count, without notifying for commit churn", () => {
    expect(changedChecks(sample("attention", "1 alert", "[1]"), sample("attention", "1 alert", "[2]"))).toEqual(["CI"]);
    const a = sample("clear"); a.checks[0].id = "commit";
    const b = sample("clear", "new commit"); b.checks[0].id = "commit";
    expect(changedChecks(a, b)).toEqual([]);
    expect(changedChecks(a, { ...b, status: "paused" })).toEqual([]);
  });
});
