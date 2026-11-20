import { afterEach, describe, expect, it, vi } from "vitest";
import { catalog } from "../../catalog/index";
import { agentJobs } from "../../catalog/agentJobs";
import { cityFigureFor } from "../../registry/cityFigures";
import { circaResidents } from "./circaHomes";
import { circaUnits, CIRCA_TOWERS } from "./circaFloors";
import { apartmentFocus, blendPose, loadVisit, parseVisit, saveVisit, VISIT_KEY } from "./residenceVisitPrefs";

// Tests run without a browser: a plain in-memory local storage stands in for it.
const data = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => void data.set(key, value),
  removeItem: (key: string) => void data.delete(key),
  clear: () => data.clear(),
});

const residents = circaResidents(agentJobs(catalog), (id) => !!cityFigureFor(id));
const suites = new Set(residents.map((r) => r.home.unit));

describe("Visit apartment: saved suite and preferences", () => {
  afterEach(() => localStorage.clear());

  it("restores a saved suite only when a resident still lives there", () => {
    const r = residents[0];
    expect(parseVisit({ suite: r.home.unit, folded: true }, suites)).toEqual({ suite: r.home.unit, folded: true });
    // A suite nobody lives in, a floor that doesn't exist, the wrong type: all fall back to the overview.
    const empty = circaUnits(5, "east").map((u) => u.id).find((id) => !suites.has(id));
    for (const suite of [empty, "999", 304, "", null]) expect(parseVisit({ suite }, suites).suite).toBeNull();
  });

  it("treats anything but a plain object as nothing saved", () => {
    for (const raw of [null, undefined, "304", 42, true, []]) expect(parseVisit(raw, suites)).toEqual({ suite: null, folded: false });
    expect(parseVisit({ folded: "yes" }, suites).folded).toBe(false);
  });

  it("survives a reload through local storage, and garbled storage falls back safely", () => {
    const unit = residents[1].home.unit;
    saveVisit({ suite: unit, folded: false });
    expect(loadVisit(suites)).toEqual({ suite: unit, folded: false });
    localStorage.setItem(`atlas:${VISIT_KEY}`, "{not json");
    expect(loadVisit(suites)).toEqual({ suite: null, folded: false });
    saveVisit({ suite: null, folded: false });
    expect(localStorage.getItem(`atlas:${VISIT_KEY}`)).toBeNull();
  });
});

describe("Visit apartment: the camera frames the right suite", () => {
  it("looks at the centre of the resident's own apartment, in its own tower", () => {
    for (const r of residents) {
      const { target, position } = apartmentFocus(r.home);
      const tower = CIRCA_TOWERS.find((t) => t.id === r.home.tower)!;
      // West tower apartments sit left of the middle, east tower ones right of it.
      expect(Math.sign(target[0])).toBe(Math.sign(tower.x));
      const u = circaUnits(r.home.level, r.home.tower).find((x) => x.id === r.home.unit)!;
      expect(target[2]).toBeCloseTo((u.z0 + u.z1) / 2);
      expect(position[1]).toBeGreaterThan(target[1]);
    }
  });

  it("frames each apartment from a different spot, and mirrored suites mirror", () => {
    const keys = new Set(residents.map((r) => apartmentFocus(r.home).target.join(",")));
    expect(keys.size).toBe(new Set(residents.map((r) => `${r.home.tower}${r.home.layout}`)).size);
    const west = apartmentFocus({ level: 2, tower: "west", unit: "301", layout: "01" }).target;
    const east = apartmentFocus({ level: 2, tower: "east", unit: "304", layout: "01" }).target;
    expect(east[0]).toBeCloseTo(-west[0]);
  });

  it("glides from one pose to the other and stops exactly there", () => {
    const a = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const b = { position: [10, 20, 30] as [number, number, number], target: [1, 2, 3] as [number, number, number] };
    expect(blendPose(a, b, 0)).toEqual(a);
    expect(blendPose(a, b, 1)).toEqual(b);
    expect(blendPose(a, b, 4)).toEqual(b);
    expect(blendPose(a, b, 0.5).position[0]).toBeGreaterThan(5);
  });
});
