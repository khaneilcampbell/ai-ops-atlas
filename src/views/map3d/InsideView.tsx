import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { wake } from "../../lib/power";
import CutawayWall from "../office/CutawayWall";
import { OFFICE_COLORS as C } from "../office/palette";
import { defaultFloor, floorOf, OFFICE_FURNITURE, type BuildingDefinition, type DeskDefinition } from "../../buildings/buildingDefinition";
import { needsPerson, SCREEN_COLOR, type DeskScreen } from "../../buildings/deskScreen";
import { openFloor, useInsideFloors } from "../../buildings/insideFloors";
import { passWidth, standingClearHeight } from "./agentBody";
import { cutCount, cutDepthMaterial, cutHeights, cutRects, CUT_MAX, setCutaway } from "./materials";
import { FLOOR_BASE, towerTop } from "./models";
import { keepsExterior, pickInside, sameTiers, stepCut, type InsideCandidate, type InsideLimits, type InsideTiers } from "./inside";
import type { Tower } from "./scene";

/** One desk as the Inside view needs it: where it stands (the building definition) and its screen. */
export interface InsideDesk {
  desk: DeskDefinition;
  state: DeskScreen;
  accent: string;
}
export interface InsideOffice {
  def: BuildingDefinition;
  desks: InsideDesk[];
}

/** Just above the plinth: where a building with no desk floor (or no definition) is cut. */
const CUT_Y = FLOOR_BASE + 0.03;
/** Where an open building's nameplate sits: just above its office walls, on its open floor. */
export const INSIDE_ROOF = CUT_Y + 0.45;
/** The open floor of a building in the Inside view: the one picked, or the highest with a desk. */
export function insideFloor(def: BuildingDefinition) {
  return floorOf(def, openFloor(def.id, defaultFloor(def))) ?? def.floors[0];
}
/** Nameplate height over an open building. */
export function insideRoof(def: BuildingDefinition | undefined) {
  return def ? insideFloor(def).surface + wallHeight(def) * def.k + 0.12 : INSIDE_ROOF;
}
/** The room's wall height in office units: the office's own 2.7, capped under the storey above. */
export function wallHeight(def: BuildingDefinition) {
  return Math.min(WALL_H, (0.92 * def.exterior.storeyH) / def.k);
}
/** The cut reaches a little past the tower's own walls, over the custom towers' podiums and trim. */
const CUT_REACH = 0.56;
/** Office wall height, office units (OfficeEnvironment). */
const WALL_H = 2.7;

type Part = { b: string; p: [number, number, number]; s: [number, number, number]; c?: string; f: number };
interface Parts {
  slab: Part[];
  outline: Part[];
  tiles: Part[];
  oak: Part[];
  steel: Part[];
  dark: Part[];
  screen: Part[];
  chair: Part[];
  torso: Part[];
  head: Part[];
  hair: Part[];
  lamp: Part[];
  marker: Part[];
}

/**
 * A desk as the office draws it (AgentWorkstation, AgentCharacter, AgentStatusIndicator in
 * OfficeScene), boiled down to the pieces that read at map scale, in office units around the
 * desk's center. No stand-in people: only named agents sit at desks, drawn by NamedAgents when
 * their day has them there, so an empty chair means nobody is working at it. The monitor shows the agent's real operational state (deskScreen.ts), or a neutral
 * screen: never progress Atlas can't see.
 */
