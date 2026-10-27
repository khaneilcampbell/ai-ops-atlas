import { useLayoutEffect, useMemo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { facadeTexture, houseWallTexture, initials, patterned, signTexture } from "./materials";
import { FLOOR_H, LAND_BOTTOM, TERRACE_H, WATER_Y, type House, type Scene3D, type StrayBuilding, type Tower } from "./scene";

// Reusable models for the 3D map. Everything repeated is drawn with instancing, so hundreds of
// repositories cost a few dozen draw calls instead of thousands.

export interface Inst {
  p: [number, number, number];
  s: [number, number, number];
  /** Rotation about y, then x. */
  r?: number;
  rx?: number;
  c?: string;
}

export type PickHandler = (key: string, e: ThreeEvent<PointerEvent | MouseEvent>) => void;
export interface Pick {
  keys: string[];
  over: PickHandler;
  out: () => void;
  click: PickHandler;
}

const noRaycast = () => null;

/** One instanced mesh. Bases sit at p.y because the shared geometries are lifted to y=0. */
export function Instanced({ items, geometry, material, pick, shadow = true }: { items: Inst[]; geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; pick?: Pick; shadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    const colored = items.some((it) => it.c);
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.rotation.set(it.rx ?? 0, it.r ?? 0, 0, "YXZ");
      o.scale.set(...it.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (colored) m.setColorAt(i, c.set(it.c ?? "#ffffff"));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.computeBoundingBox();
  }, [items]);
  if (!items.length) return null;
  const key = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId !== undefined ? pick?.keys[e.instanceId] : undefined);
  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={shadow}
      receiveShadow
      raycast={pick ? undefined : noRaycast}
      onPointerOver={
        pick
          ? (e) => {
              e.stopPropagation();
              const k = key(e);
              if (k) pick.over(k, e);
            }
          : undefined
      }
      onPointerOut={pick ? () => pick.out() : undefined}
      onClick={
        pick
          ? (e) => {
              e.stopPropagation();
              const k = key(e);
              if (k) pick.click(k, e);
            }
          : undefined
      }
    />
  );
}

// ── Shared geometry ─────────────────────────────────

const lifted = (g: THREE.BufferGeometry) => g.translate(0, 0.5, 0);

