import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { wake } from "../../lib/power";
import { hash } from "../mapLayout";
import CutawayWall from "../office/CutawayWall";
import type { OfficePlan, RuntimeState, Workstation } from "../office/model";
import { OFFICE_COLORS as C } from "../office/palette";
import { STATE_COLOR } from "../office/textures";
import { cutCount, cutDepthMaterial, cutHeights, cutRects, CUT_MAX, setCutaway } from "./materials";
import { FLOOR_BASE, towerTop } from "./models";
import { pickInside, sameTiers, stepCut, type InsideCandidate, type InsideLimits, type InsideTiers } from "./inside";
import { CORE, levelY, type BuildingModel } from "./buildingModel";
import { useInsideFocus } from "./insideFocus";
import { agentInside } from "./agentFollow";
import { useOpsStates } from "../../routine/useRoutineOps";
import type { OperationalState } from "../../routine/operations";
import type { Tower } from "./scene";

/** One desk as the Inside view needs it: where it stands, and its state from verified data. */
export interface InsideDesk {
  ws: Workstation;
  state: RuntimeState;
  accent: string;
}
export interface InsideOffice {
  plan: OfficePlan;
  desks: InsideDesk[];
}

/** The ground floor's cut, just above the plinth, so the health band around it stays in view. */
const CUT_Y = FLOOR_BASE + 0.03;
/** Where an open building's nameplate sits: just above the open floor's office walls. */
export const insideRoof = (level: number) => levelY(level) + 0.45;
/** A monitor with nothing real to show: neutral, never a pretend progress colour. */
const NEUTRAL_SCREEN = "#4f5a63";
/** A named agent's desk takes its state from the same runs as its card (routine/operations.ts). */
function deskState(op: OperationalState | undefined): RuntimeState {
  if (op === "running" || op === "queued") return "working";
  if (op === "waiting_approval") return "awaiting";
  if (op === "failed") return "failed";
  return op ? "idle" : "unknown";
}
/** The cut reaches a little past the tower's own walls, over the custom towers' podiums and trim. */
const CUT_REACH = 0.56;

/** One box or ball: its building, place, size, colour, and the floor it rises from. */
type Part = { b: string; p: [number, number, number]; s: [number, number, number]; c?: string; f?: number };
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
  core: Part[];
}

/**
 * A desk as the office draws it (AgentWorkstation, AgentCharacter, AgentStatusIndicator in
 * OfficeScene), boiled down to the pieces that read at map scale, in office units around the
 * desk's center. The status lamp is drawn larger here so it can be read from the street.
 */
function deskParts(d: InsideDesk, push: (list: keyof Parts, p: [number, number, number], s: [number, number, number], c?: string) => void) {
  const off = d.state === "offline";
  const h = hash(d.ws.agentId);
  push("oak", [0, 0.74, 0], [1.5, 0.05, 0.76]);
  push("steel", [-0.7, 0.36, 0], [0.05, 0.72, 0.7]);
  push("steel", [0.7, 0.36, 0], [0.05, 0.72, 0.7]);
  push("dark", [0, 1.18, -0.22], [0.84, 0.5, 0.04]);
  // The monitor shows a real state only (running, waiting for approval, failed); otherwise a neutral screen.
  const real = d.state === "working" || d.state === "awaiting" || d.state === "failed";
  push("screen", [0, 1.18, -0.195], [0.78, 0.44, 0.01], real ? STATE_COLOR[d.state] : NEUTRAL_SCREEN);
  push("chair", [0, 0.46, 0.66], [0.5, 0.07, 0.48]);
  push("chair", [0, 0.8, 0.9], [0.48, 0.56, 0.07]);
  push("torso", [0, 0.86, 0.66], [0.36, 0.62, 0.32], off ? C.inactive : d.accent);
  push("head", [0, 1.25, 0.64], [0.27, 0.27, 0.27], C.skin[Math.floor(h * 4) % 4]);
  // Seated with arms and legs, like the agents at their desks in the building interiors: thighs on the seat, shins to
  // the floor, upper arms down from the shoulders and forearms resting on the desk.
  const shirt = off ? C.inactive : d.accent;
  for (const side of [-1, 1]) {
    push("torso", [side * 0.09, 0.58, 0.48], [0.13, 0.1, 0.38], "#2f3a44");
    push("torso", [side * 0.09, 0.28, 0.32], [0.11, 0.56, 0.11], "#2f3a44");
    push("torso", [side * 0.22, 0.98, 0.62], [0.09, 0.3, 0.09], shirt);
    push("torso", [side * 0.19, 0.83, 0.38], [0.09, 0.08, 0.42], shirt);
  }
  push("hair", [0, 1.3, 0.67], [0.285, 0.24, 0.285], C.hair[Math.floor(h * 17) % 4]);
  push("lamp", [0.6, 0.9, -0.24], [0.22, 0.22, 0.22], STATE_COLOR[d.state]);
  // A marker over the desk when a person is needed, as inside.
  if (d.state === "awaiting" || d.state === "failed") push("marker", [0, 1.98, -0.22], [0.36, 0.36, 0.36], STATE_COLOR[d.state]);
}

