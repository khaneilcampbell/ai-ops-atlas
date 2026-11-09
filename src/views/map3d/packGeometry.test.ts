import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { packNormals } from "./packGeometry";

describe("packNormals", () => {
  it("halves normal memory and keeps each normal within 1/30000 of the original", () => {
    const g = new THREE.SphereGeometry(1, 12, 9);
    const before = Float32Array.from(g.getAttribute("normal").array as Float32Array);
    packNormals(g);
    const n = g.getAttribute("normal") as THREE.BufferAttribute;
    expect(n.array).toBeInstanceOf(Int16Array);
    expect(n.normalized).toBe(true);
    expect(n.array.byteLength).toBe(before.byteLength / 2);
    // getX/getY/getZ undo the fixed point, as the shader does.
    for (let i = 0; i < n.count; i++) {
      expect(Math.abs(n.getX(i) - before[i * 3])).toBeLessThan(1 / 30000);
      expect(Math.abs(n.getY(i) - before[i * 3 + 1])).toBeLessThan(1 / 30000);
      expect(Math.abs(n.getZ(i) - before[i * 3 + 2])).toBeLessThan(1 / 30000);
    }
  });

  it("packs every geometry in a tower builder's result and leaves the rest alone", () => {
    const parts = { shell: new THREE.BoxGeometry(), list: [new THREE.PlaneGeometry()], name: "tower", missing: undefined };
    expect(packNormals(parts)).toBe(parts);
    expect(parts.shell.getAttribute("normal").array).toBeInstanceOf(Int16Array);
    expect(parts.list[0].getAttribute("normal").array).toBeInstanceOf(Int16Array);
    expect(parts.name).toBe("tower");
    expect(packNormals(undefined)).toBeUndefined();
  });

  it("is safe to run twice and skips geometry without normals", () => {
    const g = new THREE.BoxGeometry();
    packNormals(g);
    const once = g.getAttribute("normal");
    packNormals(g);
    expect(g.getAttribute("normal")).toBe(once);
    const bare = new THREE.BufferGeometry();
    bare.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    expect(() => packNormals(bare)).not.toThrow();
  });
});