function deskParts(d: InsideDesk, push: (list: keyof Parts, p: [number, number, number], s: [number, number, number], c?: string) => void) {
  const lit = d.state !== "neutral";
  push("oak", [0, 0.74, 0], [1.5, 0.05, 0.76]);
  push("steel", [-0.7, 0.36, 0], [0.05, 0.72, 0.7]);
  push("steel", [0.7, 0.36, 0], [0.05, 0.72, 0.7]);
  push("dark", [0, 1.18, -0.22], [0.84, 0.5, 0.04]);
  push("screen", [0, 1.18, -0.195], [0.78, 0.44, 0.01], SCREEN_COLOR[d.state]);
  push("chair", [0, OFFICE_FURNITURE.seatTop - 0.035, OFFICE_FURNITURE.seatZ], [0.5, 0.07, 0.48]);
  push("chair", [0, 0.8, 0.9], [0.48, 0.56, 0.07]);
  if (lit) push("lamp", [0.6, 0.9, -0.24], [0.22, 0.22, 0.22], SCREEN_COLOR[d.state]);
  // A marker over the desk when a person is needed, as inside.
  if (needsPerson(d.state)) push("marker", [0, 1.98, -0.22], [0.36, 0.36, 0.36], SCREEN_COLOR[d.state]);
}

/**
 * The open floor of every open building: its slab and outline on the storey's own plate, and the
 * desks on that floor only. Desks on other floors stay inside the closed part of the shell.
 */
function buildParts(towers: Map<string, Tower>, offices: Map<string, InsideOffice>, tiers: InsideTiers): Parts {
  const P: Parts = { slab: [], outline: [], tiles: [], oak: [], steel: [], dark: [], screen: [], chair: [], torso: [], head: [], hair: [], lamp: [], marker: [] };
  for (const key of [...tiers.near, ...tiers.mid]) {
    const t = towers.get(key);
    const o = t && offices.get(t.projectId);
    if (!t || !o) continue;
    const near = tiers.near.includes(key);
    const { def } = o;
    const k = def.k;
    const floor = insideFloor(def);
    const y = floor.surface;
    const { x0, x1, z0, z1 } = floor.plate;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    P.slab.push({ b: key, p: [cx, y - 0.03, cz], s: [w, 0.04, d], f: y });
    // The floor plan's outline: a low sill along each edge.
    const sill = 0.035;
    for (const sz of [-1, 1]) P.outline.push({ b: key, p: [cx, y, cz + (sz * d) / 2], s: [w, sill, 0.03], f: y });
    for (const sx of [-1, 1]) P.outline.push({ b: key, p: [cx + (sx * w) / 2, y, cz], s: [0.03, sill, d], f: y });
    for (const desk of o.desks) {
      if (desk.desk.floor !== floor.index) continue;
      const at = (lx: number, lz: number): [number, number] => [desk.desk.x + lx * k, desk.desk.z + lz * k];
      if (!near) {
        // Mid distance: one tile per desk, in its screen's colour.
        const [x, z] = at(0, 0.3);
        P.tiles.push({ b: key, p: [x, y + 0.006, z], s: [1.9 * k, 0.012, 1.9 * k], c: SCREEN_COLOR[desk.state], f: y });
        continue;
      }
      deskParts(desk, (list, p, s, c) => {
        const [x, z] = at(p[0], p[2]);
        P[list].push({ b: key, p: [x, y + p[1] * k, z], s: [s[0] * k, s[1] * k, s[2] * k], c, f: y });
      });
    }
  }
  return P;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
/** Floors, sills and tiles don't rise; only the furniture and the people do. */
const STILL = { current: new Map<string, number>() };
const BALL = new THREE.SphereGeometry(0.5, 12, 8);
const TORSO = new THREE.CapsuleGeometry(0.5, 0.6, 3, 8).scale(1, 0.62, 1);
const GEM = new THREE.OctahedronGeometry(0.5, 0);
const std = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
const MAT = {
  slab: std(C.floor, { roughness: 0.75 }),
  outline: std(C.trim, { roughness: 0.6 }),
  tile: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, toneMapped: false }),
  oak: std(C.oak, { roughness: 0.55 }),
  steel: std(C.steel, { roughness: 0.35, metalness: 0.6 }),
  dark: std(C.dark, { roughness: 0.45, metalness: 0.3 }),
  screen: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
  chair: std(C.chair, { roughness: 0.7 }),
  tinted: std("#ffffff", { roughness: 0.85 }),
  wall: std(C.wall),
  lamp: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
  // The office's own finishes (office/OfficeScene.tsx OfficeEnvironment), so the cutaway is the same room.
  rug: std(C.rug, { roughness: 1 }),
  trim: std(C.trim, { roughness: 0.6 }),
  frame: std("#3a4a3f", { roughness: 0.5, metalness: 0.2 }),
  pane: new THREE.MeshStandardMaterial({ color: "#cfe6f2", emissive: "#cfe6f2", emissiveIntensity: 0.02, transparent: true, opacity: 0.18, depthWrite: false, roughness: 0.1, metalness: 0.1 }),
  pot: std("#b8836a", { roughness: 0.9 }),
  leaf: std("#4f7f4a", { roughness: 0.9, flatShading: true }),
  leaf2: std("#6a9a52", { roughness: 0.9, flatShading: true }),
  led: new THREE.MeshBasicMaterial({ color: "#7ee0a0", toneMapped: false }),
};