/** The seated person's parts at a desk: left out where a named agent's own character sits (NamedAgents). */
const PERSON: ReadonlySet<keyof Parts> = new Set(["torso", "head", "hair"]);

function buildParts(models: ReadonlyMap<string, BuildingModel>, offices: Map<string, InsideOffice>, tiers: InsideTiers, levels: ReadonlyMap<string, number>, managed: ReadonlySet<string>, ops: ReadonlyMap<string, OperationalState>): Parts {
  const P: Parts = { slab: [], outline: [], tiles: [], oak: [], steel: [], dark: [], screen: [], chair: [], torso: [], head: [], hair: [], lamp: [], marker: [], core: [] };
  for (const key of [...tiers.near, ...tiers.mid]) {
    const m = models.get(key);
    if (!m) continue;
    const o = offices.get(m.projectId);
    const near = tiers.near.includes(key);
    const level = levels.get(key) ?? m.officeFloors[0].level;
    const y = levelY(level);
    const floor = m.officeFloors.find((f) => f.level === level);
    const k = m.k;
    const w = m.plate;
    P.slab.push({ b: key, p: [m.x, y - 0.03, m.z], s: [w, 0.04, w], f: y });
    // The floor plate's outline: a low sill along each edge.
    const sill = 0.035;
    for (const sz of [-1, 1]) P.outline.push({ b: key, p: [m.x, y, m.z + (sz * w) / 2], s: [w, sill, 0.03], f: y });
    for (const sx of [-1, 1]) P.outline.push({ b: key, p: [m.x + (sx * w) / 2, y, m.z], s: [0.03, sill, w], f: y });
    // The lift core in the back corner, the same on every floor: the way up from the lobby.
    P.core.push({ b: key, p: [m.core.x, y + 0.2 * m.floorH, m.core.z], s: [CORE * k, 0.4 * m.floorH, CORE * k], f: y });
    for (const ws of floor?.workstations ?? []) {
      const own = managed.has(ws.agentId);
      const state = own ? deskState(ops.get(ws.agentId)) : (o?.desks.find((d) => d.ws.agentId === ws.agentId)?.state ?? "unknown");
      const desk: InsideDesk = { ws, state, accent: o?.desks.find((d) => d.ws.agentId === ws.agentId)?.accent ?? m.accent };
      const cos = Math.cos(ws.ry);
      const sin = Math.sin(ws.ry);
      const at = (lx: number, lz: number): [number, number] => [m.x + (ws.x + lx * cos + lz * sin) * k, m.z + (ws.z - lx * sin + lz * cos) * k];
      if (!near) {
        // Mid distance: one tile per desk, in its verified state's color.
        const [x, z] = at(0, 0.3);
        P.tiles.push({ b: key, p: [x, y + 0.006, z], s: [1.9 * k, 0.012, 1.9 * k], c: STATE_COLOR[state], f: y });
        continue;
      }
      deskParts(desk, (list, p, sz, c) => {
        // A named agent's desk: its own character comes and goes (routine), so the chair is empty when it's away.
        if (own && PERSON.has(list)) return;
        const [x, z] = at(p[0], p[2]);
        P[list].push({ b: key, p: [x, y + p[1] * k, z], s: [sz[0] * k, sz[1] * k, sz[2] * k], c, f: y });
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
  accent: std("#ffffff", { roughness: 0.6 }),
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
function Rising({ items, geometry, material, rise, floorY, shadow = true }: { items: Part[]; geometry: THREE.BufferGeometry; material: THREE.Material; rise: React.MutableRefObject<Map<string, number>>; floorY: number; shadow?: boolean }) {
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
      const fy = it.f ?? floorY;
      o.position.set(it.p[0], fy + (it.p[1] - fy) * r, it.p[2]);
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

const NO_MODELS: ReadonlyMap<string, BuildingModel> = new Map();
const NO_MANAGED: ReadonlySet<string> = new Set();

/**
 * Inside view: opens headquarters as cutaways at one floor, so the agents working there show at
 * their desks (see inside.ts). The toolbar's Inside switch opens the buildings near the camera at
 * their lowest office floor; "View inside" (insideFocus.ts) opens one building on purpose at the
 * floor asked for, whatever the switch says. Everything drawn comes from the building model
 * (buildingModel.ts), the same one the agents walk through. The shells are cut by the shared
 * building materials (materials.ts) just above the open floor, so the floors below keep their
 * walls and the ones above step aside. Closed, it draws nothing and the materials are compiled
 * without the cut.
 */
export function InsideView({ on: toolbar, models = NO_MODELS, towers, offices, limits, reduced, night, selected, onOpen, managed = NO_MANAGED }: { on: boolean; models?: ReadonlyMap<string, BuildingModel>; towers: Tower[]; offices: Map<string, InsideOffice>; limits: InsideLimits; reduced: boolean; night: boolean; selected: string | null; onOpen?: (open: ReadonlyMap<string, number>) => void; managed?: ReadonlySet<string> }) {
  const { camera, scene, gl, invalidate } = useThree();
  const byKey = useMemo(() => new Map(towers.map((t) => [t.key, t])), [towers]);
  const focusRaw = useInsideFocus();
  const focus = focusRaw && models.has(focusRaw.key) ? focusRaw : null;
  const on = toolbar || !!focus;
  const ops = useOpsStates();
  // Only buildings with a building model (an office) open up; the rest keep their exterior.
  const cands = useMemo<InsideCandidate[]>(() => towers.filter((t) => models.has(t.key)).map((t) => ({ key: t.key, x: t.x, y: FLOOR_BASE, z: t.z })), [towers, models]);
  const [tiers, setTiers] = useState<InsideTiers>({ near: [], mid: [] });
  // Where agents are seated right now: building and the lowest floor with someone at a desk.
  // The toolbar switch opens these first, at that floor ("see the agents working in Atlas buildings").
  const [working, setWorking] = useState<ReadonlyMap<string, number>>(new Map());
  // The floor each open building shows: the one asked for, else where its agents are working, else its lowest office floor.
  const levels = useMemo(() => {
    const out = new Map<string, number>();
    for (const [key, m] of models) out.set(key, focus?.key === key && focus.level !== null ? focus.level : (working.get(key) ?? m.officeFloors[0].level));
    return out;
  }, [models, focus, working]);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
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

  // Which buildings open, checked a few times a second while the view moves. The focused building
  // always opens in full; with the switch off it is the only one.
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const mat = useMemo(() => new THREE.Matrix4(), []);
  const sphere = useMemo(() => new THREE.Sphere(), []);
  const lastPick = useRef(0);
  useEffect(() => {
    if (!toolbar) setTiers(focus ? { near: [focus.key], mid: [] } : { near: [], mid: [] });
  }, [toolbar, focus]);
  useFrame((_, dt) => {
    const now = performance.now();
    if (toolbar && compiled && now - lastPick.current > 180) {
      lastPick.current = now;
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const seen = (c: InsideCandidate) => frustum.intersectsSphere(sphere.set(new THREE.Vector3(c.x, c.y + 0.6, c.z), (byKey.get(c.key)?.size ?? 1) * 0.8));
      const at = new Map<string, number>();
      for (const v of agentInside.values()) if (v?.seated && v.level !== null && models.has(v.key)) at.set(v.key, Math.min(at.get(v.key) ?? Infinity, v.level));
      if ([...at].join() !== [...working].join()) setWorking(at);
      // Buildings with agents at work open first, at any distance in view; the nearest others fill the rest.
      const busy = cands.filter((c) => at.has(c.key) && seen(c)).sort((a, b) => Math.hypot(a.x - camera.position.x, a.z - camera.position.z) - Math.hypot(b.x - camera.position.x, b.z - camera.position.z)).map((c) => c.key);
      const next = pickInside(cands.filter((c) => !busy.includes(c.key)), camera.position, seen, { ...limits, near: Math.max(0, limits.near - busy.length) }, tiers, focus?.key ?? selected);
      next.near = [...busy.slice(0, limits.near), ...next.near].slice(0, limits.near);
      next.mid = [...busy.slice(limits.near), ...next.mid].slice(0, limits.mid);
      if (focus && !next.near.includes(focus.key)) {
        next.near = [focus.key, ...next.near].slice(0, Math.max(1, limits.near));
        next.mid = next.mid.filter((k) => k !== focus.key);
      }
      if (!sameTiers(next, tiers)) setTiers(next);
    }
    // Ease every cut toward its target, and each office's rise toward open or closed.
    const open = on && compiled ? new Set([...tiers.near, ...tiers.mid]) : new Set<string>();
    for (const key of open) {
      const t = byKey.get(key);
      if (t && !cuts.current.has(key)) {
        const roof = towerTop(t) + 0.2;
        cuts.current.set(key, { cur: roof, target: CUT_Y, top: roof });
      }
    }
    let moving = false;
    for (const [key, c] of cuts.current) {
      c.target = open.has(key) ? levelY(levelsRef.current.get(key) ?? 0) : c.top;
      const next = stepCut(c.cur, c.target, c.top - CUT_Y, dt, reduced);
      if (next !== c.cur) moving = true;
      c.cur = next;
      if (!open.has(key) && c.cur >= c.top) cuts.current.delete(key);
    }
    for (const key of new Set([...rise.current.keys(), ...tiers.near])) {
      const c = cuts.current.get(key);
      const target = open.has(key) && tiers.near.includes(key) && c && c.cur === c.target ? 1 : 0;
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

  // Report which buildings are open and at which floor: nameplates sit on the open floor, and the
  // agents there are drawn (routinePose.ts).
  const openKeys = on ? [...tiers.near, ...tiers.mid].sort().map((k) => `${k}@${levels.get(k) ?? 0}`).join() : "";
  const report = useRef(onOpen);
  report.current = onOpen;
  useEffect(() => report.current?.(new Map(openKeys ? openKeys.split(",").map((e) => { const i = e.lastIndexOf("@"); return [e.slice(0, i), Number(e.slice(i + 1))] as [string, number]; }) : [])), [openKeys]);

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
  const parts = useMemo(() => buildParts(models, plans, drawn, levels, managed, ops), [models, plans, drawn, levels, managed, ops]);
  const walls = drawn.near.map((k) => models.get(k)).filter((m): m is BuildingModel => !!m);
  // After dark the office lights are on, as inside (OfficeEnvironment): the floor and walls glow warm.
  useEffect(() => {
    for (const m of [MAT.slab, MAT.wall, MAT.oak]) {
      m.emissive.set("#ffe1af");
      m.emissiveIntensity = night ? 0.32 : 0;
    }
  }, [night]);
  if (!drawn.near.length && !drawn.mid.length) return null;
  const y = CUT_Y;
  return (
    <group name="atlas-inside-view">
      <Rising items={parts.slab} geometry={BOX} material={MAT.slab} rise={STILL} floorY={y} />
      <Rising items={parts.outline} geometry={BOX} material={MAT.outline} rise={STILL} floorY={y} shadow={false} />
      <Rising items={parts.tiles} geometry={BOX} material={MAT.tile} rise={STILL} floorY={y} shadow={false} />
      <Rising items={parts.core} geometry={BOX} material={MAT.wall} rise={STILL} floorY={y} />
      <Rising items={parts.oak} geometry={BOX} material={MAT.oak} rise={rise} floorY={y} />
      <Rising items={parts.steel} geometry={BOX} material={MAT.steel} rise={rise} floorY={y} shadow={false} />
      <Rising items={parts.dark} geometry={BOX} material={MAT.dark} rise={rise} floorY={y} />
      <Rising items={parts.screen} geometry={BOX} material={MAT.screen} rise={rise} floorY={y} shadow={false} />
      <Rising items={parts.chair} geometry={BOX} material={MAT.chair} rise={rise} floorY={y} />
      <Rising items={parts.torso} geometry={TORSO} material={MAT.tinted} rise={rise} floorY={y} />
      <Rising items={parts.head} geometry={BALL} material={MAT.tinted} rise={rise} floorY={y} shadow={false} />
      <Rising items={parts.hair} geometry={BALL} material={MAT.tinted} rise={rise} floorY={y} shadow={false} />
      <Rising items={parts.lamp} geometry={BALL} material={MAT.lamp} rise={rise} floorY={y} shadow={false} />
      <Rising items={parts.marker} geometry={GEM} material={MAT.lamp} rise={rise} floorY={y} shadow={false} />
      {walls.map((m) => (
        <OfficeInterior key={m.key} m={m} level={levels.get(m.key) ?? m.officeFloors[0].level} />
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
 * The open floor's room, drawn like the office inside "Enter building" (OfficeEnvironment): back
 * and left walls with their windows, trim and the wall display, the low sills on the street and
 * right sides, the rug under the desks, the server rack and plants, the lift's doors in the core;
 * on the lobby, a reception desk, sofas and planting by the door. In office units, scaled to the
 * building (buildingModel.ts), its storey's height capping the walls. The accent strip is the
 * building's own colour. Each full wall steps aside while the camera looks in from its side.
 */
function OfficeInterior({ m, level }: { m: BuildingModel; level: number }) {
  const w = m.plate / m.k, d = w;
  const H = Math.min(2.7, (0.92 * m.floorH) / m.k);
  const T = 0.16;
  const f = H / 2.7;
  const center = useMemo(() => ({ x: m.x, z: m.z }), [m.x, m.z]);
  const accent = useMemo(() => {
    const mat = MAT.accent.clone();
    mat.color.set(m.accent);
    return mat;
  }, [m.accent]);
  useEffect(() => () => accent.dispose(), [accent]);
  const leftWins = [-d / 3, 0, d / 3];
  const backWins = [-w / 2 + w * 0.17, -w * 0.05];
  const winH = 1.3 * f, winY = 1.55 * f;
  // The lift core in office units (the same corner on every floor), and its doors facing the landing.
  const cx = (m.core.x - m.x) / m.k, cz = (m.core.z - m.z) / m.k;
  const lobby = level === 0;
  const ly = (m.door.lobby[2] - m.z) / m.k, lx = (m.door.lobby[0] - m.x) / m.k;
  return (
    <group position={[m.x, levelY(level), m.z]} scale={m.k}>
      {!lobby && <Bx p={[0, 0.006, 0.25]} s={[Math.min(w - 2.6, 8.2), 0.012, Math.min(d - 3, 6.2)]} m={MAT.rug} />}
      {lobby && <Bx p={[lx, 0.006, ly - 1.6]} s={[3.2, 0.012, 2.4]} m={MAT.rug} />}
      <CutawayWall side="back" center={center}>
        <Bx p={[0, 0.45 * f, -d / 2 - T / 2]} s={[w + T * 2, 0.9 * f, T]} m={MAT.wall} />
        <Bx p={[0, H - 0.25 * f, -d / 2 - T / 2]} s={[w + T * 2, 0.5 * f, T]} m={MAT.wall} />
        {[-w / 2 - T, ...backWins.map((x) => x + 0.65)].map((start, i) => {
          const end = i < backWins.length ? backWins[i] - 0.65 : w / 2 + T;
          return end > start ? <Bx key={i} p={[(start + end) / 2, winY, -d / 2 - T / 2]} s={[end - start, winH, T]} m={MAT.wall} /> : null;
        })}
        {backWins.map((x) => (
          <group key={x} position={[x, winY, -d / 2 + 0.005]}>
            <Bx p={[0, 0, 0.02]} s={[1.18, winH - 0.12, 0.02]} m={MAT.pane} />
            <Bx p={[0, 0, 0.04]} s={[0.04, winH - 0.12, 0.02]} m={MAT.frame} />
          </group>
        ))}
        <Bx p={[0, H + 0.03, -d / 2 - T / 2]} s={[w + T * 2 + 0.04, 0.06, T + 0.04]} m={MAT.trim} />
        {/* The building's colour along the wall, and the wall display (its screen stays dark: no pretend figures). */}
        <Bx p={[0, 0.95 * f, -d / 2 + 0.01]} s={[w, 0.05, 0.02]} m={accent} />
        {!lobby && <Bx p={[w * 0.15, 1.6 * f, -d / 2 + 0.04]} s={[2.5, 1.3 * f, 0.06]} m={MAT.dark} />}
      </CutawayWall>
      <CutawayWall side="left" center={center}>
        <Bx p={[-w / 2 - T / 2, 0.45 * f, 0]} s={[T, 0.9 * f, d]} m={MAT.wall} />
        <Bx p={[-w / 2 - T / 2, H - 0.25 * f, 0]} s={[T, 0.5 * f, d]} m={MAT.wall} />
        {[-d / 2, ...leftWins.map((z) => z + 0.75)].map((start, i) => {
          const end = i < leftWins.length ? leftWins[i] - 0.75 : d / 2;
          return end > start ? <Bx key={i} p={[-w / 2 - T / 2, winY, (start + end) / 2]} s={[T, winH, end - start]} m={MAT.wall} /> : null;
        })}
        {leftWins.map((z) => (
          <group key={z} position={[-w / 2 + 0.005, winY, z]}>
            <Bx p={[0.02, 0, 0]} s={[0.02, winH - 0.12, 1.38]} m={MAT.pane} />
            <Bx p={[0.04, 0, 0]} s={[0.02, winH - 0.12, 0.04]} m={MAT.frame} />
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
      {/* The lift: its doors on the landing side of the core, in a dark frame. */}
      <group position={[cx, 0, cz + CORE / 2 + 0.01]}>
        <Bx p={[0, 0.95 * f, 0]} s={[0.9, 1.9 * f, 0.03]} m={MAT.frame} />
        <Bx p={[0, 0.95 * f, 0.02]} s={[0.03, 1.8 * f, 0.02]} m={MAT.dark} />
        <Bx p={[0, 1.95 * f, 0.01]} s={[0.9, 0.06, 0.03]} m={accent} />
      </group>
      {lobby ? (
        <>
          {/* Reception facing the door, a sofa either side, planting by the entrance. */}
          <Bx p={[lx, 0.55, ly - 2.4]} s={[2.4, 1.1, 0.7]} m={MAT.oak} />
          <Bx p={[lx, 1.12, ly - 2.4]} s={[2.5, 0.05, 0.8]} m={accent} />
          {[-1, 1].map((sx) => (
            <group key={sx} position={[lx + sx * 2.8, 0, ly - 0.9]}>
              <Bx p={[0, 0.22, 0]} s={[1.6, 0.44, 0.7]} m={MAT.chair} />
              <Bx p={[0, 0.55, -0.3]} s={[1.6, 0.5, 0.12]} m={MAT.chair} />
            </group>
          ))}
          <Plant p={[lx - 1.6, 0, ly - 0.2]} s={0.9} />
          <Plant p={[lx + 1.6, 0, ly - 0.2]} s={0.9} />
          <Plant p={[-w / 2 + 0.7, 0, -d / 2 + 0.7]} s={1.1} />
        </>
      ) : (
        <>
          {/* The server rack in the back corner: its lights are decoration, not telemetry. */}
          <group position={[-w / 2 + 0.55, 0, -d / 2 + 0.55]}>
            <Bx p={[0, 0.95 * f, 0]} s={[0.62, 1.9 * f, 0.62]} m={MAT.dark} />
            {[0.5, 0.8, 1.1, 1.4].map((y) => (
              <mesh key={y} geometry={BOX} material={MAT.led} position={[-0.2, y * f, 0.32]} scale={[0.03, 0.03, 0.01]} />
            ))}
          </group>
          <Plant p={[-w / 2 + 1.35, 0, -d / 2 + 0.45]} s={0.7} />
          <Plant p={[-w / 2 + 0.5, 0, d / 2 - 0.5]} s={0.9} />
          <Plant p={[w / 2 - 0.5, 0, d / 2 - 0.5]} s={0.8} />
        </>
      )}
    </group>
  );
}

export type { InsideLimits };
