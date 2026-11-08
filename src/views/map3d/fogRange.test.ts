import { describe, expect, it } from "vitest";
import { FOG_FAR_EXT, FOG_NEAR_EXT, fogRange } from "./fogRange";

describe("fogRange", () => {
  const ext = 120;
  it("keeps the zoomed-out haze exactly as before", () => {
    for (const dist of [150, 252, 400]) expect(fogRange(dist, ext)).toEqual({ near: dist * 1.25, far: dist * 3.2 });
  });
  it("never pulls the haze in closer than a share of the map when zoomed in", () => {
    for (const dist of [4, 10, 20, 40]) {
      const r = fogRange(dist, ext);
      expect(r.near).toBeGreaterThanOrEqual(ext * FOG_NEAR_EXT);
      expect(r.far).toBeGreaterThanOrEqual(ext * FOG_FAR_EXT);
    }
  });
  it("keeps the street below a tall tower clear at the closest zoom", () => {
    // Camera at minimum distance above a 40-unit tower looks down about 60 units to the street.
    expect(fogRange(4, ext).near).toBeGreaterThan(60);
  });
  it("never shrinks as the camera moves away", () => {
    let last = fogRange(1, ext);
    for (let d = 2; d < 500; d += 3) {
      const r = fogRange(d, ext);
      expect(r.near).toBeGreaterThanOrEqual(last.near);
      expect(r.far).toBeGreaterThanOrEqual(last.far);
      expect(r.far).toBeGreaterThan(r.near);
      last = r;
    }
  });
});
