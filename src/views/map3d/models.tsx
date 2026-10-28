import { useLayoutEffect, useMemo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Health } from "../../lib/derive";
import type { BuildingStyle } from "./identity";
import { hash } from "../mapLayout";
import { billboardTexture, facadeTexture, focusable, glowTexture, houseWallTexture, nameBoardTexture, patterned, signTexture, swaying, windowLights } from "./materials";
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
      dish: lifted(new THREE.CylinderGeometry(0.5, 0.14, 1, 14)),
      rock: new THREE.DodecahedronGeometry(1, 0),
      ball: new THREE.SphereGeometry(1, 10, 8),
      plane: new THREE.PlaneGeometry(1, 1),
    }),
    [],
  );
}

/** A textured material whose windows light up at night. */
function lit(map: THREE.Texture, opts: THREE.MeshStandardMaterialParameters, offset: number, spacing: number, share?: number) {
  return windowLights(new THREE.MeshStandardMaterial({ map, ...opts }), glowTexture(map), offset, spacing, share);
}

export function useMaterials() {
  return useMemo(() => {
    const cliff = patterned("#b39874", "cliff");
    const wall = patterned("#d6cbb2", "wall");
    const set = {
      land: [cliff, cliff, patterned("#7aae4f", "grass"), cliff, cliff, cliff],
      terrace: [wall, wall, patterned("#86b958", "grass"), wall, wall, wall],
      sand: patterned("#e4d3a3", "sand"),
      foam: new THREE.MeshStandardMaterial({ color: "#d9eee8", roughness: 1 }),
      surf: patterned("#e8f6f2", "foam", { roughness: 1, transparent: true, depthWrite: false }),
      water: patterned("#4e9fb7", "water", { roughness: 0.35, metalness: 0.05 }),
      brook: patterned("#5aaac0", "water", { roughness: 0.3 }),
      falls: patterned("#ffffff", "falls", { transparent: true, opacity: 0.92, roughness: 0.4, side: THREE.DoubleSide }),
      stone: patterned("#e6d6b4", "stone", {}, 0.07),
      step: patterned("#d9ceb4", "stone"),
      plain: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85 }),
      roof: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.75, flatShading: true }),
      houseWall: lit(houseWallTexture(), { roughness: 0.9 }, 0, 256, 0.5),
      // Window positions (offset and spacing in texture pixels) match facadeTexture's layouts.
      facades: {
        tech: lit(facadeTexture("tech", 3), { roughness: 0.35, metalness: 0.2 }, 8, 63),
        secure: lit(facadeTexture("secure", 5), { roughness: 0.6 }, 16, 70),
        timber: lit(facadeTexture("timber", 11), { roughness: 0.6 }, 16, 80),
        classic: lit(facadeTexture("classic", 9), { roughness: 0.65 }, 16, 82),
        glass: lit(facadeTexture("glass", 7), { roughness: 0.55 }, 8, 488 / 6),
      } satisfies Record<BuildingStyle, THREE.Material>,
      metal: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35, metalness: 0.65 }),
      glow: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
      darkGlass: new THREE.MeshStandardMaterial({ color: "#4d6878", roughness: 0.12, metalness: 0.45 }),
      lawn: patterned("#7fb356", "grass"),
      glass: new THREE.MeshStandardMaterial({ color: "#f3dc95", emissive: "#e9c46a", emissiveIntensity: 0.35, roughness: 0.3 }),
      solar: new THREE.MeshStandardMaterial({ color: "#2e4660", roughness: 0.25, metalness: 0.4 }),
      foliage: swaying(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95 })),
      lamp: new THREE.MeshStandardMaterial({ color: "#fbe7a6", emissive: "#f3cf73", emissiveIntensity: 0.8 }),
      // Ground glow under path lights; its opacity follows the night (see the lighting in Map3D).
      pool: new THREE.MeshBasicMaterial({ color: "#ffc874", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, visible: false }),
    };
    for (const v of Object.values(set)) (v instanceof THREE.Material ? [v] : Object.values(v)).forEach(focusable);
    return set;
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
      fountains: scene.fountains.flatMap(({ x, z, k = 1 }) => [
        { p: [x, top, z], s: [0.95 * k, 0.14, 0.95 * k], c: "#cfc4ab" } as Inst,
        { p: [x, top + 0.14, z], s: [0.08, 0.34 * k, 0.08], c: "#cfc4ab" } as Inst,
        { p: [x, top + 0.14 + 0.28 * k, z], s: [0.3 * k, 0.06, 0.3 * k], c: "#cfc4ab" } as Inst,
      ]),
      fountainWater: scene.fountains.map(({ x, z, k = 1 }) => ({ p: [x, top + 0.1, z], s: [0.8 * k, 0.06, 0.8 * k] }) as Inst),
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
      <Instanced items={items.foam} geometry={g.box} material={m.surf} shadow={false} />
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
    // Low path lights, and pools of light on the ground that fade in at night.
    const bollards: Inst[] = scene.bollards.map((b) => ({ p: [b.x, b.y, b.z], s: [0.035, 0.09, 0.035], c: "#3c4c40" }));
    const caps: Inst[] = scene.bollards.map((b) => ({ p: [b.x, b.y + 0.1, b.z], s: [0.026, 0.02, 0.026] }));
    const pools: Inst[] = scene.bollards.map((b) => ({ p: [b.x, b.y + 0.035, b.z], s: [0.42, 0.004, 0.42] }) as Inst);
    return { trunks, blobs, cones, bushes, flowers, rocks, bollards, caps, pools };
  }, [scene]);
  return (
    <group>
      <Instanced items={items.trunks} geometry={g.trunk} material={m.plain} />
      <Instanced items={items.blobs} geometry={g.blob} material={m.foliage} />
      <Instanced items={items.cones} geometry={g.cone} material={m.foliage} />
      <Instanced items={items.bushes} geometry={g.blob} material={m.foliage} />
      <Instanced items={items.flowers} geometry={g.ball} material={m.plain} shadow={false} />
      <Instanced items={items.rocks} geometry={g.rock} material={m.roof} />
      <Instanced items={items.bollards} geometry={g.cyl} material={m.plain} shadow={false} />
      <Instanced items={items.caps} geometry={g.ball} material={m.lamp} shadow={false} />
      <Instanced items={items.pools} geometry={g.cyl} material={m.pool} shadow={false} />
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
/** Rooftop name boards and billboards stand this high above the roof. */
const BOARD_LIFT = 0.42;

function hasBoard(t: Tower) {
  return t.identity.style === "timber" || t.identity.symbol === "github";
}

/** Boards stand toward the front corner of a landmark's roof, so its lantern shows behind them. */
const boardShift = (t: Tower) => (t.identity.landmark ? t.size * 0.2 : 0);

/** The landmark's glass lantern and spire above its roof. */
const LANTERN_H = 1.0;
const SPIRE_H = 1.1;

export function towerTop(t: Tower) {
  const crown = t.identity.landmark ? LANTERN_H + SPIRE_H : hasBoard(t) ? BOARD_LIFT + t.size * 0.5 : t.identity.style === "classic" ? t.size * 0.3 + 0.45 : t.identity.style === "secure" ? 1.4 : 0;
  return FLOOR_BASE + t.height + 0.12 + crown;
}

const STYLES: BuildingStyle[] = ["tech", "secure", "timber", "classic", "glass"];
const FLOWERS = ["#e8798f", "#f2c94c", "#f6f1e6", "#c58bd6"];

/** Everything a headquarters is made of, grouped by material so each group is one draw call. */
interface TowerParts {
  floors: Record<BuildingStyle, Inst[]>;
  floorKeys: Record<BuildingStyle, string[]>;
  plain: Inst[];
  metal: Inst[];
  glow: Inst[];
  glowBalls: Inst[];
  glass: Inst[];
  darkGlass: Inst[];
  panels: Inst[];
  steps: Inst[];
  lawn: Inst[];
  shrubs: Inst[];
  flowers: Inst[];
  posts: Inst[];
  hipRoofs: Inst[];
  spires: Inst[];
  dishes: Inst[];
}

function towerParts(towers: Tower[], strays: StrayBuilding[]): TowerParts {
  const P: TowerParts = {
    floors: { tech: [], secure: [], timber: [], classic: [], glass: [] },
    floorKeys: { tech: [], secure: [], timber: [], classic: [], glass: [] },
    plain: [],
    metal: [],
    glow: [],
    glowBalls: [],
    glass: [],
    darkGlass: [],
    panels: [],
    steps: [],
    lawn: [],
    shrubs: [],
    flowers: [],
    posts: [],
    hipRoofs: [],
    spires: [],
    dishes: [],
  };
  for (const t of towers) {
    const { style, accent } = t.identity;
    const s = t.size;
    const front = t.z + s / 2;
    const side = t.x + s / 2;
    const top = FLOOR_BASE + t.height;
    const r = (k: string) => hash(`${t.key}:${k}`);

    P.plain.push({ p: [t.x, TERRACE_H, t.z], s: [s * 1.14, 0.15, s * 1.14], c: style === "tech" ? "#5d666e" : "#8d8a80" });
    for (let i = 0; i < t.floors; i++) {
      P.floors[style].push({ p: [t.x, FLOOR_BASE + i * FLOOR_H, t.z], s: [s, FLOOR_H, s] });
      P.floorKeys[style].push(t.key);
    }
    // Architectural trim: slim corner pilasters that catch the light, and a ledge every few floors.
    if (style !== "timber") {
      const trim = style === "tech" ? "#7d8790" : style === "secure" ? "#c9ccd2" : style === "classic" ? "#efe7d5" : "#dfe2dc";
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) P.plain.push({ p: [t.x + (dx * s) / 2, FLOOR_BASE, t.z + (dz * s) / 2], s: [0.05, t.height, 0.05], c: trim });
      if (style !== "tech") for (let i = 3; i < t.floors - 1; i += 3) P.plain.push({ p: [t.x, FLOOR_BASE + i * FLOOR_H - 0.012, t.z], s: [s * 1.025, 0.024, s * 1.025], c: trim });
    }

    // Entrance: lit lobby on both visible faces, a canopy, stairs down to the plaza and
    // flowerbeds either side.
    P.glass.push({ p: [t.x, FLOOR_BASE, front + 0.005], s: [s * 0.38, 0.24, 0.02] });
    P.glass.push({ p: [side + 0.005, FLOOR_BASE, t.z], s: [0.02, 0.24, s * 0.3] });
    P.plain.push({ p: [t.x, FLOOR_BASE + 0.26, front + 0.08], s: [s * 0.5, 0.03, 0.18], c: style === "timber" ? "#8f6640" : style === "secure" ? "#2a3d66" : "#2f4535" });
    P.steps.push({ p: [t.x, TERRACE_H, front + 0.1], s: [s * 0.44, 0.1, 0.2] });
    P.steps.push({ p: [t.x, TERRACE_H, front + 0.22], s: [s * 0.44, 0.05, 0.1] });
    for (const sx of [-1, 1]) {
      const bx = t.x + sx * s * 0.36;
      P.plain.push({ p: [bx, TERRACE_H, front + 0.16], s: [s * 0.2, 0.07, 0.16], c: style === "timber" ? "#9a6e44" : "#cfc4ab" });
      P.lawn.push({ p: [bx, TERRACE_H + 0.07, front + 0.16], s: [s * 0.18, 0.012, 0.14] });
      for (let k = 0; k < 3; k++) {
        P.flowers.push({ p: [bx - s * 0.06 + k * s * 0.06, TERRACE_H + 0.1, front + 0.13 + (k % 2) * 0.05], s: [0.035, 0.035, 0.035], c: FLOWERS[(k + (sx > 0 ? 1 : 0) + Math.floor(r("f") * 4)) % 4] });
      }
    }

    if (style === "tech") {
      // Glowing bands near the top, circuit traces running down both faces, a glass penthouse.
      for (const y of [top - 0.06, top - FLOOR_H * 3 - 0.02]) P.glow.push({ p: [t.x, y, t.z], s: [s + 0.025, 0.035, s + 0.025], c: accent });
      for (let k = 0; k < 3; k++) {
        const len = t.height * (0.35 + r(`c${k}`) * 0.3);
        const off = -s * 0.32 + k * s * 0.13;
        const jog = (k % 2 ? 1 : -1) * s * 0.06;
        P.glow.push({ p: [t.x + off, top - len, front + 0.006], s: [0.016, len - 0.1, 0.01], c: accent });
        P.glow.push({ p: [t.x + off + jog / 2, top - len, front + 0.006], s: [Math.abs(jog) + 0.016, 0.016, 0.01], c: accent });
        P.glowBalls.push({ p: [t.x + off + jog, top - len + 0.01, front + 0.012], s: [0.022, 0.022, 0.01], c: accent });
        P.glow.push({ p: [side + 0.006, top - len * 0.8, t.z - off], s: [0.01, len * 0.8 - 0.1, 0.016], c: accent });
        P.glowBalls.push({ p: [side + 0.012, top - len * 0.8 + 0.01, t.z - off], s: [0.01, 0.022, 0.022], c: accent });
      }
      P.plain.push({ p: [t.x, top, t.z], s: [s * 1.04, 0.07, s * 1.04], c: "#4a535b" });
      P.darkGlass.push({ p: [t.x - s * 0.12, top + 0.07, t.z - s * 0.12], s: [s * 0.55, 0.28, s * 0.55] });
      P.plain.push({ p: [t.x - s * 0.12, top + 0.35, t.z - s * 0.12], s: [s * 0.6, 0.04, s * 0.6], c: "#3a4249" });
      P.plain.push({ p: [t.x + s * 0.3, top + 0.07, t.z - s * 0.3], s: [s * 0.18, 0.14, s * 0.18], c: "#aeb3ad" });
    } else if (style === "secure") {
      // A navy perimeter wall with gold-capped posts and an open gold gate at the front; hedges
      // inside; antenna, dish and a beacon on the roof.
      const e = s * 0.5 + 0.42;
      const gap = 0.34;
      const wall = (x0: number, z0: number, x1: number, z1: number) => {
        const w = Math.abs(x1 - x0) || 0.07;
        const d = Math.abs(z1 - z0) || 0.07;
        P.plain.push({ p: [(x0 + x1) / 2, TERRACE_H, (z0 + z1) / 2], s: [w, 0.17, d], c: "#2a3d66" });
      };
      for (const sg of [-1, 1]) {
        wall(t.x - e, t.z + sg * e, t.x - gap / 2, t.z + sg * e);
        wall(t.x + gap / 2, t.z + sg * e, t.x + e, t.z + sg * e);
        wall(t.x + sg * e, t.z - e, t.x + sg * e, t.z - gap / 2);
        wall(t.x + sg * e, t.z + gap / 2, t.x + sg * e, t.z + e);
      }
      const posts: [number, number][] = [[-e, -e], [e, -e], [-e, e], [e, e], [-gap / 2, e], [gap / 2, e], [e, -gap / 2], [e, gap / 2], [-gap / 2, -e], [gap / 2, -e], [-e, -gap / 2], [-e, gap / 2]];
      for (const [dx, dz] of posts) {
        P.plain.push({ p: [t.x + dx, TERRACE_H, t.z + dz], s: [0.1, 0.24, 0.1], c: "#22335a" });
        P.metal.push({ p: [t.x + dx, TERRACE_H + 0.28, t.z + dz], s: [0.04, 0.04, 0.04], c: "#d9b25f" });
      }
      // Gate leaves swung half open.
      P.metal.push({ p: [t.x - gap / 2 + 0.08, TERRACE_H, t.z + e + 0.06], s: [0.16, 0.2, 0.02], r: -0.7, c: "#cfa652" });
      P.metal.push({ p: [t.x + gap / 2 - 0.08, TERRACE_H, t.z + e + 0.06], s: [0.16, 0.2, 0.02], r: 0.7, c: "#cfa652" });
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        P.shrubs.push({ p: [t.x + dx * (e - 0.14), TERRACE_H + 0.09, t.z + dz * (e - 0.14)], s: [0.11, 0.1, 0.11], c: "#3f7a3a" });
      }
      P.plain.push({ p: [t.x, top, t.z], s: [s * 1.05, 0.08, s * 1.05], c: "#e3dccb" });
      P.plain.push({ p: [t.x, top - FLOOR_H * 2, t.z], s: [s * 1.03, 0.04, s * 1.03], c: "#d9b25f" });
      // Communications: an equipment room, a lattice mast with cross-arms, two dishes and a beacon.
      P.plain.push({ p: [t.x - s * 0.2, top + 0.08, t.z - s * 0.2], s: [s * 0.32, 0.2, s * 0.26], c: "#c9ccc6" });
      const mx = t.x + s * 0.24;
      const mz = t.z - s * 0.24;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) P.posts.push({ p: [mx + dx * 0.05, top + 0.08, mz + dz * 0.05], s: [0.025, 1.0, 0.025], c: "#9aa1a6" });
      for (const y of [0.35, 0.6, 0.85]) P.plain.push({ p: [mx, top + 0.08 + y, mz], s: [0.3 - y * 0.2, 0.02, 0.02], r: Math.PI / 4, c: "#b7bcbf" });
      P.posts.push({ p: [mx, top + 1.08, mz], s: [0.02, 0.35, 0.02], c: "#c7ccd0" });
      P.glowBalls.push({ p: [mx, top + 1.45, mz], s: [0.045, 0.045, 0.045], c: "#7fb0ff" });
      for (const [dx, dz, ry] of [[0.08, 0.14, Math.PI / 4], [-0.22, 0.2, Math.PI / 2.4]] as const) {
        P.posts.push({ p: [t.x + s * dx, top + 0.08, t.z + s * dz], s: [0.04, 0.14, 0.04], c: "#9aa1a6" });
        P.dishes.push({ p: [t.x + s * dx, top + 0.3, t.z + s * dz], s: [0.13, 0.05, 0.13], rx: -0.9, r: ry, c: "#eef0ec" });
      }
    } else if (style === "timber") {
      // Timber corner posts, a planted green roof and a raised name board on posts.
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        P.plain.push({ p: [t.x + dx * s * 0.5, FLOOR_BASE, t.z + dz * s * 0.5], s: [0.07, t.height + 0.08, 0.07], c: "#8f6640" });
      }
      P.plain.push({ p: [t.x, top, t.z], s: [s * 1.06, 0.07, s * 1.06], c: "#9a6e44" });
      P.lawn.push({ p: [t.x, top + 0.07, t.z], s: [s * 0.98, 0.05, s * 0.98] });
      for (let k = 0; k < 7; k++) {
        const a = r(`b${k}`) * Math.PI * 2;
        const d = s * (0.18 + r(`d${k}`) * 0.24);
        P.shrubs.push({ p: [t.x + Math.cos(a) * d, top + 0.15, t.z + Math.sin(a) * d], s: [0.09, 0.07, 0.09], c: k % 3 ? "#4f8a3c" : "#6aa04a" });
      }
      if (t.identity.landmark) {
        // The centerpiece: a lit glass lantern at the back of the roof garden, timber-framed,
        // with a gold ring and spire.
        const lx = t.x - s * 0.2;
        const lz = t.z - s * 0.2;
        const lw = s * 0.42;
        const y0 = top + 0.12;
        P.glass.push({ p: [lx, y0, lz], s: [lw, LANTERN_H, lw] });
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          P.plain.push({ p: [lx + (dx * lw) / 2, y0, lz + (dz * lw) / 2], s: [0.06, LANTERN_H, 0.06], c: "#8f6640" });
        }
        for (const y of [y0 + LANTERN_H * 0.33, y0 + LANTERN_H * 0.66]) P.plain.push({ p: [lx, y, lz], s: [lw + 0.03, 0.035, lw + 0.03], c: "#8f6640" });
        P.plain.push({ p: [lx, y0 + LANTERN_H, lz], s: [lw + 0.12, 0.07, lw + 0.12], c: "#9a6e44" });
        P.metal.push({ p: [lx, y0 + LANTERN_H + 0.07, lz], s: [lw * 0.7, 0.04, lw * 0.7], c: "#d9b25f" });
        P.spires.push({ p: [lx, y0 + LANTERN_H + 0.11, lz], s: [lw * 0.45, SPIRE_H - 0.15, lw * 0.45], c: "#d9b25f" });
        P.glowBalls.push({ p: [lx, y0 + LANTERN_H + SPIRE_H - 0.02, lz], s: [0.05, 0.05, 0.05], c: "#ffe6a8" });
        // Gold bands mark the floors, timber pilasters run up the faces.
        for (const y of [FLOOR_BASE + FLOOR_H * 3, FLOOR_BASE + FLOOR_H * 9]) P.metal.push({ p: [t.x, y, t.z], s: [s * 1.03, 0.04, s * 1.03], c: "#cfa652" });
        for (const k of [-1, 1]) {
          P.plain.push({ p: [t.x + k * s * 0.17, FLOOR_BASE, t.z + s / 2 + 0.01], s: [0.05, t.height, 0.03], c: "#7a5534" });
          P.plain.push({ p: [t.x + s / 2 + 0.01, FLOOR_BASE, t.z + k * s * 0.17], s: [0.03, t.height, 0.05], c: "#7a5534" });
        }
      }
      // Screen kiosks by the entrance.
      for (const sx of [-1, 1]) {
        const kx = t.x + sx * s * 0.62;
        P.posts.push({ p: [kx, TERRACE_H, front + 0.3], s: [0.025, 0.14, 0.025], c: "#5a4630" });
        P.glow.push({ p: [kx, TERRACE_H + 0.14, front + 0.3], s: [0.14, 0.09, 0.015], r: sx * 0.35, c: "#9fe3d6" });
      }
    } else if (style === "classic") {
      // Gold cornices, entrance columns and a copper hip roof.
      for (const y of [top - 0.02, FLOOR_BASE + FLOOR_H * 2]) P.metal.push({ p: [t.x, y, t.z], s: [s * 1.05, 0.05, s * 1.05], c: "#cfa652" });
      for (let k = 0; k < 4; k++) P.posts.push({ p: [t.x - s * 0.21 + k * s * 0.14, TERRACE_H + 0.1, front + 0.16], s: [0.05, 0.42, 0.05], c: "#efe7d5" });
      P.plain.push({ p: [t.x, TERRACE_H + 0.52, front + 0.14], s: [s * 0.52, 0.06, 0.2], c: "#e6dcc4" });
      P.plain.push({ p: [t.x, top + 0.03, t.z], s: [s * 1.04, 0.06, s * 1.04], c: "#e3dccb" });
      // Each house of the brand gets its own roof: copper for the site, slate for operations,
      // terracotta for strategy, crowned with a gold finial.
      const roof = t.identity.symbol === "chart" ? "#5d7190" : t.identity.symbol === "compass" ? "#b06f4f" : "#6f9a86";
      P.hipRoofs.push({ p: [t.x, top + 0.09, t.z], s: [s * 0.98, s * 0.32, s * 0.98], c: roof });
      P.spires.push({ p: [t.x, top + 0.09 + s * 0.3, t.z], s: [0.07, 0.32, 0.07], c: "#d9b25f" });
      P.glowBalls.push({ p: [t.x, top + 0.09 + s * 0.3 + 0.33, t.z], s: [0.035, 0.035, 0.035], c: "#ffe6a8" });
      // Lanterns either side of the portico.
      for (const sx of [-1, 1]) {
        P.posts.push({ p: [t.x + sx * s * 0.55, TERRACE_H, front + 0.32], s: [0.03, 0.4, 0.03], c: "#2f3a33" });
        P.glowBalls.push({ p: [t.x + sx * s * 0.55, TERRACE_H + 0.44, front + 0.32], s: [0.04, 0.05, 0.04], c: "#ffe2a0" });
      }
    } else {
      P.plain.push({ p: [t.x, top, t.z], s: [s * 1.05, 0.08, s * 1.05], c: "#e3e5df" });
      P.plain.push({ p: [t.x, top + 0.08, t.z], s: [s * 0.96, 0.04, s * 0.96], c: "#3f474d" });
      P.plain.push({ p: [t.x - s * 0.22, top + 0.12, t.z - s * 0.2], s: [s * 0.3, 0.16, s * 0.24], c: "#c9ccc6" });
      P.plain.push({ p: [t.x + s * 0.25, top + 0.12, t.z - s * 0.25], s: [s * 0.16, 0.22, s * 0.16], c: "#aeb3ad" });
      for (let k = 0; k < 3; k++) P.panels.push({ p: [t.x - s * 0.25 + k * s * 0.22, top + 0.16, t.z + s * 0.22], s: [s * 0.18, 0.02, s * 0.28], rx: -0.35 });
      P.glow.push({ p: [t.x, top - 0.05, t.z], s: [s + 0.02, 0.03, s + 0.02], c: accent });
    }

    // Rooftop boards stand on two posts, turned to face the camera.
    if (hasBoard(t)) {
      const w = s * 1.15;
      const roof = top + (style === "timber" ? 0.12 : 0.07);
      for (const k of [-1, 1]) {
        const off = k * w * 0.33;
        const c = boardShift(t);
        P.posts.push({ p: [t.x + c + off * Math.SQRT1_2, roof, t.z + c - off * Math.SQRT1_2], s: [0.045, BOARD_LIFT + 0.05, 0.045], c: style === "timber" ? "#8f6640" : "#3a4249" });
      }
    }
  }
  for (const t of strays) {
    const n = Math.max(2, Math.round(t.height / 0.3));
    for (let i = 0; i < n; i++) {
      P.floors.glass.push({ p: [t.x, i * 0.3, t.z], s: [t.size, 0.3, t.size] });
      P.floorKeys.glass.push(t.key);
    }
    P.plain.push({ p: [t.x, n * 0.3, t.z], s: [t.size * 1.04, 0.06, t.size * 1.04], c: "#7f8a7c" });
  }
  return P;
}