function fromTriangles(tris: number[][]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/** Gabled roof slopes over a unit footprint, ridge along x at height 1. */
function gableSlopes() {
  const a = [-0.5, 0, 0.5], b = [0.5, 0, 0.5], c = [0.5, 0, -0.5], d = [-0.5, 0, -0.5];
  const r1 = [-0.5, 1, 0], r2 = [0.5, 1, 0];
  return fromTriangles([a, b, r2, a, r2, r1, c, d, r1, c, r1, r2].map((v) => v));
}
/** The two triangular gable ends, drawn in wall color. */
function gableEnds() {
  return fromTriangles([[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0], [-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0]]);
}
/** Hipped roof: four slopes up to a short ridge. */
function hipRoof() {
  const a = [-0.5, 0, 0.5], b = [0.5, 0, 0.5], c = [0.5, 0, -0.5], d = [-0.5, 0, -0.5];
  const r1 = [-0.22, 1, 0], r2 = [0.22, 1, 0];
  return fromTriangles([a, b, r2, a, r2, r1, c, d, r1, c, r1, r2, b, c, r2, d, a, r1]);
}

export function useGeometries() {
  return useMemo(
    () => ({
      box: lifted(new THREE.BoxGeometry(1, 1, 1)),
      gable: gableSlopes(),
      gableEnds: gableEnds(),
      hip: hipRoof(),
      cyl: lifted(new THREE.CylinderGeometry(0.5, 0.5, 1, 14)),
      trunk: lifted(new THREE.CylinderGeometry(0.35, 0.5, 1, 6)),
      blob: new THREE.IcosahedronGeometry(1, 2),
      cone: lifted(new THREE.ConeGeometry(0.5, 1, 9)),
      rock: new THREE.DodecahedronGeometry(1, 0),
      ball: new THREE.SphereGeometry(1, 10, 8),
      plane: new THREE.PlaneGeometry(1, 1),
    }),
    [],
  );
}

export function useMaterials() {
  return useMemo(() => {
    const cliff = patterned("#b39874", "cliff");
    const wall = patterned("#d6cbb2", "wall");
    const facade = facadeTexture(7);
    facade.wrapS = THREE.RepeatWrapping;
    return {
      land: [cliff, cliff, patterned("#7aae4f", "grass"), cliff, cliff, cliff],
      terrace: [wall, wall, patterned("#86b958", "grass"), wall, wall, wall],
      sand: patterned("#e4d3a3", "sand"),
      foam: new THREE.MeshStandardMaterial({ color: "#d9eee8", roughness: 1 }),
      water: patterned("#4e9fb7", "water", { roughness: 0.35, metalness: 0.05 }),
      brook: patterned("#5aaac0", "water", { roughness: 0.3 }),
      falls: patterned("#ffffff", "falls", { transparent: true, opacity: 0.92, roughness: 0.4, side: THREE.DoubleSide }),
      stone: patterned("#e6d6b4", "stone"),
      step: patterned("#d9ceb4", "stone"),
      plain: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85 }),
      roof: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.75, flatShading: true }),
      houseWall: new THREE.MeshStandardMaterial({ map: houseWallTexture(), roughness: 0.9 }),
      facade: new THREE.MeshStandardMaterial({ map: facade, roughness: 0.55 }),
      glass: new THREE.MeshStandardMaterial({ color: "#f3dc95", emissive: "#e9c46a", emissiveIntensity: 0.35, roughness: 0.3 }),
      solar: new THREE.MeshStandardMaterial({ color: "#2e4660", roughness: 0.25, metalness: 0.4 }),
      foliage: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95 }),
      lamp: new THREE.MeshStandardMaterial({ color: "#fbe7a6", emissive: "#f3cf73", emissiveIntensity: 0.8 }),
    };
  }, []);
}

type G = ReturnType<typeof useGeometries>;
type M = ReturnType<typeof useMaterials>;

const grow = (r: { x: number; z: number; w: number; d: number }, m: number) => ({ x: r.x - m, z: r.z - m, w: r.w + 2 * m, d: r.d + 2 * m });
const slab = (r: { x: number; z: number; w: number; d: number }, y0: number, y1: number, c?: string): Inst => ({ p: [r.x + r.w / 2, y0, r.z + r.d / 2], s: [r.w, y1 - y0, r.d], c });

// ── Terrain ─────────────────────────────────────────

