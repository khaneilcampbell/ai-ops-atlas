import { describe, expect, it } from "vitest";
import { buildingPlaque, PLANNED, PLAQUE, plaqueWidth } from "./plaques";

const base = { id: "a", select: "service:a", name: "BMW", x: 1, roof: 4, z: 2, priority: 7, mark: PLANNED, title: "BMW · Planned", selKey: null, hover: null, onSelect: () => {} };

describe("building plaques", () => {
  it("sit the same distance above every roof", () => {
    expect(buildingPlaque(base).pos.y).toBeCloseTo(4 + PLAQUE.roofGap);
    expect(buildingPlaque({ ...base, roof: 9.5 }).pos.y).toBeCloseTo(9.5 + PLAQUE.roofGap);
  });

  it("share one height and size to their name, never a fixed width", () => {
    const short = buildingPlaque(base);
    const long = buildingPlaque({ ...base, name: "Financial District Station" });
    expect(short.h).toBe(PLAQUE.height);
    expect(long.h).toBe(PLAQUE.height);
    expect(short.w).toBe(plaqueWidth("BMW"));
    expect(long.w).toBeGreaterThan(short.w);
  });

  it("clip very long names to the same maximum width", () => {
    const p = buildingPlaque({ ...base, name: "A very long building name that would run across half of the map" });
    expect(p.w).toBeLessThanOrEqual(PLAQUE.maxText + PLAQUE.pad + PLAQUE.dot + 1);
  });

  it("use one class and show selected and hover the same way everywhere", () => {
    expect(buildingPlaque(base).className).toBe("m3-plaque compact");
    const sel = buildingPlaque({ ...base, selKey: "service:a" });
    expect(sel.className).toBe("m3-plaque compact selected");
    expect(sel.priority).toBe(0);
    const hov = buildingPlaque({ ...base, hover: "service:a" });
    expect(hov.className).toBe("m3-plaque compact hover");
    expect(hov.priority).toBe(0.5);
    expect(buildingPlaque({ ...base, dim: true }).className).toBe("m3-plaque compact dim");
  });

  it("click selects the building's key, which can differ from its hover key", () => {
    let picked = "";
    buildingPlaque({ ...base, key: "retail:a", select: "service:a", onSelect: (k) => (picked = k) }).onClick!();
    expect(picked).toBe("service:a");
  });
});
