import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Inst } from "./models";

/**
 * One draw for many instanced parts. Across the city, hundreds of small <Instanced> groups (fins,
 * planters, kerbs, bollards, benches) use the same shared box, ball or cylinder with the same plain
 * material, and each was its own draw call. Static, opaque, unclickable ones now hand their parts
 * to a pool that draws every part with the same geometry, material and shadow setting as one
 * instanced mesh, in world space.
 *
 * A part keeps the place its own group gives it: the pool reads the group's world matrix when the
 * part joins, and every frame checks that it hasn't moved or been hidden. A group that hides is
 * blanked out of the pool; a group that moves (a vehicle, a sliding door) leaves the pool for good
 * and draws itself again, so nothing animated ever lags a frame behind its body.
 */

export interface PoolEntry {
  items: Inst[];
  /** Empty object rendered where the part's own mesh would be; its world matrix places the parts. */
  anchor: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  shadow: boolean;
  /** Called when the anchor moves: the part draws itself from then on. */
  leave: () => void;
}

interface Slot extends PoolEntry {
  entry: PoolEntry;
  world: THREE.Matrix4;
  shown: boolean;
  moves: number;
  mirrored: boolean;
}

interface Bucket {
  id: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  shadow: boolean;
  /** Parts whose groups are mirrored (the airport is): drawn by a mesh mirrored the same way. */
  mirrored: boolean;
  slots: Set<Slot>;
  dirty: boolean;
  /** Parts the bucket's mesh has room for; the mesh is remade only when this grows. */
  capacity: number;
}

/** Whether a part can share a pool draw: plain opaque material, not clickable, static by default. */
export function poolable(material: THREE.Material | THREE.Material[], clickable: boolean) {
  if (clickable || Array.isArray(material)) return false;
  return !material.transparent && material.visible && !(material as THREE.Material & { map?: unknown }).map;
}

/** Visible all the way up to the scene root. */
export function shownInScene(o: THREE.Object3D) {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object) => {
  let n = ids.get(o);
  if (!n) ids.set(o, (n = nextId++));
  return n;
};

/** Count of parts in a bucket, so its mesh is made big enough. */
const partsIn = (b: Bucket) => {
  let n = 0;
  for (const s of b.slots) n += s.items.length;
  return n;
};

export class InstancePoolStore {
  buckets = new Map<string, Bucket>();
  private slots = new Map<PoolEntry, Slot>();
  version = 0;
  private listeners = new Set<() => void>();
  /** Asks for a frame (the map draws on demand). */
  invalidate: () => void = () => {};

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private bucketFor(e: PoolEntry, mirrored: boolean) {
    // Tinted and untinted parts stay apart: a tinted mesh needs its own shader variant, and mixing
    // them would add one for a material that never had it.
    const tinted = e.items.some((it) => it.c);
    // A mirrored group turns its faces inside out unless the mesh drawing it is mirrored too (three
    // flips the winding per mesh, never per instance), so mirrored parts get their own draw.
    const id = `${idOf(e.geometry)}:${idOf(e.material)}:${e.shadow ? 1 : 0}:${tinted ? 1 : 0}:${mirrored ? 1 : 0}`;
    let b = this.buckets.get(id);
    if (!b) {
      b = { id, geometry: e.geometry, material: e.material, shadow: e.shadow, mirrored, slots: new Set(), dirty: true, capacity: 0 };
      this.buckets.set(id, b);
    }
    return b;
  }

  /** Refill on the next frame; remake the mesh only when a new bucket appears or one outgrows its mesh. */
  private touched(b: Bucket) {
    b.dirty = true;
    const parts = partsIn(b);
    if (parts > b.capacity) {
      // A little room to grow, without doubling the instance buffers of the city's biggest pools.
      b.capacity = Math.max(8, Math.ceil(parts * 1.1));
      this.changed();
    }
    this.invalidate();
  }

  add(e: PoolEntry) {
    e.anchor.updateWorldMatrix(true, false);
    const world = e.anchor.matrixWorld.clone();
    const s: Slot = { ...e, entry: e, world, shown: shownInScene(e.anchor), moves: 0, mirrored: world.determinant() < 0 };
    this.slots.set(e, s);
    const b = this.bucketFor(e, s.mirrored);
    b.slots.add(s);
    this.touched(b);
  }

