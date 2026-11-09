import { useMemo, useRef, type ReactNode } from "react";
import { isRibbonTower } from "./ribbonTowerPlan";
import { isCommerceTower } from "./commerceTowerPlan";
import { useFrame } from "@react-three/fiber";
import { isGithubTower } from "./githubTowerPlan";
import { isIntelligenceHub } from "./intelligenceHubPlan";
import { isPortfolioSite } from "./portfolioSitePlan";
import * as THREE from "three";
import type { Illumination } from "../office/activity";
import type { useGeometries, useMaterials } from "./models";
import { FLOOR_H, TERRACE_H, type House, type Tower } from "./scene";

type G = ReturnType<typeof useGeometries>;
type M = ReturnType<typeof useMaterials>;

const COLOR: Record<Exclude<Illumination, "idle">, string> = { running: "#5fd8ff", completed: "#7fe6a4", error: "#f0a842" };
/** Floors start this high, as in the headquarters model. */
const FLOOR_BASE = TERRACE_H + 0.15;
/** Seconds to fade fully in or out. */
const FADE = 1.4;

/**
 * Lights buildings from the work inside them: each window glows in the state's color through a
 * thin additive shell drawn with the facade's own window mask, and the building's edges pick up
 * a faint outline. Nothing is added for idle buildings, and the map's existing frame loop drives
 * the fades, so there is no extra render loop or light source.
 */
export function ActivityGlow({ towers, houses, states, g, m, reduced }: { towers: Tower[]; houses: House[]; states: Map<string, Illumination>; g: G; m: M; reduced: boolean }) {
  // Buildings stay mounted after they go idle so they can fade out; the set only grows.
  const seen = useRef(new Set<string>());
  for (const k of states.keys()) seen.current.add(k);
  const byKey = useMemo(() => new Map<string, Tower | House>([...towers, ...houses].map((b) => [b.key, b])), [towers, houses]);
  return (
    <group>
      {[...seen.current].map((k) => {
        const b = byKey.get(k);
        if (!b) return null;
        const tower = "floors" in b;
        const mask = (tower ? m.facades[b.identity.style] : m.houseWall).emissiveMap;
        return <BuildingGlow key={k} b={b} tower={tower} mask={mask} state={states.get(k) ?? "idle"} g={g} reduced={reduced} />;
      })}
    </group>
  );
}

const EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
/**
 * The glow shells share faces with the plinth, paving and roof they sit on; pulling them a hair
 * toward the camera stops those coplanar faces from flickering as the depth test flips.
 */
const AHEAD = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
/** Above the plaza paving (0.03 thick), so the halo never shares a depth with it and flickers. */
const HALO_Y = TERRACE_H + 0.05;
/** A flat disc on the ground. */
const HALO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
/** Soft round falloff for the ground halo, drawn once. */
const HALO_TEX = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  if (!x) return null;
  const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = grad;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

function BuildingGlow({ b, tower, mask, state, g, reduced }: { b: Tower | House; tower: boolean; mask: THREE.Texture | null; state: Illumination; g: G; reduced: boolean }) {
  const mats = useMemo(
    () => ({
      win: new THREE.MeshBasicMaterial({ map: mask, color: "#000000", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, ...AHEAD }),
      edge: new THREE.LineBasicMaterial({ color: "#000000", transparent: true, opacity: 0, toneMapped: false }),
      // A wash over the whole facade, so the change reads in daylight where the glass is already pale blue.
      tint: new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, ...AHEAD }),
      halo: new THREE.MeshBasicMaterial({ map: HALO_TEX, color: "#000000", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, ...AHEAD }),
    }),
    [mask],
  );
  const root = useRef<THREE.Group>(null);
  const level = useRef(0);
  const color = useMemo(() => new THREE.Color(), []);
  const target = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }, dt) => {
    const on = state !== "idle";
    const goal = on ? 1 : 0;
    level.current = reduced ? goal : THREE.MathUtils.clamp(level.current + Math.sign(goal - level.current) * Math.min(dt, 0.1) / FADE, 0, 1);
    if (root.current) root.current.visible = level.current > 0.001;
    if (!root.current?.visible) return;
    if (on) target.set(COLOR[state as Exclude<Illumination, "idle">]);
    // Colors ease too, so running to completed or error blends rather than snaps.
    color.lerp(target, reduced ? 1 : Math.min(1, dt * 2.5));
    const e = level.current * level.current * (3 - 2 * level.current);
    // A slow, gentle breath while running; still when reduced motion is on.
    const breath = state === "running" && !reduced ? 0.8 + 0.2 * Math.sin(clock.elapsedTime * 1.8) : 1;
    // Houses have fewer, smaller windows, so they need a stronger glow to read at the same distance.
    mats.win.color.copy(color).multiplyScalar(e * breath * (tower ? 2.6 : 3.2));
    mats.tint.color.copy(color).multiplyScalar(e * breath * 0.28);
    mats.halo.color.copy(color).multiplyScalar(e * breath * 0.9);
    mats.edge.color.copy(color);
    mats.edge.opacity = e * breath;
  });

  const parts = useMemo(() => {
    if (tower) {
      const t = b as Tower;
      // Atlas HQ, Benjaire HQ, Commerce Pipeline and the GitHub tower are not boxes: a box-shaped glow
      // would hide them, so they light their plinth's edges and the ground halo instead.
      if (t.identity.landmark || isRibbonTower(t.projectId) || isCommerceTower(t.projectId) || isGithubTower(t.projectId) || isIntelligenceHub(t.projectId) || isPortfolioSite(t.projectId)) return { floors: [], box: [t.x, TERRACE_H, t.z, t.size * 1.18, 0.17, t.size * 1.18] as const, shaped: true };
      const s = t.size * 1.006;
      return { floors: Array.from({ length: t.floors }, (_, i) => [t.x, FLOOR_BASE + i * FLOOR_H, t.z, s, s] as const), box: [t.x, FLOOR_BASE, t.z, t.size + 0.06, t.floors * FLOOR_H, t.size + 0.06] as const };
    }
    const h = b as House;
    const y0 = TERRACE_H + 0.03;
    return { floors: [[h.x, y0, h.z, h.w * 1.01, h.d * 1.01] as const], box: [h.x, y0, h.z, h.w + 0.04, h.h, h.d + 0.04] as const, hh: h.h };
  }, [b, tower]);
  const [bx, by, bz, bw, bh, bd] = parts.box;
  return (
    <group ref={root} visible={false}>
      {parts.floors.map(([x, y, z, w, d], i) => (
        <mesh key={i} geometry={g.box} material={mats.win} position={[x, y, z]} scale={[w, tower ? FLOOR_H : (parts.hh ?? 0), d]} raycast={noRaycast} renderOrder={2} />
      ))}
      {!("shaped" in parts) && <mesh geometry={g.box} material={mats.tint} position={[bx, by, bz]} scale={[bw, bh, bd]} raycast={noRaycast} renderOrder={2} />}
      <lineSegments geometry={EDGES} material={mats.edge} position={[bx, by + bh / 2, bz]} scale={[bw, bh, bd]} raycast={noRaycast} />
      <mesh geometry={HALO} material={mats.halo} position={[bx, HALO_Y, bz]} scale={[Math.max(bw, bd) * 2.6, 1, Math.max(bw, bd) * 2.6]} raycast={noRaycast} renderOrder={1} />
    </group>
  );
}