/** Recompiles every building material, so it picks the cut up or drops it. */
function recompile(scene: THREE.Object3D) {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m?.userData.focusable) m.needsUpdate = true;
  });
}

/** Gives opaque building meshes the cut's shadow material, or takes it back. */
function castCutShadows(scene: THREE.Object3D, on: boolean) {
  const depth = cutDepthMaterial();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!on) {
      if (mesh.userData.cutDepth) {
        mesh.customDepthMaterial = undefined;
        delete mesh.userData.cutDepth;
      }
      return;
    }
    if (mesh.customDepthMaterial) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!mats.some((m) => m?.userData.focusable)) return;
    if (mats.some((m) => m.transparent || m.alphaTest > 0 || (m as THREE.MeshStandardMaterial).alphaMap)) return;
    mesh.customDepthMaterial = depth;
    mesh.userData.cutDepth = true;
  });
}

/**
 * Instanced parts for every open building at once (one draw call per part), each rising from its
 * floor as the building opens: `rise` per building, 0 to 1, read every frame while one is moving.
 */
function Rising({ items, geometry, material, rise, shadow = true }: { items: Part[]; geometry: THREE.BufferGeometry; material: THREE.Material; rise: React.MutableRefObject<Map<string, number>>; shadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const last = useRef<string>("");
  const o = useMemo(() => new THREE.Object3D(), []);
  const place = (force: boolean) => {
    const m = ref.current;
    if (!m) return;
    const sig = items.map((it) => rise.current.get(it.b) ?? 1).join();
    if (!force && sig === last.current) return;
    last.current = sig;
    items.forEach((it, i) => {
      const r = rise.current.get(it.b) ?? 1;
      o.position.set(it.p[0], it.f + (it.p[1] - it.f) * r, it.p[2]);
      o.scale.set(it.s[0], Math.max(1e-4, it.s[1] * r), it.s[2]);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  };
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const c = new THREE.Color();
    if (items.some((it) => it.c)) items.forEach((it, i) => m.setColorAt(i, c.set(it.c ?? "#ffffff")));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    place(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  useFrame(() => place(false));
  if (!items.length) return null;
  return <instancedMesh key={items.length} ref={ref} args={[geometry, material, items.length]} castShadow={shadow} receiveShadow matrixAutoUpdate={false} raycast={() => null} />;
}

/**
 * Inside view: opens the headquarters near the camera as cutaways (see inside.ts). The shells are
 * cut by the shared building materials (materials.ts), so the custom towers open the same way as
 * the standard ones, and their shadows go with them. Off, it draws nothing and the materials are
 * compiled without the cut.
 */
export function InsideView({ on, towers, offices, limits, reduced, night, selected, onOpen }: { on: boolean; towers: Tower[]; offices: Map<string, InsideOffice>; limits: InsideLimits; reduced: boolean; night: boolean; selected: string | null; onOpen?: (keys: string[]) => void }) {
  const { camera, scene, gl, invalidate } = useThree();
  const byKey = useMemo(() => new Map(towers.map((t) => [t.key, t])), [towers]);
  // Only buildings with an office plan open up; the rest keep their exterior (see keepsExterior).
  const cands = useMemo<InsideCandidate[]>(() => towers.filter((t) => offices.has(t.projectId) && !keepsExterior(t.projectId)).map((t) => ({ key: t.key, x: t.x, y: FLOOR_BASE, z: t.z })), [towers, offices]);
  // The floor picker and "Locate agent" choose which floor each building opens (insideFloors.ts).
  const floors = useInsideFloors();
  const lastOffices = useRef(offices);
  if (offices.size) lastOffices.current = offices;
  /** Height each building is cut at: its open floor's surface. */
  const cutAt = (t: Tower) => {
    const o = lastOffices.current.get(t.projectId);
    return o ? insideFloor(o.def).surface : CUT_Y;
  };
  const [tiers, setTiers] = useState<InsideTiers>({ near: [], mid: [] });
  // Every open (or closing) cut: its current and target height.
  const cuts = useRef(new Map<string, { cur: number; target: number; top: number }>());
  const rise = useRef(new Map<string, number>());
  const [compiled, setCompiled] = useState(false);

  // Compile the cut into the building materials while Inside is on, and give their meshes the
  // matching shadow material. Off waits for the shells to close before compiling it back out.
  const closing = !on && compiled;
  const [closed, setClosed] = useState(0);
  useEffect(() => {
    if (on === compiled) return;
    if (!on && cuts.current.size > 0) return;
    setCutaway(on);
    recompile(scene);
    castCutShadows(scene, on);
    if (!on) cutCount.value = 0;
    gl.shadowMap.needsUpdate = true;
    setCompiled(on);
    invalidate();
  }, [on, compiled, closed, scene, gl, invalidate]);
  // Meshes that mounted since (a tower that loaded later) cast their cut shadow too.
  useEffect(() => {
    if (compiled) castCutShadows(scene, true);
  }, [compiled, tiers, scene]);
  useEffect(
    () => () => {
      if (setCutaway(false)) recompile(scene);
      castCutShadows(scene, false);
      cutCount.value = 0;
    },
    [scene],
  );

  // Which buildings open, checked a few times a second while the view moves.
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const mat = useMemo(() => new THREE.Matrix4(), []);
  const sphere = useMemo(() => new THREE.Sphere(), []);
  const lastPick = useRef(0);
  useFrame((_, dt) => {
    const now = performance.now();
    if (on && compiled && now - lastPick.current > 180) {
      lastPick.current = now;
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const next = pickInside(cands, camera.position, (c) => frustum.intersectsSphere(sphere.set(new THREE.Vector3(c.x, c.y + 0.6, c.z), (byKey.get(c.key)?.size ?? 1) * 0.8)), limits, tiers, selected);
      if (!sameTiers(next, tiers)) setTiers(next);
    }
    // Ease every cut toward its target, and each office's rise toward open or closed.
    const open = on && compiled ? new Set([...tiers.near, ...tiers.mid]) : new Set<string>();
    for (const key of open) {
      const t = byKey.get(key);
      if (t && !cuts.current.has(key)) {
        const roof = towerTop(t) + 0.2;
        cuts.current.set(key, { cur: roof, target: cutAt(t), top: roof });
      }
    }
    let moving = false;
    for (const [key, c] of cuts.current) {
      const t = byKey.get(key);
      const floorAt = t ? cutAt(t) : CUT_Y;
      c.target = open.has(key) ? floorAt : c.top;
      const next = stepCut(c.cur, c.target, c.top - floorAt, dt, reduced);
      if (next !== c.cur) moving = true;
      c.cur = next;
      if (!open.has(key) && c.cur >= c.top) cuts.current.delete(key);
    }
    for (const key of new Set([...rise.current.keys(), ...tiers.near])) {
      const t = byKey.get(key);
      const target = t && open.has(key) && tiers.near.includes(key) && cuts.current.get(key)?.cur === cutAt(t) ? 1 : 0;
      const cur = rise.current.get(key) ?? 0;
      const next = stepCut(cur, target, 1, dt, reduced, 320);
      if (next !== cur) moving = true;
      if (next === 0 && target === 0) rise.current.delete(key);
      else rise.current.set(key, next);
    }
    // Hand the cuts to the shader, open ones first so a full list never drops a visible one.
    const list = [...cuts.current.entries()].sort((a, b) => Number(open.has(b[0])) - Number(open.has(a[0]))).slice(0, CUT_MAX);
    list.forEach(([key, c], i) => {
      const t = byKey.get(key)!;
      const r = t.size * CUT_REACH;
      cutRects.value[i].set(t.x - r, t.z - r, t.x + r, t.z + r);
      cutHeights.value[i] = c.cur;
    });
    cutCount.value = list.length;
    if (moving) {
      gl.shadowMap.needsUpdate = true;
      wake(120);
    }
    if (closing && !moving && cuts.current.size === 0 && closed === 0) setClosed(1);
    if (on && closed) setClosed(0);
  });

  // Nameplates sit on the open floor instead of the missing roof.
  const openKeys = on ? [...tiers.near, ...tiers.mid].sort().join() : "";
  const report = useRef(onOpen);
  report.current = onOpen;
  useEffect(() => report.current?.(openKeys ? openKeys.split(",") : []), [openKeys]);

  // Desks of the open buildings. Drawn while the building is open or still closing.
  const shown = useMemo<InsideTiers>(() => (on ? tiers : { near: [], mid: [] }), [on, tiers]);
  const [held, setHeld] = useState<InsideTiers>(shown);
  useEffect(() => {
    if (on) return setHeld(shown);
    // Keep the closing offices in place until their shells have closed over them.
    const id = window.setTimeout(() => setHeld({ near: [], mid: [] }), reduced ? 0 : 520);
    return () => window.clearTimeout(id);
  }, [on, shown, reduced]);
  const drawn = on ? shown : held;
  // The offices stop being computed the moment Inside is off; keep the last ones while closing.
  const last = useRef(offices);
  if (offices.size) last.current = offices;
  const plans = offices.size ? offices : last.current;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `floors` changes when a floor is picked
  const parts = useMemo(() => buildParts(byKey, plans, drawn), [byKey, plans, drawn, floors]);
  const walls = drawn.near.map((k) => byKey.get(k)).filter((t): t is Tower => !!t && plans.has(t.projectId));
  // After dark the office lights are on, as inside (OfficeEnvironment): the floor and walls glow warm.
  useEffect(() => {
    for (const m of [MAT.slab, MAT.wall, MAT.oak]) {
      m.emissive.set("#ffe1af");
      m.emissiveIntensity = night ? 0.32 : 0;
    }
  }, [night]);
  if (!drawn.near.length && !drawn.mid.length) return null;
  return (
    <group name="atlas-inside-view">
      <Rising items={parts.slab} geometry={BOX} material={MAT.slab} rise={STILL} />
      <Rising items={parts.outline} geometry={BOX} material={MAT.outline} rise={STILL} shadow={false} />
      <Rising items={parts.tiles} geometry={BOX} material={MAT.tile} rise={STILL} shadow={false} />
      <Rising items={parts.oak} geometry={BOX} material={MAT.oak} rise={rise} />
      <Rising items={parts.steel} geometry={BOX} material={MAT.steel} rise={rise} shadow={false} />
      <Rising items={parts.dark} geometry={BOX} material={MAT.dark} rise={rise} />
      <Rising items={parts.screen} geometry={BOX} material={MAT.screen} rise={rise} shadow={false} />
      <Rising items={parts.chair} geometry={BOX} material={MAT.chair} rise={rise} />
      <Rising items={parts.torso} geometry={TORSO} material={MAT.tinted} rise={rise} />
      <Rising items={parts.head} geometry={BALL} material={MAT.tinted} rise={rise} shadow={false} />
      <Rising items={parts.hair} geometry={BALL} material={MAT.tinted} rise={rise} shadow={false} />
      <Rising items={parts.lamp} geometry={BALL} material={MAT.lamp} rise={rise} shadow={false} />
      <Rising items={parts.marker} geometry={GEM} material={MAT.lamp} rise={rise} shadow={false} />
      {walls.map((t) => (
        <OfficeWalls key={t.key} t={t} office={plans.get(t.projectId)!} />
      ))}
    </group>
  );
}

const CYL = new THREE.CylinderGeometry(0.5, 0.42, 1, 10);
const LEAF = new THREE.IcosahedronGeometry(0.5, 0);
const Bx = ({ p, s: z, m }: { p: [number, number, number]; s: [number, number, number]; m: THREE.Material }) => <mesh geometry={BOX} material={m} position={p} scale={z} castShadow receiveShadow />;
function Plant({ p, s: k }: { p: [number, number, number]; s: number }) {
  return (
    <group position={p} scale={k}>
      <mesh geometry={CYL} material={MAT.pot} position={[0, 0.22, 0]} scale={[0.42, 0.44, 0.42]} castShadow />
      <mesh geometry={LEAF} material={MAT.leaf} position={[0, 0.72, 0]} scale={[0.62, 0.7, 0.62]} castShadow />
      <mesh geometry={LEAF} material={MAT.leaf2} position={[0.12, 1.02, 0.05]} scale={[0.4, 0.46, 0.4]} rotation={[0.4, 0.6, 0]} castShadow />
    </group>
  );
}

/**
 * The open floor's room, furnished like the office inside "Enter building" (OfficeEnvironment):
 * back and left walls with windows, trim, the building's colour strip and a wall display (dark: no
 * pretend figures), low sills on the street and right sides, a rug under the desks, a server rack
 * (decorative lights) and plants, and the lift's doors on the core. In office units, scaled by the
 * building definition's k onto its floor plate, the storey height capping the walls. Each full wall
 * steps aside while the camera looks in from its side (CutawayWall).
 */
function OfficeWalls({ t, office }: { t: Tower; office: InsideOffice }) {
  const { def } = office;
  const k = def.k;
  const floor = insideFloor(def);
  const { x0, x1, z0, z1 } = floor.plate;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const w = (x1 - x0) / k, d = (z1 - z0) / k;
  const H = wallHeight(def);
  const f = H / 2.7;
  const T = 0.16;
  const center = useMemo(() => ({ x: t.x, z: t.z }), [t.x, t.z]);
  const accent = useMemo(() => std(def.identity?.accent ?? C.trim, { roughness: 0.6 }), [def]);
  useEffect(() => () => accent.dispose(), [accent]);
  const winH = Math.max(0.3, 1.3 * f), winY = Math.max(winH / 2 + 0.25, 1.55 * f);
  const backWins = [-w * 0.3, w * 0.05];
  const leftWins = [-d / 4, d / 4];
  const lx = (def.core.x - cx) / k, lz = (def.core.z - cz) / k;
  const liftH = Math.min(H - 0.12, Math.max(1.9 * f, standingClearHeight / k)), liftW = Math.max(0.9, passWidth / k);
  const rugW = Math.max(1, w - 2), rugD = Math.max(1, d - 2);
  return (
    <group position={[cx, floor.surface, cz]} scale={k}>
      <Bx p={[0, 0.006, 0.2]} s={[rugW, 0.012, rugD]} m={MAT.rug} />
      <CutawayWall side="back" center={center}>
        <Bx p={[0, H / 2, -d / 2 - T / 2]} s={[w + T * 2, H, T]} m={MAT.wall} />
        {backWins.map((x) => (
          <group key={x} position={[x, winY, -d / 2 + 0.01]}>
            <Bx p={[0, 0, 0.02]} s={[1.18, winH, 0.02]} m={MAT.pane} />
            <Bx p={[0, 0, 0.04]} s={[0.04, winH, 0.02]} m={MAT.frame} />
          </group>
        ))}
        <Bx p={[0, H + 0.03, -d / 2 - T / 2]} s={[w + T * 2 + 0.04, 0.06, T + 0.04]} m={MAT.trim} />
        <Bx p={[0, 0.95 * f, -d / 2 + 0.01]} s={[w, 0.05, 0.02]} m={accent} />
        <Bx p={[w * 0.32, winY, -d / 2 + 0.04]} s={[Math.min(1.8, w * 0.25), winH, 0.06]} m={MAT.dark} />
      </CutawayWall>
      <CutawayWall side="left" center={center}>
        <Bx p={[-w / 2 - T / 2, H / 2, 0]} s={[T, H, d]} m={MAT.wall} />
        {leftWins.map((z) => (
          <group key={z} position={[-w / 2 + 0.01, winY, z]}>
            <Bx p={[0.02, 0, 0]} s={[0.02, winH, 1.38]} m={MAT.pane} />
            <Bx p={[0.04, 0, 0]} s={[0.02, winH, 0.04]} m={MAT.frame} />
          </group>
        ))}
        <Bx p={[-w / 2 - T / 2, H + 0.03, 0]} s={[T + 0.04, 0.06, d]} m={MAT.trim} />
        <Bx p={[-w / 2 + 0.01, 0.95 * f, 0]} s={[0.02, 0.05, d]} m={accent} />
      </CutawayWall>
      {/* The street and right sides are cut down to a sill with a trim cap, as inside. */}
      <Bx p={[0, 0.16, d / 2 + T / 2]} s={[w + T * 2, 0.32, T]} m={MAT.wall} />
      <Bx p={[w / 2 + T / 2, 0.16, 0]} s={[T, 0.32, d]} m={MAT.wall} />
      <Bx p={[0, 0.34, d / 2 + T / 2]} s={[w + T * 2 + 0.04, 0.04, T + 0.04]} m={MAT.trim} />
      <Bx p={[w / 2 + T / 2, 0.34, 0]} s={[T + 0.04, 0.04, d]} m={MAT.trim} />
      {/* The lift on the core: its doors in a dark frame, the building's colour above them. */}
      {/* Never smaller than an agent walking out of it (agentBody.ts), and always under the ceiling. */}
      <group position={[lx, 0, lz]}>
        <Bx p={[0, liftH / 2, 0]} s={[liftW, liftH, 0.03]} m={MAT.frame} />
        <Bx p={[0, liftH / 2, 0.02]} s={[0.03, liftH - 0.1 * f, 0.02]} m={MAT.dark} />
        <Bx p={[0, liftH + 0.05 * f, 0.01]} s={[liftW, 0.06, 0.03]} m={accent} />
      </group>
      {/* The server rack in the back corner (its lights are decoration, not telemetry) and plants. */}
      <group position={[-w / 2 + 0.45, 0, -d / 2 + 0.45]}>
        <Bx p={[0, 0.95 * f, 0]} s={[0.55, 1.9 * f, 0.55]} m={MAT.dark} />
        {[0.5, 0.8, 1.1, 1.4].map((y) => (
          <mesh key={y} geometry={BOX} material={MAT.led} position={[-0.18, y * f, 0.28]} scale={[0.03, 0.03, 0.01]} />
        ))}
      </group>
      <Plant p={[-w / 2 + 1.2, 0, -d / 2 + 0.4]} s={0.7} />
      <Plant p={[-w / 2 + 0.45, 0, d / 2 - 0.45]} s={0.8} />
      <Plant p={[w / 2 - 0.45, 0, d / 2 - 0.45]} s={0.8} />
    </group>
  );
}

export type { InsideLimits };
