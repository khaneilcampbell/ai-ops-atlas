import { describe, expect, it } from "vitest";
import { depthRange, MIN_SHADOW_HALF, shadowBox } from "./viewFit";

describe("shadowBox", () => {
  it("keeps the whole-island box when zoomed out", () => {
    expect(shadowBox(40, { x: 3, y: -2 }, 30, 4096)).toEqual({ left: -30, right: 30, top: 30, bottom: -30, texel: 60 / 4096 });
  });

  it("shrinks to cover the view when zoomed in, for sharper shadows", () => {
    const b = shadowBox(5, { x: 0, y: 0 }, 30, 4096);
    const half = (b.right - b.left) / 2;
    expect(half).toBeGreaterThanOrEqual(5 * 1.9);
    expect(half).toBeLessThan(5 * 1.9 * Math.SQRT2 + 1e-9);
    expect(b.texel).toBeLessThan(60 / 4096 / 2);
  });

  it("never gets smaller than a block either side", () => {
    const b = shadowBox(0.5, { x: 0, y: 0 }, 30, 4096);
    expect((b.right - b.left) / 2).toBeGreaterThanOrEqual(MIN_SHADOW_HALF);
  });

  it("uses a few fixed sizes, so small zooms don't change the shadows", () => {
    expect(shadowBox(6, { x: 0, y: 0 }, 30, 4096).texel).toBe(shadowBox(6.3, { x: 0, y: 0 }, 30, 4096).texel);
  });

  it("moves in whole texels and holds still for small pans", () => {
    const a = shadowBox(5, { x: 1.234, y: -0.5 }, 30, 4096);
    const b = shadowBox(5, { x: 1.25, y: -0.49 }, 30, 4096);
    expect(b).toEqual(a);
    expect(Math.abs(a.left / a.texel - Math.round(a.left / a.texel))).toBeLessThan(1e-6);
  });
});

describe("depthRange", () => {
  it("moves the near plane out with the camera, for more depth precision", () => {
    expect(depthRange(4).near).toBe(0.5);
    expect(depthRange(100).near).toBe(4);
    expect(depthRange(100).far).toBeGreaterThan(100 * 3.2);
  });
});
