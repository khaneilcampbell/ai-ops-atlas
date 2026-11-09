import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { lightUp, restore, type GlowCopies } from "./activity";

function building() {
  const shared = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#101010" });
  const basic = new THREE.MeshBasicMaterial();
  const root = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), shared);
  const b = new THREE.Mesh(new THREE.BoxGeometry(), [shared, basic]);
  root.add(a, b);
  const other = new THREE.Mesh(new THREE.BoxGeometry(), shared);
  return { shared, basic, root, a, b, other };
}

describe("whole-building glow", () => {
  it("lights every lit surface of the building and nothing outside it", () => {
    const { shared, basic, root, a, b, other } = building();
    const copies: GlowCopies = new Map();
    lightUp(root, copies, new THREE.Color(0.2, 0.4, 0.6));
    const lit = a.material as THREE.MeshStandardMaterial;
    expect(lit).not.toBe(shared);
    expect((b.material as THREE.Material[])[0]).toBe(lit);
    expect((b.material as THREE.Material[])[1]).toBe(basic);
    expect(lit.emissive.r).toBeCloseTo(shared.emissive.r + 0.2);
    expect(lit.emissive.b).toBeCloseTo(shared.emissive.b + 0.6);
    expect(shared.emissive.getHexString()).toBe("101010");
    expect(other.material).toBe(shared);
  });

  it("reuses its copies frame to frame, even after a re-render swaps the shared material back", () => {
    const { shared, root, a } = building();
    const copies: GlowCopies = new Map();
    lightUp(root, copies, new THREE.Color(0.1, 0.1, 0.1));
    const first = a.material;
    a.material = shared;
    lightUp(root, copies, new THREE.Color(0.3, 0.3, 0.3));
    expect(a.material).toBe(first);
    expect(copies.size).toBe(1);
  });

  it("hands the shared materials back once the glow fades", () => {
    const { shared, basic, root, a, b } = building();
    const copies: GlowCopies = new Map();
    lightUp(root, copies, new THREE.Color(1, 1, 1));
    restore(root, copies);
    expect(a.material).toBe(shared);
    expect(b.material).toEqual([shared, basic]);
    expect(copies.size).toBe(0);
  });
});