/** Restrained accents for verified health; unknown health gets none. */
const HEALTH_ACCENT: Partial<Record<Health, string>> = { good: "#6fbf7f", warn: "#d9a84a", bad: "#c8584b" };

export function Towers({ towers, strays, health, g, m, pick }: { towers: Tower[]; strays: StrayBuilding[]; health: Map<string, Health>; g: G; m: M; pick: PickHandlerSet }) {
  const P = useMemo(() => towerParts(towers, strays), [towers, strays]);
  // A thin lit band around each plinth carries the repository's verified health, apart from the
  // decorative lighting above it.
  const status = useMemo(
    () =>
      towers.flatMap((t) => {
        const c = HEALTH_ACCENT[health.get(t.key) ?? "unknown"];
        return c ? [{ p: [t.x, TERRACE_H + 0.15, t.z], s: [t.size * 1.16, 0.022, t.size * 1.16], c } as Inst] : [];
      }),
    [towers, health],
  );
  return (
    <group>
      {STYLES.map((st) => (
        <Instanced key={st} items={P.floors[st]} geometry={g.box} material={m.facades[st]} pick={pick.of(P.floorKeys[st])} />
      ))}
      <Instanced items={P.plain} geometry={g.box} material={m.plain} />
      <Instanced items={P.metal} geometry={g.box} material={m.metal} />
      <Instanced items={P.posts} geometry={g.cyl} material={m.plain} />
      <Instanced items={P.steps} geometry={g.box} material={m.step} />
      <Instanced items={P.lawn} geometry={g.box} material={m.lawn} />
      <Instanced items={P.panels} geometry={g.box} material={m.solar} />
      <Instanced items={P.glass} geometry={g.box} material={m.glass} shadow={false} />
      <Instanced items={P.darkGlass} geometry={g.box} material={m.darkGlass} />
      <Instanced items={P.glow} geometry={g.box} material={m.glow} shadow={false} />
      <Instanced items={P.glowBalls} geometry={g.ball} material={m.glow} shadow={false} />
      <Instanced items={status} geometry={g.box} material={m.glow} shadow={false} />
      <Instanced items={P.shrubs} geometry={g.blob} material={m.foliage} />
      <Instanced items={P.flowers} geometry={g.ball} material={m.foliage} shadow={false} />
      <Instanced items={P.hipRoofs} geometry={g.hip} material={m.roof} />
      <Instanced items={P.spires} geometry={g.cone} material={m.metal} />
      <Instanced items={P.dishes} geometry={g.dish} material={m.plain} />
      {towers.map((t) => (
        <BuildingIdentitySigns key={t.key} t={t} g={g} />
      ))}
    </group>
  );
}