const noRaycast = () => null;

/** How strongly a shaped building's own surfaces light up at full glow. */
const WHOLE_EMISSIVE = 0.55;

type Lit = THREE.Material & { emissive: THREE.Color };
const hasEmissive = (mat: THREE.Material): mat is Lit => (mat as Partial<Lit>).emissive instanceof THREE.Color;
/** Original material -> this building's own copy, with the original's emissive to add onto. */
export type GlowCopies = Map<THREE.Material, { copy: Lit; base: THREE.Color }>;

function eachMaterial(root: THREE.Object3D, fn: (mat: THREE.Material, put: (m: THREE.Material) => void) => void) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = mesh.material;
    if (Array.isArray(mats)) mats.forEach((mat, i) => fn(mat, (m) => (mats[i] = m)));
    else fn(mats, (m) => (mesh.material = m));
  });
}

/**
 * Gives every mesh under root its own copy of each lit material and sets the copies' emissive to
 * the original's plus glow. Shared materials are never changed, so other buildings stay as they are.
 */
export function lightUp(root: THREE.Object3D, copies: GlowCopies, glow: THREE.Color) {
  const mine = new Set<THREE.Material>([...copies.values()].map((c) => c.copy));
  eachMaterial(root, (mat, put) => {
    if (mine.has(mat) || !hasEmissive(mat)) return;
    // A re-render (night toggle, selection) can hand the mesh its shared material again.
    let c = copies.get(mat);
    if (!c) {
      c = { copy: mat.clone() as Lit, base: mat.emissive.clone() };
      copies.set(mat, c);
      mine.add(c.copy);
    }
    put(c.copy);
  });
  copies.forEach(({ copy, base }) => copy.emissive.copy(base).add(glow));
}

/** Hands every mesh its shared material back and frees the copies. */
export function restore(root: THREE.Object3D, copies: GlowCopies) {
  const back = new Map<THREE.Material, THREE.Material>([...copies].map(([orig, c]) => [c.copy, orig]));
  eachMaterial(root, (mat, put) => {
    const orig = back.get(mat);
    if (orig) put(orig);
  });
  copies.forEach((c) => c.copy.dispose());
  copies.clear();
}

/**
 * Lights a shaped building as a whole (Atlas HQ, Benjaire HQ, Commerce Pipeline, GitHub, the
 * Intelligence Hub, the Portfolio Site), which a box-shaped shell would hide. While its work is
 * running, completed or failed, every surface of the building takes the state's color through its
 * own emissive channel, so no geometry, light or draw call is added. Materials are copied for this
 * building only while it glows, and the originals go back once it has faded out.
 */
export function WholeBuildingGlow({ state, reduced, children }: { state: Illumination; reduced: boolean; children: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  const level = useRef(0);
  const color = useMemo(() => new THREE.Color(), []);
  const target = useMemo(() => new THREE.Color(), []);
  const glow = useMemo(() => new THREE.Color(), []);
  const copies = useRef<GlowCopies>(new Map());

  useFrame(({ clock }, dt) => {
    const on = state !== "idle";
    const goal = on ? 1 : 0;
    level.current = reduced ? goal : THREE.MathUtils.clamp(level.current + Math.sign(goal - level.current) * Math.min(dt, 0.1) / FADE, 0, 1);
    if (!root.current) return;
    if (level.current <= 0.001) {
      if (copies.current.size) restore(root.current, copies.current);
      return;
    }
    if (on) target.set(COLOR[state as Exclude<Illumination, "idle">]);
    color.lerp(target, reduced ? 1 : Math.min(1, dt * 2.5));
    const e = level.current * level.current * (3 - 2 * level.current);
    const breath = state === "running" && !reduced ? 0.8 + 0.2 * Math.sin(clock.elapsedTime * 1.8) : 1;
    lightUp(root.current, copies.current, glow.copy(color).multiplyScalar(e * breath * WHOLE_EMISSIVE));
  });

  return <group ref={root}>{children}</group>;
}
