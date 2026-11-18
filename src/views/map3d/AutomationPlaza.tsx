import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { TERRACE_H } from "./scene";
import { Instanced, type Inst, type Pick, type useGeometries, type useMaterials } from "./models";
import { PLAZA, PLAZA_KEY, type PlazaPlan } from "./plazaPlan";
import type { Pt } from "./roads";
import type { PlazaEffects } from "../../plaza/usePlaza";
import { GLOW_MS, PULSE_MS } from "../../plaza/usePlaza";

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

const GROUND = TERRACE_H;
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
 * gyroscope rings on a cream stone pedestal. Decorative light (lamps, the gold paths, the
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
  /** The gold paths drawn: to buildings that run automations. */
  paths: PlazaPlan["paths"];
  reduced: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);

  // Geometry and materials made once, disposed on unmount.
  const kit = useMemo(() => {
    const disc = new THREE.CylinderGeometry(1, 1, 1, 56).translate(0, 0.5, 0);
    const glassTube = new THREE.CylinderGeometry(PLAZA.enclosureRadius, PLAZA.enclosureRadius, PLAZA.enclosureHeight, 40, 1, true).translate(0, PLAZA.enclosureHeight / 2, 0);
    const rings = PLAZA.ringRadii.map((r) => new THREE.TorusGeometry(r, PLAZA.ringTube, 8, 56));
    const rim = new THREE.TorusGeometry(PLAZA.enclosureRadius, 0.022, 6, 48);
    const glowRing = new THREE.RingGeometry(0.42, 0.7, 48).rotateX(-Math.PI / 2);
    const inlay = new THREE.RingGeometry(PLAZA.bedInner - 0.1, PLAZA.bedInner - 0.06, 64).rotateX(-Math.PI / 2);
    const bead = new THREE.SphereGeometry(1, 10, 8);
    const face = new THREE.PlaneGeometry(1, 1);
    const glass = new THREE.MeshStandardMaterial({ color: "#d9ecf2", transparent: true, opacity: 0.3, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const gold = new THREE.MeshStandardMaterial({ color: "#d9b468", metalness: 0.55, roughness: 0.3, emissive: "#8a6420", emissiveIntensity: 0.2 });
    const stone = new THREE.MeshStandardMaterial({ color: C.cream, roughness: 0.75 });
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
    return { disc, glassTube, rings, rim, glowRing, inlay, bead, face, glass, gold, stone, pathGlow, warm, runLight, pulse, pathLit, done, amber, green, attentionFace, doneFace, canvas, signTex, signFace };
  }, []);
  useEffect(
    () => () => {
      for (const v of Object.values(kit)) if (v && typeof (v as { dispose?: () => void }).dispose === "function") (v as { dispose: () => void }).dispose();
      for (const r of kit.rings) r.dispose();
      kit.attentionFace.map?.dispose();
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
    invalidate();
  }, [kit, night, invalidate]);

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
    // Slim gold mullions so the clear enclosure reads as glass panes.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.31;
      solid.push({ p: [cx + PLAZA.enclosureRadius * Math.cos(a), TOP + 0.02, cz + PLAZA.enclosureRadius * Math.sin(a)], s: [0.012, PLAZA.enclosureHeight, 0.012], r: -a, c: "#c9a35a" });
    }
    // Gold paths to the buildings that run automations, a hair above what they cross.
    for (const q of paths) path.push(strip(q.from, q.to, PLAZA.pathWidth, GROUND + 0.05, 0.012));
    return { solid, lamps, posts, path };
  }, [p, paths]);

  // Marker posts (attention and completed), each a short pillar under its badge.
  const markerPosts = useMemo(() => (p ? { attention: p.markers.attention, done: p.markers.done } : null), [p]);

  const ringGroups = useRef<(THREE.Group | null)[]>([]);
  const beadRefs = useRef<(THREE.Mesh | null)[]>([]);
  const pulseRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRef = useRef<THREE.Mesh>(null);
  const spin = view.connection === "live" && view.running > 0 && !reduced;
  const lights = view.connection === "live" ? Math.min(view.running, MAX_RING_LIGHTS) : 0;
  const pathByKey = useMemo(() => new Map(paths.map((q) => [q.key, q])), [paths]);
  const activePulses = effects.pulses.filter((x) => pathByKey.has(x.buildingKey));

  // Static placement (reduced motion, idle): lights spaced evenly, rings at rest.
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
    if (spin) {
      ringGroups.current.forEach((grp, i) => {
        if (grp) grp.rotation.z = t * (0.22 + i * 0.07) * (i % 2 ? -1 : 1);
      });
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
  const ringY = TOP + 0.2 + PLAZA.ringHeight;
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
      <Instanced items={parts.solid} geometry={g.box} material={m.plain} />
      <Instanced items={parts.posts} geometry={g.box} material={m.plain} />
      <Instanced items={parts.lamps} geometry={g.bead} material={night ? m.lamp : m.plain} shadow={false} />
      <Instanced items={parts.path} geometry={g.box} material={kit.pathGlow} shadow={false} />

      {/* The sculpture: pedestal, glass enclosure, three gold rings. Clicking any of it opens the panel. */}
      <group position={[p.cx, TOP, p.cz]}>
        <mesh geometry={kit.disc} material={kit.stone} scale={[PLAZA.pedestalRadius, 0.16, PLAZA.pedestalRadius]} castShadow receiveShadow {...handlers} />
        <mesh geometry={kit.disc} material={kit.stone} position={[0, 0.16, 0]} scale={[PLAZA.pedestalRadius * 0.7, 0.06, PLAZA.pedestalRadius * 0.7]} castShadow {...handlers} />
        <mesh geometry={kit.disc} material={kit.gold} position={[0, 0.22, 0]} scale={[0.018, PLAZA.ringHeight, 0.018]} raycast={() => null} />
        <mesh geometry={kit.glowRing} material={kit.warm} position={[0, 0.006, 0]} raycast={() => null} />
        {/* Completion: a brief green glow round the pedestal, only for a completion Atlas observed. */}
        {showDone && <mesh ref={glowRef} geometry={kit.glowRing} material={kit.done} position={[0, 0.012, 0]} raycast={() => null} />}
        <group position={[0, ringY - TOP, 0]}>
          {tilts.map((r, i) => (
            <group key={i} rotation={r}>
              <group ref={(el) => (ringGroups.current[i] = el)}>
                <mesh geometry={kit.rings[i]} material={kit.gold} castShadow {...handlers} />
                {/* Running: small gold lights on the rings, one per run, at most three a ring. */}
                {[0, 1, 2].map((k) => {
                  const n = k * 3 + i;
                  return <mesh key={k} ref={(el) => (beadRefs.current[n] = el)} geometry={kit.bead} material={kit.runLight} scale={0.055} visible={n < lights} raycast={() => null} />;
                })}
              </group>
            </group>
          ))}
        </group>
        <mesh geometry={kit.glassTube} material={kit.glass} position={[0, 0.02, 0]} renderOrder={2} {...handlers} />
        <mesh geometry={kit.rim} material={kit.gold} position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null} />
        <mesh geometry={kit.rim} material={kit.gold} position={[0, 0.02 + PLAZA.enclosureHeight, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null} />
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