const signMaterial = (map: THREE.Texture, opts: THREE.MeshStandardMaterialParameters = {}) =>
  focusable(new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: "#ffffff", emissiveIntensity: 0.55, roughness: 0.45, ...opts }));

/**
 * A headquarters' identity: its symbol on raised, lit signs on the two faces the camera sees,
 * and, for some styles, a board on the roof.
 */
function BuildingIdentitySigns({ t, g }: { t: Tower; g: G }) {
  const { identity: id } = t;
  const mats = useMemo(() => {
    const sign = signMaterial(signTexture(id, t.name), id.style === "secure" ? { transparent: true, alphaTest: 0.4 } : {});
    const frame = focusable(new THREE.MeshStandardMaterial({ color: id.accent, roughness: 0.5, metalness: 0.2 }));
    const [owner] = t.repository.split("/");
    const board =
      id.style === "timber"
        ? signMaterial(nameBoardTexture(id, t.name), { emissiveIntensity: 0.25 })
        : id.symbol === "github"
          ? signMaterial(billboardTexture(t.name, owner, id.accent), { emissiveIntensity: 0.7 })
          : null;
    return { sign, frame, board };
  }, [id, t.name, t.repository]);

  const s = t.size;
  const top = FLOOR_BASE + t.height;
  const secure = id.style === "secure";
  // Security headquarters carry one large shield over the entrance, like a crest.
  const big = secure ? s * 0.62 : s * 0.46;
  const small = s * 0.4;
  const yFront = secure ? FLOOR_BASE + Math.min(t.height * 0.55, 1.4) : top - big / 2 - 0.16;
  const ySide = top - small / 2 - 0.16;
  const d = 0.05;
  const face = (x: number, y: number, z: number, size: number, rot: number, framed: boolean) => (
    <group position={[x, y, z]} rotation={[0, rot, 0]}>
      {framed && <mesh geometry={g.box} material={mats.frame} position={[0, -size * 0.54, -d / 2]} scale={[size * 1.08, size * 1.08, d]} raycast={noRaycast} castShadow />}
      <mesh geometry={g.plane} material={mats.sign} position={[0, 0, 0.003]} scale={[size, size, 1]} raycast={noRaycast} />
    </group>
  );
  const boardW = s * 1.15;
  const boardH = id.style === "timber" ? boardW * 0.25 : boardW * 0.5;
  const boardY = top + (id.style === "timber" ? 0.12 : 0.07) + BOARD_LIFT + boardH / 2;
  return (
    <group>
      {face(t.x - (secure ? 0 : s * 0.14), yFront, t.z + s / 2 + d, big, 0, !secure)}
      {face(t.x + s / 2 + d, ySide, t.z + s * 0.14, small, Math.PI / 2, !secure)}
      {mats.board && (
        <group position={[t.x + boardShift(t), boardY, t.z + boardShift(t)]} rotation={[0, Math.PI / 4, 0]}>
          <mesh geometry={g.box} material={id.style === "timber" ? woodMaterial : darkMaterial} position={[0, -boardH / 2 - 0.02, -0.03]} scale={[boardW + 0.06, boardH + 0.04, 0.05]} raycast={noRaycast} castShadow />
          <mesh geometry={g.plane} material={mats.board} position={[0, 0, 0.0]} scale={[boardW, boardH, 1]} raycast={noRaycast} />
        </group>
      )}
    </group>
  );
}

const woodMaterial = focusable(new THREE.MeshStandardMaterial({ color: "#8f6640", roughness: 0.8 }));
const darkMaterial = focusable(new THREE.MeshStandardMaterial({ color: "#2a3138", roughness: 0.6 }));
