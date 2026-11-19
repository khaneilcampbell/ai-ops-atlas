import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { TERRACE_H } from "./scene";
import { Instanced, type Inst, type Pick, type useGeometries, type useMaterials } from "./models";
import { PLAZA, PLAZA_KEY, type PlazaPlan } from "./plazaPlan";
import type { Pt } from "./roads";
import type { PlazaEffects } from "../../plaza/usePlaza";
import { GLOW_MS, PULSE_MS } from "../../plaza/usePlaza";
import { LANTERN, lanternState } from "../../plaza/lantern";

/** What the 3D plaza needs from the live snapshot (plaza/plazaState.ts), already counted. */
export interface PlazaView {
  connection: "live" | "unavailable";
  preview: boolean;
  running: number;
  queued: number;
  attention: number;
  sign: { status: string; note: string | null; tone: "live" | "attention" | "unavailable" | "preview" };
}

/** Lights travel round the rings, one per run; more runs than this still show this many. */
export const MAX_RING_LIGHTS = 9;

/** Always-on sculpture motion, radians a second: the gyroscope's slow orbit and each ring's tumble (outer to inner). */
export const PLAZA_MOTION = { orbit: 0.12, tumble: [0.22, 0.34, 0.48] } as const;

const GROUND = TERRACE_H;
/** Concept B's saucer, as a share of the lantern's radius: set just inside the rim so the rim shows round it. */
const CROWN_DISC = 0.68;
const TOP = GROUND + PLAZA.rise;
const C = {
  stone: "#efe6d2",
  paving: "#e6dcc6",
  step: "#ddd1b6",
  curb: "#cfc2a4",
  bed: "#6f8f4c",
  wood: "#b68c60",
  iron: "#294237",
  cream: "#f3ead6",
} as const;

/** The sign's face: forest green with a gold rule, the plaza name, and the status from live data. */
function drawSign(canvas: HTMLCanvasElement, sign: PlazaView["sign"]) {
  const g = canvas.getContext("2d");
  if (!g) return;
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = "#1f3a2c";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#d9b45f";
  g.lineWidth = 10;
  g.strokeRect(18, 18, W - 36, H - 36);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#e8c877";
  g.font = '500 66px ui-serif, "New York", "Iowan Old Style", Georgia, serif';
  const title = "ATLAS AUTOMATION PLAZA";
  // Letter-spaced capitals, like engraved lettering.
  const spaced = title.split("").join(String.fromCharCode(8202));
  g.fillText(spaced, W / 2, 112, W - 90);
  g.fillStyle = "rgba(217,180,95,.8)";
  g.fillRect(W * 0.2, 168, W * 0.6, 4);
  g.fillStyle = sign.tone === "unavailable" ? "#d8d2c4" : "#f6efdc";
  g.font = '500 54px -apple-system, "Helvetica Neue", Arial, sans-serif';
  g.fillText(sign.status, W / 2, 236, W - 90);
  if (sign.note) {
    g.fillStyle = sign.tone === "attention" ? "#f2b45a" : sign.tone === "preview" ? "#e8c877" : "#c7c0b0";
    g.font = '500 38px -apple-system, "Helvetica Neue", Arial, sans-serif';
    g.fillText(sign.note, W / 2, 310, W - 110);
  }
}

