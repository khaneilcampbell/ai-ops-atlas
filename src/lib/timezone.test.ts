import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny localStorage so the store's load/save run as they do in the app.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const tz = await import("./timezone");

describe("time zone setting", () => {
  beforeEach(() => tz.setTimeZone(tz.DEFAULT_TIME_ZONE));

  it("defaults to New York (Eastern Time)", () => {
    expect(tz.DEFAULT_TIME_ZONE).toBe("America/New_York");
    expect(tz.getTimeZone()).toBe("America/New_York");
  });

  it("saves a valid zone and ignores an unknown one", () => {
    tz.setTimeZone("Europe/London");
    expect(tz.getTimeZone()).toBe("Europe/London");
    expect(JSON.parse(mem.get("atlas:timeZone")!)).toBe("Europe/London");
    tz.setTimeZone("Mars/Olympus_Mons");
    expect(tz.getTimeZone()).toBe("Europe/London");
  });

  it("validates IANA names", () => {
    expect(tz.isValidTimeZone("America/Chicago")).toBe(true);
    expect(tz.isValidTimeZone("UTC")).toBe(true);
    expect(tz.isValidTimeZone("Not/AZone")).toBe(false);
    expect(tz.isValidTimeZone(42)).toBe(false);
  });
});

describe("formatting in the chosen zone", () => {
  const winter = "2026-01-15T17:30:00Z";
  const summer = "2026-07-15T17:30:00Z";
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZoneName: "short" };

  it("follows daylight saving for Eastern Time", () => {
    expect(tz.formatTime(winter, opts, "America/New_York")).toMatch(/12:30\sPM EST/);
    expect(tz.formatTime(summer, opts, "America/New_York")).toMatch(/1:30\sPM EDT/);
    expect(tz.zoneAbbreviation(winter, "America/New_York")).toBe("EST");
    expect(tz.zoneAbbreviation(summer, "America/New_York")).toBe("EDT");
  });

  it("uses the stored zone by default", () => {
    tz.setTimeZone("Asia/Tokyo");
    expect(tz.formatTime(winter, { hour: "numeric", minute: "2-digit", hourCycle: "h23" })).toBe("02:30");
    tz.setTimeZone("America/New_York");
    expect(tz.formatTime(winter, { hour: "numeric", minute: "2-digit", hourCycle: "h23" })).toBe("12:30");
  });

  it("puts an instant on the right calendar day for the zone", () => {
    const lateNight = "2026-11-11T03:00:00Z"; // 10 PM on Nov 10 in New York
    expect(tz.dayKey(lateNight, "America/New_York")).toBe("2026-11-10");
    expect(tz.dayKey(lateNight, "UTC")).toBe("2026-11-11");
  });

  it("says Unknown for a bad date instead of throwing", () => {
    expect(tz.formatDateTime("not a date")).toBe("Unknown");
  });
});

describe("zone picker data", () => {
  const groups = tz.zoneGroups(new Date("2026-01-15T12:00:00Z"));

  it("groups zones by region with the Americas first", () => {
    expect(groups[0].region).toBe("Americas");
    expect(groups.map((g) => g.region)).toEqual(expect.arrayContaining(["Europe", "Asia", "Africa"]));
  });

  it("describes New York as Eastern Time with its offset", () => {
    const ny = groups.flatMap((g) => g.zones).find((z) => z.zone === "America/New_York")!;
    expect(ny.city).toBe("New York");
    expect(ny.name).toBe("Eastern Time");
    expect(ny.offset).toBe("GMT-5");
    expect(tz.zoneLabel(ny)).toBe("New York · Eastern Time (GMT-5)");
  });

  it("searches by city, zone name or id", () => {
    const zonesFor = (q: string) => tz.filterZoneGroups(groups, q).flatMap((g) => g.zones.map((z) => z.zone));
    expect(zonesFor("new york")).toContain("America/New_York");
    expect(zonesFor("eastern")).toContain("America/New_York");
    expect(zonesFor("london")).toEqual(["Europe/London"]);
    expect(zonesFor("zzzz")).toEqual([]);
    expect(tz.filterZoneGroups(groups, "  ")).toBe(groups);
  });
});