  remove(e: PoolEntry) {
    const s = this.slots.get(e);
    if (!s) return;
    this.slots.delete(e);
    // An emptied bucket stays (drawing nothing): parts that re-join a moment later don't remake it.
    for (const b of this.buckets.values()) if (b.slots.delete(s)) this.touched(b);
  }

  /**
   * Once a frame: blank out hidden groups, and follow a group that was placed after it joined. A
   * group that keeps moving (a vehicle, a sliding door) leaves the pool and draws itself again, so
   * nothing animated lags behind its body for more than the frames it took to notice.
   */
  check() {
    const leaving: Slot[] = [];
    for (const b of this.buckets.values()) {
      for (const s of b.slots) {
        const shown = shownInScene(s.anchor);
        if (shown !== s.shown) {
          s.shown = shown;
          b.dirty = true;
        }
        if (!s.anchor.matrixWorld.equals(s.world)) {
          s.world.copy(s.anchor.matrixWorld);
          b.dirty = true;
          if (++s.moves > MOVES_BEFORE_LEAVING || (s.world.determinant() < 0) !== s.mirrored) leaving.push(s);
        }
      }
    }
    for (const s of leaving) {
      this.remove(s.entry);
      s.leave();
    }
    return leaving.length > 0;
  }

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

/** A group placed once after it mounts moves once or twice; one still moving after this is animated. */
const MOVES_BEFORE_LEAVING = 3;

const PoolContext = createContext<InstancePoolStore | null>(null);
export const useInstancePool = () => useContext(PoolContext);

const o = new THREE.Object3D();
const local = new THREE.Matrix4();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);
/** Mirror across x; its own inverse. */
export const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const toPool = new THREE.Matrix4();
const white = new THREE.Color("#ffffff");
const c = new THREE.Color();


/** Writes every part of a bucket into its instanced mesh, in world space. */
export function fillBucket(mesh: THREE.InstancedMesh, b: Bucket) {
  let i = 0;
  const colored = [...b.slots].some((s) => s.items.some((it) => it.c));
  for (const s of b.slots) {
    // A mirrored bucket's mesh carries MIRROR, so its parts are written un-mirrored.
    toPool.copy(s.world);
    if (b.mirrored) toPool.premultiply(MIRROR);
    for (const it of s.items) {
      if (s.shown) {
        o.position.set(...it.p);
        o.rotation.set(it.rx ?? 0, it.r ?? 0, it.rz ?? 0, "YXZ");
        o.scale.set(...it.s);
        o.updateMatrix();
        local.multiplyMatrices(toPool, o.matrix);
        mesh.setMatrixAt(i, local);
      } else mesh.setMatrixAt(i, zero);
      if (colored) mesh.setColorAt(i, it.c ? c.set(it.c) : white);
      i++;
    }
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
}

const noRaycast = () => null;

function BucketMesh({ bucket }: { bucket: Bucket }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const fill = () => {
    const m = ref.current;
    if (!m) return;
    fillBucket(m, bucket);
    m.visible = m.count > 0;
    if (bucket.mirrored) {
      m.matrix.copy(MIRROR);
      m.matrixWorldNeedsUpdate = true;
    }
    bucket.dirty = false;
  };
  useLayoutEffect(fill, [bucket, bucket.capacity]);
  useFrame(() => {
    if (bucket.dirty) fill();
  });
  return <instancedMesh key={bucket.capacity} ref={ref} args={[bucket.geometry, bucket.material, bucket.capacity]} castShadow={bucket.shadow} receiveShadow matrixAutoUpdate={false} raycast={noRaycast} />;
}

/**
 * Put this directly inside the <Canvas>, around the world, with no transform of its own: the pool's
 * meshes are drawn in world space.
 */
export function InstancePool({ children }: { children: ReactNode }) {
  const store = useMemo(() => new InstancePoolStore(), []);
  const invalidate = useThree((st) => st.invalidate);
  store.invalidate = invalidate;
  const [, setVersion] = useState(0);
  useLayoutEffect(() => {
    let queued = false;
    return store.subscribe(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        setVersion(store.version);
      });
    });
  }, [store]);
  // Before anything else this frame (lower priority runs first in R3F's default loop order).
  useFrame(() => {
    store.check();
  }, -1);
  return (
    <PoolContext.Provider value={store}>
      {children}
      {[...store.buckets.values()].map((b) => (
        <BucketMesh key={b.id} bucket={b} />
      ))}
    </PoolContext.Provider>
  );
}