/** A small round badge, for the attention and completed markers: "!" in amber, a tick in green. */
function badge(kind: "attention" | "done"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = kind === "attention" ? "#e8962f" : "#4f9a5d";
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#fff8e6";
  g.fillStyle = "#fff8e6";
  g.lineWidth = 14;
  g.lineCap = "round";
  g.lineJoin = "round";
  if (kind === "attention") {
    g.beginPath();
    g.moveTo(64, 30);
    g.lineTo(64, 74);
    g.stroke();
    g.beginPath();
    g.arc(64, 98, 8, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(38, 66);
    g.lineTo(56, 84);
    g.lineTo(92, 44);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A flat strip between two map points: paths, beds, steps. */
function strip(a: Pt, b: Pt, width: number, y: number, h: number, c?: string): Inst {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { p: [(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2], s: [width, h, len + 0.01], r: Math.atan2(b[0] - a[0], b[1] - a[1]), c };
}

/** Arc pieces between two angles at a radius, as strips. */
function arc(cx: number, cz: number, r: number, a0: number, a1: number, width: number, y: number, h: number, c: string, step = 0.12): Inst[] {
  const n = Math.max(1, Math.ceil(((a1 - a0) * r) / step));
  const out: Inst[] = [];
  for (let i = 0; i < n; i++) {
    const u = a0 + ((a1 - a0) * i) / n;
    const v = a0 + ((a1 - a0) * (i + 1)) / n;
    out.push(strip([cx + r * Math.cos(u), cz + r * Math.sin(u)], [cx + r * Math.cos(v), cz + r * Math.sin(v)], width, y, h, c));
  }
  return out;
}

/**
 * Atlas Automation Plaza: a round landscaped plaza with a glass enclosure holding three gold
 * gyroscope rings on a cream stone pedestal. Decorative light (lamps, the
 * pedestal's warm ring) is kept apart from the execution indicators (the lights on the rings, the
 * handoff pulses, the green completion glow, the amber marker), which only ever show live data.
 * Static parts are shared instance buffers; the only per-frame work is while something moves.
 */
export default function AutomationPlaza({
  plan: p,
  g,
  m,
  pick,
  night,
  view,
  effects,
  paths,
  reduced,
}: {
  plan?: PlazaPlan;
  g: ReturnType<typeof useGeometries>;
  m: ReturnType<typeof useMaterials>;
  pick: Pick;
  night: boolean;
  view: PlazaView;
  effects: PlazaEffects;
  /** Routes to buildings that run automations: unseen, a handoff light travels one. */
  paths: PlazaPlan["paths"];
  reduced: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);

  // Geometry and materials made once, disposed on unmount.
  const kit = useMemo(() => {
    const disc = new THREE.CylinderGeometry(1, 1, 1, 56).translate(0, 0.5, 0);
    const glassTube = new THREE.CylinderGeometry(PLAZA.enclosureRadius, PLAZA.enclosureRadius, PLAZA.enclosureHeight, 40, 1, true).translate(0, PLAZA.enclosureHeight / 2, 0);
    const rings = PLAZA.ringRadii.map((r) => new THREE.TorusGeometry(r, PLAZA.ringTube, 8, 56));
    const rim = new THREE.TorusGeometry(PLAZA.enclosureRadius, 0.04, 6, 56);
    const glowRing = new THREE.RingGeometry(0.42, 0.7, 48).rotateX(-Math.PI / 2);
    const inlay = new THREE.RingGeometry(PLAZA.bedInner - 0.1, PLAZA.bedInner - 0.06, 64).rotateX(-Math.PI / 2);
    const bead = new THREE.SphereGeometry(1, 10, 8);
    // Concept A's lantern (Khaneil, 2026-11-19): a gold collar at the foot of the glass, a warm glowing
    // floor inside and a gold ring inlaid in the paving. The top is concept B's open crown (see parts).
    // Concept B's top: a shallow saucer with a low domed centre.
    const saucerDome = new THREE.SphereGeometry(PLAZA.enclosureRadius * CROWN_DISC, 36, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.1 / (PLAZA.enclosureRadius * CROWN_DISC), 1);
    const band = new THREE.CylinderGeometry(PLAZA.enclosureRadius + 0.06, PLAZA.enclosureRadius + 0.06, 1, 40).translate(0, 0.5, 0);
    const floorGlow = new THREE.CircleGeometry(PLAZA.enclosureRadius - 0.04, 40).rotateX(-Math.PI / 2);
    const floorLight = new THREE.MeshBasicMaterial({ color: "#ffe9b0", transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    const pavingRing = new THREE.RingGeometry(PLAZA.enclosureRadius + 0.08, PLAZA.enclosureRadius + 0.14, 72).rotateX(-Math.PI / 2);
    const face = new THREE.PlaneGeometry(1, 1);
    const glass = new THREE.MeshStandardMaterial({ color: "#d9ecf2", transparent: true, opacity: 0.3, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const gold = new THREE.MeshStandardMaterial({ color: "#d9b468", metalness: 0.55, roughness: 0.3, emissive: "#8a6420", emissiveIntensity: 0.2 });
    const stone = new THREE.MeshStandardMaterial({ color: C.cream, roughness: 0.75 });
    // The lantern's night light: a soft column of the status colour inside the glass (plaza/lantern.ts).
    const beam = new THREE.MeshBasicMaterial({ color: LANTERN.idle, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    // ...and a pool of the same colour on the plaza floor around the pedestal, brightest at the glass.
    const poolTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g2 = c.getContext("2d")!;
      const grad = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,255,0.9)");
      grad.addColorStop(0.55, "rgba(255,255,255,0.55)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const pool = new THREE.MeshBasicMaterial({ color: LANTERN.idle, map: poolTex, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    const poolDisc = new THREE.CircleGeometry(PLAZA.bedOuter + 0.1, 48).rotateX(-Math.PI / 2);
    // The outer spill lands on the lawn and street-side paving round the steps (the disc hides its middle).
    const poolSpill = new THREE.CircleGeometry(PLAZA.stepsOuter + 1.1, 56).rotateX(-Math.PI / 2);
    // A wide, faint halo of the same light over the lawn, paths and street around the plaza. It is a flat
    // additive glow, not a real light: real lights would recompile every lit material in the city.
    const halo = pool.clone();
    const haloDisc = new THREE.CircleGeometry(PLAZA.stepsOuter + 4.5, 64).rotateX(-Math.PI / 2);
    // A thin bright core column up the middle of the lantern at night.
    const core = new THREE.MeshBasicMaterial({ color: LANTERN.idle, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreTube = new THREE.CylinderGeometry(PLAZA.enclosureRadius * 0.12, PLAZA.enclosureRadius * 0.12, PLAZA.enclosureHeight - 0.3, 20, 1, true).translate(0, PLAZA.enclosureHeight / 2, 0);
    const beamTube = new THREE.CylinderGeometry(PLAZA.enclosureRadius * 0.96, PLAZA.enclosureRadius * 0.96, PLAZA.enclosureHeight - 0.04, 40, 1, true).translate(0, PLAZA.enclosureHeight / 2, 0);
    // Decorative: warm, steady, brighter at night.
    const pathGlow = new THREE.MeshStandardMaterial({ color: "#e2c06f", emissive: "#e0b558", emissiveIntensity: 0.35, roughness: 0.5, transparent: true, opacity: 0.85 });
    const warm = new THREE.MeshBasicMaterial({ color: "#f6dc98", transparent: true, opacity: 0.55, depthWrite: false });
    // Execution indicators: their own materials, never shared with decoration.
    const runLight = new THREE.MeshBasicMaterial({ color: "#fff4cf" });
    const pulse = new THREE.MeshBasicMaterial({ color: "#fff1c2" });
    const pathLit = new THREE.MeshBasicMaterial({ color: "#ffe9a8", transparent: true, opacity: 0.95 });
    const done = new THREE.MeshBasicMaterial({ color: "#7fd18f", transparent: true, opacity: 0.75, depthWrite: false });
    const amber = new THREE.MeshStandardMaterial({ color: "#e8962f", emissive: "#e8962f", emissiveIntensity: 0.6 });
    const green = new THREE.MeshStandardMaterial({ color: "#4f9a5d", emissive: "#4f9a5d", emissiveIntensity: 0.6 });
    const attentionFace = new THREE.MeshBasicMaterial({ map: badge("attention"), transparent: true });
    const doneFace = new THREE.MeshBasicMaterial({ map: badge("done"), transparent: true });
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 380;
    const signTex = new THREE.CanvasTexture(canvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    signTex.anisotropy = 4;
    const signFace = new THREE.MeshBasicMaterial({ map: signTex });
    return { saucerDome, band, floorGlow, floorLight, pavingRing, halo, haloDisc, core, coreTube, pool, poolDisc, poolSpill, beam, beamTube, disc, glassTube, rings, rim, glowRing, inlay, bead, face, glass, gold, stone, pathGlow, warm, runLight, pulse, pathLit, done, amber, green, attentionFace, doneFace, canvas, signTex, signFace };
  }, []);
  useEffect(
    () => () => {
      for (const v of Object.values(kit)) if (v && typeof (v as { dispose?: () => void }).dispose === "function") (v as { dispose: () => void }).dispose();
      for (const r of kit.rings) r.dispose();
      kit.attentionFace.map?.dispose();
      kit.pool.map?.dispose();
      kit.doneFace.map?.dispose();
    },
    [kit],
  );

  // The sign redraws only when its words change.
  useEffect(() => {
    drawSign(kit.canvas, view.sign);
    kit.signTex.needsUpdate = true;
    invalidate();
  }, [kit, view.sign, invalidate]);

  useEffect(() => {
    kit.pathGlow.emissiveIntensity = night ? 0.9 : 0.35;
    kit.warm.opacity = night ? 0.85 : 0.45;
    kit.gold.emissiveIntensity = night ? 0.85 : 0.2;
    kit.floorLight.opacity = night ? 0.8 : 0.4;
    invalidate();
  }, [kit, night, invalidate]);

  // Always lit at night, in the colour of the live status (Khaneil, 2026-11-18). Khaneil tried a softer
  // glow the same day, then asked for the full light that brightens the plaza and lawn around it again.
  const lantern = lanternState(view, effects.glowAt !== null);
  useEffect(() => {
    const c = new THREE.Color(LANTERN[lantern]);
    kit.beam.color.copy(c);
    kit.beam.opacity = lantern === "unavailable" ? 0.06 : 0.14;
    kit.core.color.copy(c).lerp(new THREE.Color("#ffffff"), 0.6);
    kit.core.opacity = lantern === "unavailable" ? 0.18 : 0.55;
    kit.halo.color.copy(c);
    kit.halo.opacity = lantern === "unavailable" ? 0.15 : 0.45;
    kit.pool.color.copy(c);
    kit.pool.opacity = lantern === "unavailable" ? 0.3 : 0.75;
    kit.glass.emissive.copy(c);
    kit.glass.emissiveIntensity = night ? (lantern === "unavailable" ? 0.12 : 0.35) : 0;
    invalidate();
  }, [kit, night, lantern, invalidate]);

  const parts = useMemo(() => {
    const solid: Inst[] = [];
    const lamps: Inst[] = [];
    const posts: Inst[] = [];
    const path: Inst[] = [];
    if (!p) return { solid, lamps, posts, path };
    const { cx, cz } = p;
    // Front steps: three curved treads down from the disc to the lawn.
    const fw = PLAZA.gap * 2.4;
    const span = PLAZA.stepsOuter - PLAZA.radius;
    for (let i = 0; i < 3; i++) {
      const r = PLAZA.radius + (span * (i + 0.5)) / 3;
      solid.push(...arc(cx, cz, r, PLAZA.front - fw, PLAZA.front + fw, span / 3 + 0.01, GROUND, PLAZA.rise * (1 - i / 3), C.step));
    }
    // Beds: a stone kerb round each, low planting inside (the shrubs are the city's, via Landscape).
    for (const [a, b] of p.beds) {
      const mid = (PLAZA.bedInner + PLAZA.bedOuter) / 2;
      solid.push(...arc(cx, cz, mid, a, b, PLAZA.bedOuter - PLAZA.bedInner, TOP, 0.05, C.bed));
      solid.push(...arc(cx, cz, PLAZA.bedInner, a, b, 0.05, TOP, 0.08, C.curb));
      solid.push(...arc(cx, cz, PLAZA.bedOuter, a, b, 0.05, TOP, 0.08, C.curb));
    }
    // Benches facing the sculpture: a wooden seat and back on dark iron legs.
    for (const b of p.benches) {
      const part = (dx: number, y: number, dz: number, w: number, h: number, d: number, c: string): Inst => ({
        p: [b.x + dx * Math.cos(b.ry) + dz * Math.sin(b.ry), TOP + y, b.z - dx * Math.sin(b.ry) + dz * Math.cos(b.ry)],
        s: [w, h, d],
        r: b.ry,
        c,
      });
      solid.push(part(0, 0.13, 0, 0.5, 0.04, 0.17, C.wood), part(0, 0.17, 0.075, 0.5, 0.15, 0.03, C.wood));
      for (const side of [-1, 1]) solid.push(part(side * 0.2, 0, 0, 0.035, 0.13, 0.14, C.iron));
    }
    // Lamps at each entrance: slim dark posts with a warm globe.
    for (const [x, z] of p.lamps) {
      posts.push({ p: [x, TOP, z], s: [0.03, 0.42, 0.03], c: C.iron });
      lamps.push({ p: [x, TOP + 0.44, z], s: [0.045, 0.045, 0.045] });
    }
    // The sign: two posts, a green slab with a gold frame; its face is the live status texture.
    const s = p.sign;
    const along = (d: number, y: number, depth = 0): [number, number, number] => [s.x + Math.cos(s.ry) * d + Math.sin(s.ry) * depth, GROUND + y, s.z - Math.sin(s.ry) * d + Math.cos(s.ry) * depth];
    for (const d of [-s.w * 0.36, s.w * 0.36]) solid.push({ p: along(d, 0), s: [0.06, 0.16, 0.06], r: s.ry, c: C.iron });
    solid.push({ p: along(0, 0.14), s: [s.w, s.h, 0.07], r: s.ry, c: "#1f3a2c" });
    solid.push({ p: along(0, 0.14 + s.h), s: [s.w + 0.04, 0.03, 0.09], r: s.ry, c: "#c9a35a" }, { p: along(0, 0.12), s: [s.w + 0.04, 0.03, 0.09], r: s.ry, c: "#c9a35a" });
    for (const d of [-s.w / 2 - 0.01, s.w / 2 + 0.01]) solid.push({ p: along(d, 0.12), s: [0.03, s.h + 0.05, 0.09], r: s.ry, c: "#c9a35a" });
    // A planted kerb at the sign's foot.
    solid.push({ p: along(0, 0, 0.02), s: [s.w + 0.25, 0.05, 0.3], r: s.ry, c: C.bed });
    // Fine gold mullions all round, so the clear enclosure reads as tall glass panes in a gold frame.
    for (let i = 0; i < PLAZA.mullions; i++) {
      const a = (i / PLAZA.mullions) * Math.PI * 2 + 0.31;
      solid.push({ p: [cx + PLAZA.enclosureRadius * Math.cos(a), TOP + 0.02, cz + PLAZA.enclosureRadius * Math.sin(a)], s: [0.02, PLAZA.enclosureHeight, 0.02], r: -a, c: "#c9a35a" });
    }
    // No standing gold lines to the buildings (Khaneil, 2026-11-18): the routes stay invisible, and only a
    // real handoff lights one, as a travelling light.
    return { solid, lamps, posts, path };
  }, [p]);

  // Marker posts (attention and completed), each a short pillar under its badge.
  const markerPosts = useMemo(() => (p ? { attention: p.markers.attention, done: p.markers.done } : null), [p]);

  const ringGroups = useRef<(THREE.Group | null)[]>([]);
  const gyroRef = useRef<THREE.Group>(null);
  const beadRefs = useRef<(THREE.Mesh | null)[]>([]);
  const pulseRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRef = useRef<THREE.Mesh>(null);
  // Run lights travel the rings only while runs are live; the sculpture itself always moves (unless reduced motion).
  const spin = view.connection === "live" && view.running > 0 && !reduced;
  const lights = view.connection === "live" ? Math.min(view.running, MAX_RING_LIGHTS) : 0;
  const pathByKey = useMemo(() => new Map(paths.map((q) => [q.key, q])), [paths]);
  const activePulses = effects.pulses.filter((x) => pathByKey.has(x.buildingKey));

  // Static placement (reduced motion, or before the first frame): lights spaced evenly.
  useEffect(() => {
    beadRefs.current.forEach((b, i) => {
      if (!b) return;
      const ring = i % 3;
      const k = Math.floor(i / 3);
      const r = PLAZA.ringRadii[ring];
      const a = (k / 3) * Math.PI * 2 + ring * 0.7;
      b.position.set(r * Math.cos(a), r * Math.sin(a), 0);
    });
    invalidate();
  }, [lights, invalidate]);
  useEffect(() => invalidate(), [effects, view, invalidate]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (!reduced) {
      // Outer motion: the whole gyroscope turns slowly round the lantern's upright axis.
      if (gyroRef.current) gyroRef.current.rotation.y = t * PLAZA_MOTION.orbit;
      // Inner motion: each ring tumbles on its own tilted axis, neighbours in opposite directions.
      ringGroups.current.forEach((grp, i) => {
        if (grp) grp.rotation.z = t * PLAZA_MOTION.tumble[i] * (i % 2 ? -1 : 1);
      });
    }
    if (spin) {
      beadRefs.current.forEach((b, i) => {
        if (!b || !b.visible) return;
        const ring = i % 3;
        const k = Math.floor(i / 3);
        const r = PLAZA.ringRadii[ring];
        const a = (k / 3) * Math.PI * 2 + ring * 0.7 + t * 0.6;
        b.position.set(r * Math.cos(a), r * Math.sin(a), 0);
      });
    }
    if (!reduced) {
      const now = performance.now();
      activePulses.forEach((x, i) => {
        const mesh = pulseRefs.current[i];
        const q = pathByKey.get(x.buildingKey);
        if (!mesh || !q) return;
        const u = Math.min(1, (now - x.at) / PULSE_MS);
        mesh.position.set(q.from[0] + (q.to[0] - q.from[0]) * u, GROUND + 0.12, q.from[1] + (q.to[1] - q.from[1]) * u);
        mesh.visible = u < 1;
      });
      const glow = glowRef.current;
      if (glow && effects.glowAt !== null) (glow.material as THREE.MeshBasicMaterial).opacity = 0.75 * Math.max(0, 1 - (now - effects.glowAt) / GLOW_MS);
    }
  });

  if (!p) return null;
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    pick.click(PLAZA_KEY, e);
  };
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    pick.over(PLAZA_KEY, e);
  };
  const handlers = { onClick, onPointerOver: onOver, onPointerOut: () => pick.out() };
  const K = PLAZA.sculptureScale;
  const ringY = TOP + PLAZA.ringHeight;
  const s = p.sign;
  const showAttention = view.attention > 0 && view.connection === "live";
  const showDone = effects.glowAt !== null && view.connection === "live";
  // Tilts that make the three rings interlock like a gyroscope.
  const tilts: [number, number, number][] = [
    [Math.PI / 2, 0, 0],
    [Math.PI / 2, Math.PI / 3, 0],
    [Math.PI / 2, -Math.PI / 3, 0],
  ];
  return (
    <group name="automation-plaza">
      {/* Paved disc, a lighter inner floor, and the steady gold inlay ring (decorative). */}
      <mesh geometry={kit.disc} position={[p.cx, GROUND, p.cz]} scale={[PLAZA.radius, PLAZA.rise, PLAZA.radius]} receiveShadow raycast={() => null}>
        <meshStandardMaterial attach="material" color={C.paving} roughness={0.8} />
      </mesh>
      <mesh geometry={kit.disc} position={[p.cx, GROUND + 0.002, p.cz]} scale={[PLAZA.bedInner - 0.04, PLAZA.rise + 0.002, PLAZA.bedInner - 0.04]} receiveShadow raycast={() => null}>
        <meshStandardMaterial attach="material" color={C.stone} roughness={0.7} />
      </mesh>
      <mesh geometry={kit.inlay} material={kit.warm} position={[p.cx, TOP + 0.006, p.cz]} raycast={() => null} />
      <mesh geometry={kit.pavingRing} material={kit.gold} position={[p.cx, TOP + 0.007, p.cz]} raycast={() => null} />
      {night && <mesh geometry={kit.poolDisc} material={kit.pool} position={[p.cx, TOP + 0.008, p.cz]} renderOrder={1} raycast={() => null} />}
      {night && <mesh geometry={kit.haloDisc} material={kit.halo} position={[p.cx, GROUND + 0.01, p.cz]} renderOrder={1} raycast={() => null} />}
      {night && <mesh geometry={kit.poolSpill} material={kit.pool} position={[p.cx, GROUND + 0.012, p.cz]} renderOrder={1} raycast={() => null} />}
      <Instanced items={parts.solid} geometry={g.box} material={m.plain} />
      <Instanced items={parts.posts} geometry={g.box} material={m.plain} />
      <Instanced items={parts.lamps} geometry={g.bead} material={night ? m.lamp : m.plain} shadow={false} />
      <Instanced items={parts.path} geometry={g.box} material={kit.pathGlow} shadow={false} />

      {/* The sculpture: pedestal, glass enclosure, three gold rings. Clicking any of it opens the panel. */}
      <group position={[p.cx, TOP, p.cz]}>
        <mesh geometry={kit.disc} material={kit.stone} scale={[PLAZA.pedestalRadius, 0.16 * K, PLAZA.pedestalRadius]} castShadow receiveShadow {...handlers} />
        <mesh geometry={kit.disc} material={kit.stone} position={[0, 0.16 * K, 0]} scale={[PLAZA.pedestalRadius * 0.7, 0.06 * K, PLAZA.pedestalRadius * 0.7]} castShadow {...handlers} />
        <mesh geometry={kit.disc} material={kit.gold} position={[0, 0.22 * K, 0]} scale={[0.018 * K, PLAZA.enclosureHeight - 0.1 - 0.22 * K, 0.018 * K]} raycast={() => null} />
        <mesh geometry={kit.glowRing} material={kit.warm} position={[0, 0.006, 0]} scale={[K, 1, K]} raycast={() => null} />
        {/* Completion: a brief green glow round the pedestal, only for a completion Atlas observed. */}
        {showDone && <mesh ref={glowRef} geometry={kit.glowRing} material={kit.done} position={[0, 0.012, 0]} scale={[K, 1, K]} raycast={() => null} />}
        <group ref={gyroRef} position={[0, ringY - TOP, 0]}>
          {tilts.map((r, i) => (
            <group key={i} rotation={r}>
              <group ref={(el) => (ringGroups.current[i] = el)}>
                <mesh geometry={kit.rings[i]} material={kit.gold} castShadow {...handlers} />
                {/* Running: small gold lights on the rings, one per run, at most three a ring. */}
                {[0, 1, 2].map((k) => {
                  const n = k * 3 + i;
                  return <mesh key={k} ref={(el) => (beadRefs.current[n] = el)} geometry={kit.bead} material={kit.runLight} scale={0.055 * K} visible={n < lights} raycast={() => null} />;
                })}
              </group>
            </group>
          ))}
        </group>
        {/* A warm glowing floor inside the glass, and a gold collar at its foot. */}
        <mesh geometry={kit.floorGlow} material={kit.floorLight} position={[0, 0.004, 0]} raycast={() => null} />
        <mesh geometry={kit.band} material={kit.gold} scale={[1, 0.14, 1]} castShadow {...handlers} />
        <mesh geometry={kit.glassTube} material={kit.glass} position={[0, 0.02, 0]} renderOrder={2} {...handlers} />
        {night && <mesh geometry={kit.coreTube} material={kit.core} position={[0, 0.02, 0]} renderOrder={3} raycast={() => null} />}
        {night && <mesh geometry={kit.beamTube} material={kit.beam} position={[0, 0.02, 0]} renderOrder={3} raycast={() => null} />}
        <mesh geometry={kit.rim} material={kit.gold} position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null} />
        <mesh geometry={kit.rim} material={kit.gold} position={[0, 0.02 + PLAZA.enclosureHeight / 2, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null} />
        <mesh geometry={kit.rim} material={kit.gold} position={[0, 0.02 + PLAZA.enclosureHeight, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null} />
        {/* Concept B's top: a shallow gold saucer just inside the open rim, its low dome meeting the mast. */}
        <mesh geometry={kit.disc} material={kit.gold} position={[0, 0.02 + PLAZA.enclosureHeight - 0.1, 0]} scale={[PLAZA.enclosureRadius * CROWN_DISC, 0.04, PLAZA.enclosureRadius * CROWN_DISC]} castShadow {...handlers} />
        <mesh geometry={kit.saucerDome} material={kit.gold} position={[0, 0.02 + PLAZA.enclosureHeight - 0.04, 0]} castShadow {...handlers} />
      </group>

      {/* The sign's live face. */}
      <mesh
        geometry={kit.face}
        material={kit.signFace}
        position={[s.x + Math.sin(s.ry) * 0.037, GROUND + 0.14 + s.h / 2, s.z + Math.cos(s.ry) * 0.037]}
        rotation={[0, s.ry, 0]}
        scale={[s.w - 0.02, s.h - 0.02, 1]}
        {...handlers}
      />

      {/* Needs attention or failed: an amber marker with "!"; the reason is on the sign and in the panel. */}
      {markerPosts && showAttention && (
        <group position={[markerPosts.attention[0], GROUND, markerPosts.attention[1]]}>
          <mesh geometry={g.box} material={kit.stone} scale={[0.12, 0.36, 0.12]} castShadow {...handlers} />
          <mesh geometry={kit.face} material={kit.attentionFace} position={[Math.sin(s.ry) * 0.065, 0.48, Math.cos(s.ry) * 0.065]} rotation={[0, s.ry, 0]} scale={0.2} {...handlers} />
          <mesh geometry={g.box} material={kit.amber} position={[0, 0.36, 0]} scale={[0.13, 0.03, 0.13]} raycast={() => null} />
        </group>
      )}
      {markerPosts && showDone && (
        <group position={[markerPosts.done[0], GROUND, markerPosts.done[1]]}>
          <mesh geometry={g.box} material={kit.stone} scale={[0.12, 0.32, 0.12]} raycast={() => null} />
          <mesh geometry={kit.face} material={kit.doneFace} position={[Math.sin(s.ry) * 0.065, 0.44, Math.cos(s.ry) * 0.065]} rotation={[0, s.ry, 0]} scale={0.18} raycast={() => null} />
          <mesh geometry={g.box} material={kit.green} position={[0, 0.32, 0]} scale={[0.13, 0.03, 0.13]} raycast={() => null} />
        </group>
      )}

      {/* Handoffs: a light travelling to the receiving building, or with reduced motion its path lit for a moment. */}
      {activePulses.map((x, i) => {
        const q = pathByKey.get(x.buildingKey)!;
        if (reduced) return <Instanced key={x.id} items={[strip(q.from, q.to, PLAZA.pathWidth * 1.6, GROUND + 0.055, 0.014)]} geometry={g.box} material={kit.pathLit} shadow={false} />;
        return <mesh key={x.id} ref={(el) => (pulseRefs.current[i] = el)} geometry={kit.bead} material={kit.pulse} scale={0.1} position={[q.from[0], GROUND + 0.09, q.from[1]]} raycast={() => null} />;
      })}
    </group>
  );
}