export function Terrain({ scene, g, m, onTerrace }: { scene: Scene3D; g: G; m: M; onTerrace: Pick }) {
  const items = useMemo(() => {
    const top = TERRACE_H;
    return {
      land: scene.land.map((r) => slab(r, LAND_BOTTOM, 0)),
      sand: scene.land.map((r) => slab(grow(r, 0.42), LAND_BOTTOM, WATER_Y + 0.07)),
      foam: scene.land.map((r) => slab(grow(r, 0.72), WATER_Y - 0.02, WATER_Y + 0.006)),
      terraces: scene.terraces.map((t) => slab(t, 0, top)),
      paving: scene.paving.map((p) => slab(p, p.y, p.y + p.h)),
      steps: scene.steps.map((s) => slab(s, 0, s.y + 0.01)),
      brooks: scene.brooks.map((b) => slab(b, -0.03, 0.016)),
      banks: scene.brooks.flatMap((b) => [slab({ x: b.x, z: b.z - 0.07, w: b.w, d: 0.09 }, 0, 0.035), slab({ x: b.x, z: b.z + b.d - 0.02, w: b.w, d: 0.09 }, 0, 0.035)]),
      ponds: scene.ponds.map((p) => ({ p: [p.x, p.y - 0.03, p.z], s: [p.r * 2, 0.058, p.r * 2] }) as Inst),
      pondRims: scene.ponds.map((p) => ({ p: [p.x, p.y - 0.02, p.z], s: [p.r * 2 + 0.16, 0.035, p.r * 2 + 0.16] }) as Inst),
      bridges: scene.bridges.flatMap((b) => [
        slab(b, 0.05, 0.13),
        slab({ x: b.x, z: b.z, w: 0.05, d: b.d }, 0.13, 0.25),
        slab({ x: b.x + b.w - 0.05, z: b.z, w: 0.05, d: b.d }, 0.13, 0.25),
      ]),
      falls: scene.falls.map((f) => {
        const x = f.axis === "x";
        return { p: [f.x + (x ? f.dir * 0.03 : 0), (WATER_Y + 0.02) / 2, f.z + (x ? 0 : f.dir * 0.03)], s: [0.5, -WATER_Y, 1], r: x ? (f.dir * Math.PI) / 2 : f.dir > 0 ? 0 : Math.PI } as Inst;
      }),
      splash: scene.falls.flatMap((f) =>
        [0, 1, 2, 3, 4].map((i) => {
          const out = f.dir * (0.16 + (i % 2) * 0.14);
          const across = (i - 2) * 0.12;
          return { p: [f.x + (f.axis === "x" ? out : across), WATER_Y + 0.02, f.z + (f.axis === "x" ? across : out)], s: [0.14, 0.07, 0.14] } as Inst;
        }),
      ),
      fountains: scene.fountains.flatMap((f) => [
        { p: [f.x, top, f.z], s: [0.95, 0.14, 0.95], c: "#cfc4ab" } as Inst,
        { p: [f.x, top + 0.14, f.z], s: [0.08, 0.34, 0.08], c: "#cfc4ab" } as Inst,
        { p: [f.x, top + 0.42, f.z], s: [0.3, 0.06, 0.3], c: "#cfc4ab" } as Inst,
      ]),
      fountainWater: scene.fountains.map((f) => ({ p: [f.x, top + 0.1, f.z], s: [0.8, 0.06, 0.8] }) as Inst),
    };
  }, [scene]);
  const ext = scene.bounds;
  const cx = (ext.x0 + ext.x1) / 2;
  const cz = (ext.z0 + ext.z1) / 2;
  return (
    <group>
      <mesh position={[cx, WATER_Y, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.water} raycast={noRaycast}>
        <planeGeometry args={[400, 400]} />
      </mesh>
      <Instanced items={items.foam} geometry={g.box} material={m.foam} shadow={false} />
      <Instanced items={items.sand} geometry={g.box} material={m.sand} shadow={false} />
      <Instanced items={items.land} geometry={g.box} material={m.land} />
      <Instanced items={items.terraces} geometry={g.box} material={m.terrace} pick={onTerrace} />
      <Instanced items={items.paving} geometry={g.box} material={m.stone} shadow={false} />
      <Instanced items={items.steps} geometry={g.box} material={m.step} />
      <Instanced items={items.brooks} geometry={g.box} material={m.brook} shadow={false} />
      <Instanced items={items.banks} geometry={g.box} material={m.step} shadow={false} />
      <Instanced items={items.pondRims} geometry={g.cyl} material={m.step} shadow={false} />
      <Instanced items={items.ponds} geometry={g.cyl} material={m.brook} shadow={false} />
      <Instanced items={items.bridges} geometry={g.box} material={m.step} />
      <Instanced items={items.falls} geometry={g.plane} material={m.falls} shadow={false} />
      <Instanced items={items.splash} geometry={g.ball} material={m.foam} shadow={false} />
      <Instanced items={items.fountains} geometry={g.cyl} material={m.plain} />
      <Instanced items={items.fountainWater} geometry={g.cyl} material={m.brook} shadow={false} />
    </group>
  );
}

// ── Landscaping ─────────────────────────────────────

const LEAVES = ["#4f8b3b", "#5c9a43", "#6aa84b", "#477f37"];
const BLOSSOM = ["#e7b2bf", "#f0c6cf", "#dc9fb0"];

export function Landscape({ scene, g, m }: { scene: Scene3D; g: G; m: M }) {
  const items = useMemo(() => {
    const trunks: Inst[] = [];
    const blobs: Inst[] = [];
    const cones: Inst[] = [];
    scene.trees.forEach((t, i) => {
      const s = t.s;
      if (t.kind === "cone") {
        trunks.push({ p: [t.x, t.y, t.z], s: [0.07, s * 0.6, 0.07], c: "#6b5038" });
        cones.push({ p: [t.x, t.y + s * 0.4, t.z], s: [s * 1.8, s * 2.2, s * 1.8], c: "#3f7342" });
        cones.push({ p: [t.x, t.y + s * 1.4, t.z], s: [s * 1.35, s * 1.7, s * 1.35], c: "#4c8550" });
        return;
      }
      const pal = t.kind === "blossom" ? BLOSSOM : LEAVES;
      const col = (k: number) => pal[(i + k) % pal.length];
      trunks.push({ p: [t.x, t.y, t.z], s: [0.08, s * 1.3, 0.08], c: "#7a5c40" });
      blobs.push({ p: [t.x, t.y + s * 1.9, t.z], s: [s, s * 0.95, s], c: col(0) });
      blobs.push({ p: [t.x - s * 0.45, t.y + s * 1.55, t.z + s * 0.3], s: [s * 0.72, s * 0.66, s * 0.72], c: col(1) });
      blobs.push({ p: [t.x + s * 0.4, t.y + s * 1.6, t.z - s * 0.25], s: [s * 0.7, s * 0.66, s * 0.7], c: col(2) });
      blobs.push({ p: [t.x + s * 0.1, t.y + s * 2.45, t.z + s * 0.1], s: [s * 0.55, s * 0.5, s * 0.55], c: col(3) });
    });
    const bushes: Inst[] = scene.bushes.map((b, i) => ({ p: [b.x, b.y + b.s * 0.5, b.z], s: [b.s * 1.4, b.s, b.s * 1.4], c: LEAVES[i % 3] }));
    const flowers: Inst[] = scene.bushes
      .filter((_, i) => i % 3 === 0)
      .flatMap((b, i) => [0, 1, 2].map((k) => ({ p: [b.x + (k - 1) * b.s * 0.7, b.y + b.s * 1.2, b.z + ((k % 2) - 0.5) * b.s], s: [0.035, 0.035, 0.035], c: ["#f6efd8", "#e9c97a", "#eab8c2"][(i + k) % 3] }) as Inst));
    const rocks: Inst[] = scene.rocks.map((r, i) => ({ p: [r.x, r.y, r.z], s: [r.s, r.s * 0.6, r.s * 0.9], r: i, c: i % 2 ? "#9d9a8e" : "#8b897e" }));
    const poles: Inst[] = scene.lamps.map((l) => ({ p: [l.x, l.y, l.z], s: [0.03, 0.42, 0.03], c: "#3c4c40" }));
    const bulbs: Inst[] = scene.lamps.map((l) => ({ p: [l.x, l.y + 0.45, l.z], s: [0.045, 0.045, 0.045] }));
    return { trunks, blobs, cones, bushes, flowers, rocks, poles, bulbs };
  }, [scene]);
  return (
    <group>
      <Instanced items={items.trunks} geometry={g.trunk} material={m.plain} />
      <Instanced items={items.blobs} geometry={g.blob} material={m.foliage} />
      <Instanced items={items.cones} geometry={g.cone} material={m.foliage} />
      <Instanced items={items.bushes} geometry={g.blob} material={m.foliage} />
      <Instanced items={items.flowers} geometry={g.ball} material={m.plain} shadow={false} />
      <Instanced items={items.rocks} geometry={g.rock} material={m.roof} />
      <Instanced items={items.poles} geometry={g.cyl} material={m.plain} />
      <Instanced items={items.bulbs} geometry={g.ball} material={m.lamp} shadow={false} />
    </group>
  );
}

// ── Buildings ───────────────────────────────────────

export function Houses({ houses, g, m, pick }: { houses: House[]; g: G; m: M; pick: PickHandlerSet }) {
  const items = useMemo(() => {
    const y0 = TERRACE_H + 0.03;
    const gable = houses.filter((h) => !h.hip);
    const hip = houses.filter((h) => h.hip);
    const roofOf = (h: House): Inst => ({ p: [h.x, y0 + h.h, h.z], s: [h.w + 0.14, h.roofH, h.d + 0.16], c: h.roof });
    const slope = (h: House) => Math.atan2(h.roofH, h.d / 2 + 0.08);
    return {
      walls: houses.map((h) => ({ p: [h.x, y0, h.z], s: [h.w, h.h, h.d], c: h.wall }) as Inst),
      wallKeys: houses.map((h) => h.key),
      gable: gable.map(roofOf),
      gableKeys: gable.map((h) => h.key),
      ends: gable.map((h) => ({ p: [h.x, y0 + h.h, h.z], s: [h.w, h.roofH, h.d], c: h.wall }) as Inst),
      hip: hip.map(roofOf),
      hipKeys: hip.map((h) => h.key),
      doors: houses.map((h) => ({ p: [h.x + h.w * 0.12, y0, h.z + h.d / 2], s: [0.13, Math.min(0.26, h.h * 0.6), 0.03], c: "#6a4e36" }) as Inst),
      stoops: houses.map((h) => ({ p: [h.x + h.w * 0.12, TERRACE_H, h.z + h.d / 2 + 0.06], s: [0.24, 0.05, 0.14], c: "#d8ccb2" }) as Inst),
      chimneys: houses.filter((h) => h.chimney).map((h) => ({ p: [h.x - h.w * 0.28, y0 + h.h + h.roofH * 0.3, h.z - h.d * 0.18], s: [0.09, h.roofH * 0.95, 0.09], c: "#a8826a" }) as Inst),
      solar: houses
        .filter((h) => h.solar && !h.hip)
        .map((h) => ({ p: [h.x + h.w * 0.08, y0 + h.h + h.roofH * 0.42 + 0.02, h.z + h.d * 0.22], s: [h.w * 0.55, 0.02, h.d * 0.36], rx: slope(h) }) as Inst),
    };
  }, [houses]);
  return (
    <group>
      <Instanced items={items.walls} geometry={g.box} material={m.houseWall} pick={pick.of(items.wallKeys)} />
      <Instanced items={items.ends} geometry={g.gableEnds} material={m.plain} />
      <Instanced items={items.gable} geometry={g.gable} material={m.roof} pick={pick.of(items.gableKeys)} />
      <Instanced items={items.hip} geometry={g.hip} material={m.roof} pick={pick.of(items.hipKeys)} />
      <Instanced items={items.doors} geometry={g.box} material={m.plain} />
      <Instanced items={items.stoops} geometry={g.box} material={m.plain} shadow={false} />
      <Instanced items={items.chimneys} geometry={g.box} material={m.plain} />
      <Instanced items={items.solar} geometry={g.box} material={m.solar} />
    </group>
  );
}

export interface PickHandlerSet {
  of: (keys: string[]) => Pick;
}

const FLOOR_BASE = TERRACE_H + 0.15;

export function towerTop(t: Tower) {
  return FLOOR_BASE + t.height + 0.12;
}

export function Towers({ towers, strays, g, m, pick }: { towers: Tower[]; strays: StrayBuilding[]; g: G; m: M; pick: PickHandlerSet }) {
  const items = useMemo(() => {
    const floors: Inst[] = [];
    const floorKeys: string[] = [];
    const trims: Inst[] = [];
    const roofs: Inst[] = [];
    const units: Inst[] = [];
    const panels: Inst[] = [];
    const glass: Inst[] = [];
    for (const t of towers) {
      const s = t.size;
      trims.push({ p: [t.x, TERRACE_H, t.z], s: [s * 1.14, 0.15, s * 1.14], c: "#8d8a80" });
      for (let i = 0; i < t.floors; i++) {
        floors.push({ p: [t.x, FLOOR_BASE + i * FLOOR_H, t.z], s: [s, FLOOR_H, s] });
        floorKeys.push(t.key);
      }
      // A setback upper block on tall towers, like the reference's stepped offices.
      const top = FLOOR_BASE + t.height;
      trims.push({ p: [t.x, top, t.z], s: [s * 1.05, 0.08, s * 1.05], c: "#e3e5df" });
      roofs.push({ p: [t.x, top + 0.08, t.z], s: [s * 0.96, 0.04, s * 0.96], c: "#3f474d" });
      units.push({ p: [t.x - s * 0.22, top + 0.12, t.z - s * 0.2], s: [s * 0.3, 0.16, s * 0.24], c: "#c9ccc6" });
      units.push({ p: [t.x + s * 0.25, top + 0.12, t.z - s * 0.25], s: [s * 0.16, 0.22, s * 0.16], c: "#aeb3ad" });
      for (let k = 0; k < 3; k++) panels.push({ p: [t.x - s * 0.25 + k * s * 0.22, top + 0.16, t.z + s * 0.22], s: [s * 0.18, 0.02, s * 0.28], rx: -0.35 });
      // Lit lobby and canopy facing the viewer on both visible sides.
      glass.push({ p: [t.x, FLOOR_BASE, t.z + s / 2 + 0.005], s: [s * 0.38, 0.24, 0.02] });
      glass.push({ p: [t.x + s / 2 + 0.005, FLOOR_BASE, t.z], s: [0.02, 0.24, s * 0.3] });
      trims.push({ p: [t.x, FLOOR_BASE + 0.26, t.z + s / 2 + 0.08], s: [s * 0.5, 0.03, 0.18], c: "#2f4535" });
    }
    for (const t of strays) {
      const n = Math.max(2, Math.round(t.height / 0.3));
      for (let i = 0; i < n; i++) {
        floors.push({ p: [t.x, i * 0.3, t.z], s: [t.size, 0.3, t.size] });
        floorKeys.push(t.key);
      }
      roofs.push({ p: [t.x, n * 0.3, t.z], s: [t.size * 1.04, 0.06, t.size * 1.04], c: "#7f8a7c" });
    }
    return { floors, floorKeys, trims, roofs, units, panels, glass };
  }, [towers, strays]);
  return (
    <group>
      <Instanced items={items.floors} geometry={g.box} material={m.facade} pick={pick.of(items.floorKeys)} />
      <Instanced items={items.trims} geometry={g.box} material={m.plain} />
      <Instanced items={items.roofs} geometry={g.box} material={m.plain} />
      <Instanced items={items.units} geometry={g.box} material={m.plain} />
      <Instanced items={items.panels} geometry={g.box} material={m.solar} />
      <Instanced items={items.glass} geometry={g.box} material={m.glass} shadow={false} />
      {towers.map((t) => (
        <Sign key={t.key} t={t} g={g} />
      ))}
    </group>
  );
}

/** The project's initials on the two visible faces of its tower, near the top. */
function Sign({ t, g }: { t: Tower; g: G }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: signTexture(initials(t.name)), roughness: 0.5 }), [t.name]);
  const s = t.size * 0.42;
  const y = FLOOR_BASE + t.height - s / 2 - 0.12;
  return (
    <group>
      <mesh geometry={g.plane} material={mat} position={[t.x - t.size * 0.15, y, t.z + t.size / 2 + 0.012]} scale={[s, s, 1]} raycast={noRaycast} />
      <mesh geometry={g.plane} material={mat} position={[t.x + t.size / 2 + 0.012, y, t.z + t.size * 0.15]} rotation={[0, Math.PI / 2, 0]} scale={[s, s, 1]} raycast={noRaycast} />
    </group>
  );
}
