import { beforeEach, describe, expect, it, vi } from "vitest";

const data = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => void data.set(key, value),
  removeItem: (key: string) => void data.delete(key),
  clear: () => data.clear(),
});

const { insideLimits, loadInside, officeScale, pickInside, saveInside, sameTiers, stepCut } = await import("./inside");
const { CUT_MAX } = await import("./materials");

describe("Inside toggle state", () => {
  beforeEach(() => data.clear());
  it("is off until turned on", () => {
    expect(loadInside()).toBe(false);
  });
  it("remembers the choice across reloads, under its own setting", () => {
    saveInside(true);
    expect(data.get("atlas:mapInside")).toBe("true");
    expect(loadInside()).toBe(true);
    saveInside(false);
    expect(loadInside()).toBe(false);
  });
  it("treats a damaged or foreign value as off", () => {
    data.set("atlas:mapInside", "\"yes\"");
    expect(loadInside()).toBe(false);
    data.set("atlas:mapInside", "{");
    expect(loadInside()).toBe(false);
  });
});

const city = Array.from({ length: 11 }, (_, i) => ({ key: `project:p${i}`, x: i * 10, y: 0.75, z: 0 }));
const all = () => true;

describe("pickInside", () => {
  const limits = { near: 3, mid: 13, nearDist: 60, midDist: Infinity };
  it("opens the nearest buildings fully and the rest as floor plans", () => {
    const t = pickInside(city, { x: -5, y: 30, z: 0 }, all, limits);
    expect(t.near).toEqual(["project:p0", "project:p1", "project:p2"]);
    expect(t.mid).toHaveLength(8);
    expect(new Set([...t.near, ...t.mid]).size).toBe(11);
  });
  it("leaves buildings out of view closed", () => {
    const t = pickInside(city, { x: -5, y: 30, z: 0 }, (c) => c.x < 50, limits);
    expect([...t.near, ...t.mid]).toHaveLength(5);
  });
  it("keeps every building's exterior beyond the near distance when zoomed out", () => {
    const t = pickInside(city, { x: 0, y: 280, z: 0 }, all, limits);
    expect(t.near).toEqual([]);
    expect(t.mid).toHaveLength(11);
  });
  it("puts the selected building first when it is in view", () => {
    const t = pickInside(city, { x: -5, y: 30, z: 0 }, all, limits, undefined, "project:p4");
    expect(t.near[0]).toBe("project:p4");
    expect(t.near).toHaveLength(3);
  });
  it("holds a building in its tier a little past the edge, so it doesn't flicker", () => {
    const one = [{ key: "a", x: 0, y: 0, z: 0 }];
    const lim = { ...limits, near: 1 };
    const first = pickInside(one, { x: 0, y: 59, z: 0 }, all, lim);
    expect(first.near).toEqual(["a"]);
    expect(pickInside(one, { x: 0, y: 65, z: 0 }, all, lim, first).near).toEqual(["a"]);
    expect(pickInside(one, { x: 0, y: 65, z: 0 }, all, lim).near).toEqual([]);
    expect(pickInside(one, { x: 0, y: 80, z: 0 }, all, lim, first).near).toEqual([]);
  });
  it("compares tiers by content", () => {
    expect(sameTiers({ near: ["a"], mid: ["b"] }, { near: ["a"], mid: ["b"] })).toBe(true);
    expect(sameTiers({ near: ["a"], mid: [] }, { near: [], mid: ["a"] })).toBe(false);
  });
});

describe("insideLimits", () => {
  it("never asks for more cuts than the shader has slots", () => {
    for (const phone of [false, true])
      for (const mode of ["balanced", "full", "saver", "auto"] as const)
        for (const battery of [true, false, null]) {
          const l = insideLimits(phone, mode, battery);
          expect(l.near + l.mid).toBeLessThanOrEqual(CUT_MAX);
          expect(l.near).toBeGreaterThanOrEqual(1);
        }
  });
  it("opens a single office at a time on a phone and in Battery saver", () => {
    expect(insideLimits(true, "full", false).near).toBe(1);
    expect(insideLimits(false, "saver", false).near).toBe(1);
    expect(insideLimits(false, "auto", true).near).toBe(1);
    expect(insideLimits(false, "auto", false).near).toBe(3);
  });
});

describe("officeScale and stepCut", () => {
  it("fits the whole office inside the building's footprint", () => {
    for (const plan of [{ w: 8.5, d: 7 }, { w: 10.65, d: 14.2 }, { w: 8.5, d: 31.7 }]) {
      const k = officeScale(plan, 3);
      expect(Math.max(plan.w + 0.32, plan.d + 0.32) * k).toBeLessThanOrEqual(3);
    }
  });
  it("eases toward the target and lands on it exactly", () => {
    let y = 10;
    for (let i = 0; i < 60; i++) y = stepCut(y, 1, 9, 1 / 60, false);
    expect(y).toBe(1);
    expect(stepCut(10, 1, 9, 1 / 60, false)).toBeLessThan(10);
    expect(stepCut(10, 1, 9, 1 / 60, false)).toBeGreaterThan(1);
  });
  it("jumps straight there with reduced motion", () => {
    expect(stepCut(10, 1, 9, 1 / 60, true)).toBe(1);
  });
});
