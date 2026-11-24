import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { InstancePoolStore, MIRROR, fillBucket, poolable, shownInScene, type PoolEntry } from "./instancePool";
import type { Inst } from "./models";

const box = new THREE.BoxGeometry(1, 1, 1);
const plain = new THREE.MeshStandardMaterial();

function entry(items: Inst[], parent: THREE.Object3D, over: Partial<PoolEntry> = {}): PoolEntry {
  const anchor = new THREE.Group();
  parent.add(anchor);
  return { items, anchor, geometry: box, material: plain, shadow: true, leave: vi.fn(), ...over };
}

const meshFor = (store: InstancePoolStore, id = [...store.buckets.keys()][0]) => {
  const b = store.buckets.get(id)!;
  const m = new THREE.InstancedMesh(b.geometry, b.material, b.capacity);
  fillBucket(m, b);
  return { b, m };
};

const at = (m: THREE.InstancedMesh, i: number) => {
  const x = new THREE.Matrix4();
  m.getMatrixAt(i, x);
  return new THREE.Vector3().setFromMatrixPosition(x);
};

describe("instance pool", () => {
  it("draws parts from many groups with the same shape and material as one mesh", () => {
    const scene = new THREE.Scene();
    const store = new InstancePoolStore();
    const a = new THREE.Group(), b = new THREE.Group();
    a.position.set(10, 0, 0);
    b.position.set(0, 0, -5);
    scene.add(a, b);
    store.add(entry([{ p: [1, 0, 0], s: [1, 1, 1] }, { p: [2, 0, 0], s: [1, 1, 1] }], a));
    store.add(entry([{ p: [0, 2, 0], s: [1, 1, 1] }], b));
    expect(store.buckets.size).toBe(1);
    const { m } = meshFor(store);
    expect(m.count).toBe(3);
    // Each part keeps the place its own group gives it.
    expect(at(m, 0).toArray()).toEqual([11, 0, 0]);
    expect(at(m, 1).toArray()).toEqual([12, 0, 0]);
    expect(at(m, 2).toArray()).toEqual([0, 2, -5]);
  });

  it("keeps different materials, shadow settings and tinted parts in separate draws", () => {
    const scene = new THREE.Scene();
    const store = new InstancePoolStore();
    store.add(entry([{ p: [0, 0, 0], s: [1, 1, 1] }], scene));
    store.add(entry([{ p: [0, 0, 0], s: [1, 1, 1] }], scene, { material: new THREE.MeshStandardMaterial() }));
    store.add(entry([{ p: [0, 0, 0], s: [1, 1, 1] }], scene, { shadow: false }));
    store.add(entry([{ p: [0, 0, 0], s: [1, 1, 1], c: "#ff0000" }], scene));
    expect(store.buckets.size).toBe(4);
  });

  it("blanks out a group that is hidden and brings it back when shown", () => {
    const scene = new THREE.Scene();
    const store = new InstancePoolStore();
    const g = new THREE.Group();
    scene.add(g);
    store.add(entry([{ p: [3, 0, 0], s: [1, 1, 1] }], g));
    g.visible = false;
    store.check();
    const { m, b } = meshFor(store);
    expect(at(m, 0).toArray()).toEqual([0, 0, 0]);
    const x = new THREE.Matrix4();
    m.getMatrixAt(0, x);
    expect(x.determinant()).toBe(0);
    g.visible = true;
    store.check();
    expect(b.dirty).toBe(true);
    fillBucket(m, b);
    expect(at(m, 0).toArray()).toEqual([3, 0, 0]);
  });

  it("follows a group placed once after it joined, and lets a moving group draw itself", () => {
    const scene = new THREE.Scene();
    const store = new InstancePoolStore();
    const g = new THREE.Group();
    scene.add(g);
    const e = entry([{ p: [0, 0, 0], s: [1, 1, 1] }], g);
    store.add(e);
    g.position.x = 4;
    scene.updateMatrixWorld();
    store.check();
    expect(e.leave).not.toHaveBeenCalled();
    expect(at(meshFor(store).m, 0).x).toBe(4);
    for (let i = 0; i < 4; i++) {
      g.position.x += 1;
      scene.updateMatrixWorld();
      store.check();
    }
    expect(e.leave).toHaveBeenCalledTimes(1);
    expect(meshFor(store).m.count).toBe(0);
  });

  it("only remakes a mesh when a bucket outgrows it, not when parts re-join", () => {
    const scene = new THREE.Scene();
    const store = new InstancePoolStore();
    const remade = vi.fn();
    store.subscribe(remade);
    const items: Inst[] = Array.from({ length: 5 }, (_, i) => ({ p: [i, 0, 0], s: [1, 1, 1] }));
    const e = entry(items, scene);
    store.add(e);
    expect(remade).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) {
      store.remove(e);
      store.add(e);
    }
    expect(remade).toHaveBeenCalledTimes(1);
    store.add(entry(Array.from({ length: 50 }, () => ({ p: [0, 0, 0], s: [1, 1, 1] })), scene));
    expect(remade).toHaveBeenCalledTimes(2);
  });

  it("draws parts of a mirrored group with a mirrored mesh, so their faces don't turn inside out", () => {
    const scene = new THREE.Scene();
    const store = new InstancePoolStore();
    const g = new THREE.Group();
    g.scale.set(-1, 1, 1);
    g.position.set(-18, 0, 0);
    scene.add(g);
    store.add(entry([{ p: [2, 0, 0], s: [1, 1, 1] }], g));
    store.add(entry([{ p: [2, 0, 0], s: [1, 1, 1] }], scene));
    expect(store.buckets.size).toBe(2);
    const id = [...store.buckets.values()].find((b) => b.mirrored)!.id;
    const { m } = meshFor(store, id);
    const x = new THREE.Matrix4();
    m.getMatrixAt(0, x);
    // Each instance is un-mirrored; the mesh's own mirror puts it back where the group shows it.
    expect(x.determinant()).toBeGreaterThan(0);
    expect(new THREE.Vector3().setFromMatrixPosition(x.premultiply(MIRROR)).toArray()).toEqual([-20, 0, 0]);
  });

  it("leaves clickable, see-through, textured and multi-material parts alone", () => {
    expect(poolable(plain, false)).toBe(true);
    expect(poolable(plain, true)).toBe(false);
    expect(poolable(new THREE.MeshStandardMaterial({ transparent: true }), false)).toBe(false);
    expect(poolable(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), false)).toBe(false);
    expect(poolable([plain, plain], false)).toBe(false);
  });

  it("treats a part as hidden when any group above it is hidden", () => {
    const scene = new THREE.Scene(), a = new THREE.Group(), b = new THREE.Group();
    scene.add(a);
    a.add(b);
    expect(shownInScene(b)).toBe(true);
    a.visible = false;
    expect(shownInScene(b)).toBe(false);
  });

  it("is wired around the 3D map's world", () => {
    const map = readFileSync(new URL("./Map3D.tsx", import.meta.url), "utf8");
    expect(map).toMatch(/<InstancePool>\s*<World/);
  });
});
