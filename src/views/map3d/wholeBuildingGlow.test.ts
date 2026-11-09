import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLASS_GLOW, glowWeight, INTERIOR_GLOW, lightUp, restore, WINDOW_GLOW, type GlowCopies } from "./activity";

const tex = () => new THREE.Texture();

function building() {
  const mask = tex();
  const windows = new THREE.MeshStandardMaterial({ map: tex(), emissiveMap: mask, emissive: "#ffd6a0", emissiveIntensity: 0 });
  const wall = new THREE.MeshStandardMaterial({ color: "#f2efe9", roughness: 0.85 });
  const basic = new THREE.MeshBasicMaterial();
  const root = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), windows);
  const b = new THREE.Mesh(new THREE.BoxGeometry(), [windows, wall, basic]);
  root.add(a, b);
  const other = new THREE.Mesh(new THREE.BoxGeometry(), windows);
  return { windows, wall, basic, root, a, b, other };
}

describe("whole-building glow follows the building's design", () => {
  it("lets light out through windows and glass, not walls or signs", () => {
    expect(glowWeight(new THREE.MeshStandardMaterial({ map: tex(), emissiveMap: tex() }))).toBe(WINDOW_GLOW);
    expect(glowWeight(new THREE.MeshStandardMaterial({ color: "#3a4650", roughness: 0.15, metalness: 0.4 }))).toBe(GLASS_GLOW);
    expect(glowWeight(new THREE.MeshStandardMaterial({ color: "#efe8dc", roughness: 0.9, emissive: "#ffc98a", emissiveIntensity: 0 }))).toBe(INTERIOR_GLOW);
    expect(glowWeight(new THREE.MeshStandardMaterial({ color: "#f2efe9", roughness: 0.85 }))).toBe(0);
    expect(glowWeight(new THREE.MeshStandardMaterial({ color: "#141618", roughness: 0.4, metalness: 0.4 }))).toBe(0);
    const sign = tex();
    expect(glowWeight(new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, transparent: true, alphaTest: 0.3 }))).toBe(0);
    expect(glowWeight(new THREE.MeshStandardMaterial({ color: "#cfe3ec", roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.45 }))).toBe(0);
    expect(glowWeight(new THREE.MeshBasicMaterial())).toBe(0);
  });

  it("lights only this building's windows, even where the facade is dark by day", () => {
    const { windows, wall, basic, root, a, b, other } = building();
    const copies: GlowCopies = new Map();
    lightUp(root, copies, new THREE.Color(0.2, 0.4, 0.6));
    const lit = a.material as THREE.MeshStandardMaterial;
    expect(lit).not.toBe(windows);
    expect(lit.emissiveIntensity).toBe(1);
    expect(lit.emissive.r).toBeCloseTo(0.2 * WINDOW_GLOW);
    expect(lit.emissive.b).toBeCloseTo(0.6 * WINDOW_GLOW);
    expect(b.material).toEqual([lit, wall, basic]);
    expect(windows.emissiveIntensity).toBe(0);
    expect(other.material).toBe(windows);
  });

  it("keeps a night facade's own light under the glow", () => {
    const { windows, root, a } = building();
    windows.emissiveIntensity = 0.5;
    lightUp(root, new Map(), new THREE.Color(0, 0, 0));
    const lit = a.material as THREE.MeshStandardMaterial;
    expect(lit.emissive.r).toBeCloseTo(windows.emissive.r * 0.5);
  });

  it("reuses its copies frame to frame, even after a re-render swaps the shared material back", () => {
    const { windows, root, a } = building();
    const copies: GlowCopies = new Map();
    lightUp(root, copies, new THREE.Color(0.1, 0.1, 0.1));
    const first = a.material;
    a.material = windows;
    lightUp(root, copies, new THREE.Color(0.3, 0.3, 0.3));
    expect(a.material).toBe(first);
    expect(copies.size).toBe(1);
  });

  it("hands the shared materials back once the glow fades", () => {
    const { windows, wall, basic, root, a, b } = building();
    const copies: GlowCopies = new Map();
    lightUp(root, copies, new THREE.Color(1, 1, 1));
    restore(root, copies);
    expect(a.material).toBe(windows);
    expect(b.material).toEqual([windows, wall, basic]);
    expect(copies.size).toBe(0);
  });
});
