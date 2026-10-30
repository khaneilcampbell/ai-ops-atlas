import { describe, expect, it } from "vitest";
import { describeCron, fireTimes, minIntervalMinutes, nextRun, parseCron } from "./cron";

const at = (iso: string) => Date.parse(iso);

describe("parseCron", () => {
  it("accepts the numeric forms GitHub runs", () => {
    for (const s of ["23 */4 * * *", "41 13 * * 1,4", "*/15 * * * *", "0 12 * * 1", "0 9-17/2 * * 1-5", "0 0 1 * *", "5 4 * * 7"]) expect(() => parseCron(s)).not.toThrow();
  });

  it("refuses anything else with a plain reason", () => {
    expect(() => parseCron("")).toThrow(/five parts/);
    expect(() => parseCron("* * * *")).toThrow(/five parts/);
    expect(() => parseCron("* * * * * *")).toThrow(/five parts/);
    expect(() => parseCron("@hourly")).toThrow(/five parts/);
    expect(() => parseCron("0 0 * JAN *")).toThrow(/month/);
    expect(() => parseCron("0 0 * * MON")).toThrow(/day of week/);
    expect(() => parseCron("60 * * * *")).toThrow(/minute must be between 0 and 59/);
    expect(() => parseCron("0 24 * * *")).toThrow(/hour/);
    expect(() => parseCron("0 0 0 * *")).toThrow(/day of month/);
    expect(() => parseCron("*/0 * * * *")).toThrow(/step/);
    expect(() => parseCron("5-1 * * * *")).toThrow(/between/);
    expect(() => parseCron("0 0 * * 1;rm")).toThrow();
    expect(() => parseCron("0 0 * * 1\n- cron: x")).toThrow();
    expect(() => parseCron(`${"1,".repeat(40)}1 * * * *`)).toThrow(/too long/);
  });

  it("treats day 7 as Sunday", () => {
    expect([...parseCron("0 0 * * 7").dow]).toEqual([0]);
  });
});

describe("timing", () => {
  it("finds the next run", () => {
    expect(new Date(nextRun(parseCron("23 */4 * * *"), at("2026-10-30T10:00:00Z"))!).toISOString()).toBe("2026-10-30T12:23:00.000Z");
    // Friday -> next Monday.
    expect(new Date(nextRun(parseCron("41 13 * * 1,4"), at("2026-10-30T14:00:00Z"))!).toISOString()).toBe("2026-11-02T13:41:00.000Z");
  });

  it("measures the shortest gap, across day and week boundaries", () => {
    expect(minIntervalMinutes(parseCron("23 */4 * * *"))).toBe(240);
    expect(minIntervalMinutes(parseCron("*/15 * * * *"))).toBe(15);
    expect(minIntervalMinutes(parseCron("41 13 * * 1,4"))).toBe(3 * 1440);
    expect(minIntervalMinutes(parseCron("0 23,1 * * *"))).toBe(120);
    expect(minIntervalMinutes(parseCron("0,59 * * * *"))).toBe(1);
    expect(minIntervalMinutes(parseCron("0 0 31 2 *"))).toBeNull();
  });

  it("fires on either day field when both are set, like cron", () => {
    const times = fireTimes(parseCron("0 0 1 * 1"), at("2026-11-01T00:00:00Z"), at("2026-11-10T00:00:00Z"));
    expect(times.map((t) => new Date(t).toISOString().slice(0, 10))).toEqual(["2026-11-01", "2026-11-02", "2026-11-09"]);
  });
});

describe("describeCron", () => {
  it("says common schedules in words", () => {
    expect(describeCron("23 */4 * * *")).toBe("Every 4 hours at :23 UTC");
    expect(describeCron("41 13 * * 1,4")).toBe("Mon and Thu at 13:41 UTC");
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeCron("0 12 * * 1")).toBe("Mon at 12:00 UTC");
    expect(describeCron("30 8 * * 1-5")).toBe("Weekdays at 08:30 UTC");
    expect(describeCron("5 * * * *")).toBe("Every hour at :05 UTC");
    expect(describeCron("0 6 * * *")).toBe("Daily at 06:00 UTC");
    expect(describeCron("0 0 1 * *")).toBe("Cron 0 0 1 * * (UTC)");
    expect(describeCron("nonsense")).toMatch(/not understood/);
  });
});
