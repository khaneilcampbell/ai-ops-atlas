import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createBloomPipeline } from "./bloomPipeline";

function setup() {
  let dpr = 2;
  const size = new THREE.Vector2(800, 500);
  const gl = { getPixelRatio: () => dpr, getSize: (v: THREE.Vector2) => v.copy(size) } as THREE.WebGLRenderer;
  return { pipeline: createBloomPipeline(gl, new THREE.Scene(), new THREE.PerspectiveCamera()), size, setDpr: (n: number) => { dpr = n; } };
}

describe("night effect resources", () => {
  it("follows adaptive DPR without needing a window resize, with no reallocations at rest", () => {
    const { pipeline: p, setDpr, size } = setup();
    try {
      p.resize();
      expect(p.composer.renderTarget1.width).toBe(1600);
      const resize = vi.spyOn(p.composer, "setSize");
      p.resize(); p.resize();
      expect(resize).not.toHaveBeenCalled();
      setDpr(1); p.resize();
      expect(p.composer.renderTarget1.width).toBe(800);
      expect(p.composer.renderTarget1.height).toBe(500);
      size.set(400, 300); p.resize();
      expect(p.composer.renderTarget1.width).toBe(400);
      expect(p.composer.renderTarget1.height).toBe(300);
    } finally { p.dispose(); }
  });
  it("releases every owned pass, bloom texture and composer target exactly once", () => {
    const { pipeline: p } = setup();
    const passes = p.composer.passes.map(pass => vi.spyOn(pass, "dispose"));
    const composer = vi.spyOn(p.composer, "dispose");
    const highPass = vi.spyOn(p.bloom.materialHighPassFilter, "dispose");
    const textures = [p.bloom.renderTargetBright, ...p.bloom.renderTargetsHorizontal, ...p.bloom.renderTargetsVertical, p.composer.renderTarget1, p.composer.renderTarget2].map(t => vi.spyOn(t, "dispose"));
    p.dispose(); p.dispose();
    for (const spy of [...passes, ...textures, composer, highPass]) expect(spy).toHaveBeenCalledTimes(1);
  });
});
