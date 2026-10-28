import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { focusable, night } from "./materials";
import type { useGeometries, useMaterials } from "./models";
import { TERRACE_H, WATER_Y, type Scene3D } from "./scene";
import { planVehicles, vehicleAt, type VehicleKind } from "./vehicles";

type G = ReturnType<typeof useGeometries>;
type M = ReturnType<typeof useMaterials>;
export type LightMode = "day" | "night";

const c = (hex: string) => new THREE.Color(hex);
const DAY = { bg: c("#d3e4de"), sky: c("#fff7e6"), ground: c("#6b8456"), hemi: 1.35, amb: c("#ffffff"), ambI: 0.2, sun: c("#fff0d2"), sunI: 2.5 };
const NIGHT = { bg: c("#0f1a2e"), sky: c("#8ea2d6"), ground: c("#24323f"), hemi: 0.52, amb: c("#6f86c0"), ambI: 0.16, sun: c("#a9bcff"), sunI: 0.45 };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Day and night: eases the sky, fog, lights and every night-aware material between the two
 * moods. Shaders read the shared `night` uniform, so most of the work is one number.
 */
export function Sky({ mode, reduced, m, sun, fog }: { mode: LightMode; reduced: boolean; m: M; sun: React.RefObject<THREE.DirectionalLight>; fog: THREE.Fog }) {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const moon = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const { scene } = useThree();
  const bg = useMemo(() => DAY.bg.clone(), []);
  const first = useRef(true);
  const last = useRef(-1);
  useEffect(() => {
    scene.background = bg;
    return () => {
      scene.background = null;
    };
  }, [scene, bg]);

  useFrame((_, dt) => {
    const target = mode === "night" ? 1 : 0;
    // Open in the saved mood without a transition; ease over about two seconds after that.
    if (first.current || reduced) night.value = target;
    else night.value += (target - night.value) * (1 - Math.exp(-Math.min(dt, 0.1) * 2.2));
    first.current = false;
    if (Math.abs(night.value - target) < 0.002) night.value = target;
    const k = night.value;
    if (k === last.current || !hemi.current || !amb.current || !sun.current || !moon.current) return;
    last.current = k;
    bg.lerpColors(DAY.bg, NIGHT.bg, k);
    fog.color.copy(bg);
    hemi.current.color.lerpColors(DAY.sky, NIGHT.sky, k);
    hemi.current.groundColor.lerpColors(DAY.ground, NIGHT.ground, k);
    hemi.current.intensity = lerp(DAY.hemi, NIGHT.hemi, k);
    amb.current.color.lerpColors(DAY.amb, NIGHT.amb, k);
    amb.current.intensity = lerp(DAY.ambI, NIGHT.ambI, k);
    sun.current.color.lerpColors(DAY.sun, NIGHT.sun, k);
    sun.current.intensity = lerp(DAY.sunI, NIGHT.sunI, k);
    // A cool moonlight from the side, so the faces of each building read apart at night.
    moon.current.intensity = k * 0.5;
    moon.current.visible = k > 0.01;
    m.glass.emissiveIntensity = lerp(0.35, 1.7, k);
    m.lamp.emissiveIntensity = lerp(0.8, 3.4, k);
    m.pool.opacity = k * 0.42;
    m.pool.visible = k > 0.02;
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={[DAY.sky, DAY.ground, DAY.hemi]} />
      <ambientLight ref={amb} intensity={DAY.ambI} />
      <directionalLight ref={moon} position={[60, 45, -25]} color="#9fb6ff" intensity={0} />
    </>
  );
}

const BOATS = 3;
const BOAT_SPEED = 0.22;
const STROLL_SPEED = 0.12;
const CLOTHES = ["#c96f53", "#4f78a8", "#e0c068", "#6d9b6a", "#9a74b8"];

/**
 * Quiet background life: a few boats circling offshore and people strolling the walkways.
 * Decorative only, never tied to project data. Frozen in place when motion is off.
 */
export function Traffic({ scene, g, m, moving }: { scene: Scene3D; g: G; m: M; moving: boolean }) {
  const hull = useRef<THREE.InstancedMesh>(null);
  const cabin = useRef<THREE.InstancedMesh>(null);
  const light = useRef<THREE.InstancedMesh>(null);
  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const walkers = useMemo(() => scene.walks.filter((_, i) => i % 2 === 0), [scene]);

  // A rounded loop around the island, clear of the cliffs and waterfalls.
  const loop = useMemo(() => {
    const b = scene.bounds;
    const pad = 2.6;
    const curve = new THREE.CatmullRomCurve3(
      [
        [b.x0 - pad, b.z0 - pad],
        [(b.x0 + b.x1) / 2, b.z0 - pad * 1.3],
        [b.x1 + pad, b.z0 - pad],
        [b.x1 + pad * 1.3, (b.z0 + b.z1) / 2],
        [b.x1 + pad, b.z1 + pad],
        [(b.x0 + b.x1) / 2, b.z1 + pad * 1.3],
        [b.x0 - pad, b.z1 + pad],
        [b.x0 - pad * 1.3, (b.z0 + b.z1) / 2],
      ].map(([x, z]) => new THREE.Vector3(x, WATER_Y + 0.02, z)),
      true,
      "centripetal",
    );
    return { curve, length: curve.getLength() };
  }, [scene]);

  const o = useMemo(() => new THREE.Object3D(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const tan = useMemo(() => new THREE.Vector3(), []);
  const clock = useRef(0);

  const place = (t: number) => {
    const h = hull.current;
    const cb = cabin.current;
    const l = light.current;
    if (h && cb && l) {
      for (let i = 0; i < BOATS; i++) {
        const u = (((t * BOAT_SPEED) / loop.length + i / BOATS) % 1 + 1) % 1;
        loop.curve.getPointAt(u, p);
        loop.curve.getTangentAt(u, tan);
        const yaw = Math.atan2(-tan.z, tan.x);
        const bob = Math.sin(t * 1.3 + i * 2) * 0.012;
        o.rotation.set(0, yaw, Math.sin(t * 0.9 + i) * 0.03);
        o.position.set(p.x, p.y + bob, p.z);
        o.scale.set(0.62, 0.1, 0.24);
        o.updateMatrix();
        h.setMatrixAt(i, o.matrix);
        o.position.set(p.x - Math.cos(yaw) * 0.08, p.y + 0.1 + bob, p.z + Math.sin(yaw) * 0.08);
        o.scale.set(0.2, 0.09, 0.16);
        o.updateMatrix();
        cb.setMatrixAt(i, o.matrix);
        o.position.set(p.x + Math.cos(yaw) * 0.26, p.y + 0.13 + bob, p.z - Math.sin(yaw) * 0.26);
        o.scale.setScalar(0.022);
        o.updateMatrix();
        l.setMatrixAt(i, o.matrix);
      }
      h.instanceMatrix.needsUpdate = cb.instanceMatrix.needsUpdate = l.instanceMatrix.needsUpdate = true;
    }
    const bd = body.current;
    const hd = head.current;
    if (bd && hd) {
      walkers.forEach((w, i) => {
        const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
        // Walk to the end, pause, walk back.
        const period = (len / STROLL_SPEED) * 2 + 6;
        const ph = (((t + i * 7.3) % period) + period) % period;
        const leg = len / STROLL_SPEED;
        const f = ph < leg ? ph / leg : ph < leg + 3 ? 1 : ph < leg * 2 + 3 ? 1 - (ph - leg - 3) / leg : 0;
        const side = (ph < leg + 3 ? 1 : -1) * 0.1;
        const dx = (w.x1 - w.x0) / (len || 1);
        const dz = (w.z1 - w.z0) / (len || 1);
        const x = w.x0 + (w.x1 - w.x0) * f - dz * side;
        const z = w.z0 + (w.z1 - w.z0) * f + dx * side;
        const step = moving ? Math.abs(Math.sin(t * 7 + i)) * 0.008 : 0;
        o.rotation.set(0, 0, 0);
        o.position.set(x, 0.02 + step, z);
        o.scale.set(0.05, 0.12, 0.05);
        o.updateMatrix();
        bd.setMatrixAt(i, o.matrix);
        o.position.set(x, 0.17 + step, z);
        o.scale.setScalar(0.028);
        o.updateMatrix();
        hd.setMatrixAt(i, o.matrix);
      });
      bd.instanceMatrix.needsUpdate = hd.instanceMatrix.needsUpdate = true;
    }
  };

  useEffect(() => {
    const c = new THREE.Color();
    walkers.forEach((_, i) => body.current?.setColorAt(i, c.set(CLOTHES[i % CLOTHES.length])));
    if (body.current?.instanceColor) body.current.instanceColor.needsUpdate = true;
    walkers.forEach((_, i) => head.current?.setColorAt(i, c.set(i % 3 ? "#e3b994" : "#9c6b4a")));
    if (head.current?.instanceColor) head.current.instanceColor.needsUpdate = true;
    for (let i = 0; i < BOATS; i++) hull.current?.setColorAt(i, c.set(i % 2 ? "#f4f1e8" : "#e9e2cf"));
    if (hull.current?.instanceColor) hull.current.instanceColor.needsUpdate = true;
    place(clock.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkers, loop]);

  useFrame((_, dt) => {
    if (!moving) return;
    clock.current += Math.min(dt, 0.1);
    place(clock.current);
  });

  return (
    <group>
      <instancedMesh ref={hull} args={[g.box, m.plain, BOATS]} castShadow frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={cabin} args={[g.box, m.plain, BOATS]} castShadow frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={light} args={[g.ball, m.lamp, BOATS]} frustumCulled={false} raycast={() => null} />
      {walkers.length > 0 && (
        <>
          <instancedMesh ref={body} args={[g.cyl, m.plain, walkers.length]} frustumCulled={false} raycast={() => null} />
          <instancedMesh ref={head} args={[g.ball, m.foliage, walkers.length]} frustumCulled={false} raycast={() => null} />
        </>
      )}
    </group>
  );
}

/**
 * A light bloom at night, only on what is brighter than the scene: lit windows, path lights and
 * connections. By day, and while the bloom is off, the map renders directly.
 */
export function Bloom() {
  const { gl, scene, camera, size } = useThree();
  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0, 0.35, 0.9);
    c.addPass(bloom);
    c.addPass(new OutputPass());
    return { c, bloom };
  }, [gl, scene, camera]);
  useEffect(() => {
    const dpr = gl.getPixelRatio();
    composer.c.setPixelRatio(dpr);
    composer.c.setSize(size.width, size.height);
    // Half resolution is plenty for a soft glow and keeps it cheap.
    composer.bloom.resolution.set((size.width * dpr) / 2, (size.height * dpr) / 2);
  }, [composer, gl, size]);
  useEffect(() => () => composer.c.dispose(), [composer]);
  // Priority 1 takes over rendering from the default loop.
  useFrame(() => {
    const k = night.value;
    if (k < 0.02) return gl.render(scene, camera);
    composer.bloom.strength = k * 0.32;
    composer.c.render();
  }, 1);
  return null;
}

/** One box of a vehicle, in its own frame: forward is +x, up is +y, bottom-anchored. */
type Part = { at: [number, number, number]; size: [number, number, number]; color: string | null };

/** Models are drawn at this size; the path lanes leave room for it. */
const SCALE = 1.35;
const TIRE = "#262b2e";
const GLASS = "#3d4d55";
const TRIM = "#ece3cc";
const wheels = (dx: number): Part[] =>
  [-1, 1].flatMap((f) => [-1, 1].map((sd) => ({ at: [f * dx, 0, sd * 0.045], size: [0.044, 0.04, 0.022], color: TIRE }) as Part));

/** Low-poly models; null color means the vehicle's own paint. */
const MODELS: Record<VehicleKind, { parts: Part[]; nose: number; lightY: number }> = {
  sedan: {
    parts: [
      ...wheels(0.06),
      { at: [0, 0.014, 0], size: [0.2, 0.044, 0.1], color: null },
      { at: [-0.012, 0.058, 0], size: [0.11, 0.038, 0.088], color: GLASS },
      { at: [-0.012, 0.096, 0], size: [0.096, 0.008, 0.078], color: null },
    ],
    nose: 0.1,
    lightY: 0.036,
  },
  van: {
    parts: [
      ...wheels(0.075),
      { at: [0, 0.014, 0], size: [0.24, 0.098, 0.106], color: null },
      { at: [0.106, 0.064, 0], size: [0.03, 0.036, 0.098], color: GLASS },
      { at: [0.065, 0.068, 0], size: [0.05, 0.03, 0.109], color: GLASS },
      { at: [-0.04, 0.05, 0], size: [0.12, 0.012, 0.109], color: TRIM },
    ],
    nose: 0.12,
    lightY: 0.04,
  },
  service: {
    parts: [
      ...wheels(0.08),
      { at: [0.07, 0.014, 0], size: [0.1, 0.088, 0.106], color: null },
      { at: [0.098, 0.064, 0], size: [0.046, 0.03, 0.109], color: GLASS },
      { at: [-0.056, 0.014, 0], size: [0.15, 0.05, 0.106], color: TRIM },
      { at: [-0.056, 0.064, 0], size: [0.11, 0.03, 0.08], color: "#7f8a83" },
      { at: [0.07, 0.102, 0], size: [0.026, 0.014, 0.05], color: "#c9a35a" },
    ],
    nose: 0.12,
    lightY: 0.04,
  },
};

/**
 * Miniature sedans, vans and service vehicles touring the districts' stone paths, with headlights
 * and taillights at night. Decorative only: their routes come from the map's paths, never from
 * project data or agent activity. Frozen in place when motion is off.
 */
export function Vehicles({ scene, g, m, moving }: { scene: Scene3D; g: G; m: M; moving: boolean }) {
  const plans = useMemo(() => planVehicles(scene), [scene]);
  const parts = useMemo(() => plans.flatMap((v, i) => MODELS[v.kind].parts.map((p) => ({ v: i, p, color: p.color ?? v.color }))), [plans]);
  const mats = useMemo(
    () => ({
      head: focusable(new THREE.MeshStandardMaterial({ color: "#f3ead4", emissive: "#fff1d2", emissiveIntensity: 0, roughness: 0.4 })),
      tail: focusable(new THREE.MeshStandardMaterial({ color: "#7a2c27", emissive: "#ff4434", emissiveIntensity: 0, roughness: 0.5 })),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((x) => x.dispose()), [mats]);
  const body = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const tails = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => ({ base: new THREE.Matrix4(), part: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, "YZX"), p: new THREE.Vector3(), s: new THREE.Vector3(), one: new THREE.Quaternion() }), []);
  const clock = useRef(0);
  const yaw = useRef<number[]>([]);
  const pitch = useRef<number[]>([]);
  const y0 = TERRACE_H + 0.03;

  const place = (dt: number) => {
    const b = body.current;
    const h = heads.current;
    const t = tails.current;
    const pl = pools.current;
    if (!b || !h || !t || !pl) return;
    // Turn and tilt smoothly toward the way ahead; snap when there is no time step (first frame, frozen).
    const ease = (cur: number | undefined, want: number, rate: number) => {
      if (cur === undefined || dt <= 0) return want;
      const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      return cur + diff * (1 - Math.exp(-dt * rate));
    };
    const pose = plans.map((v, i) => {
      const at = vehicleAt(v, clock.current);
      yaw.current[i] = ease(yaw.current[i], Math.atan2(-at.dz, at.dx), 7);
      pitch.current[i] = ease(pitch.current[i], Math.atan(at.slope), 10);
      tmp.e.set(0, yaw.current[i], pitch.current[i]);
      return new THREE.Matrix4().compose(tmp.p.set(at.x, y0 + at.y, at.z), tmp.q.setFromEuler(tmp.e), tmp.s.set(1, 1, 1));
    });
    // Each part in its vehicle's own frame: forward x, up y, across z.
    const put = (mesh: THREE.InstancedMesh, k: number, i: number, fx: number, y: number, sz: number, sx: number, sy: number, szz: number) => {
      tmp.part.compose(tmp.p.set(fx * SCALE, y * SCALE, sz * SCALE), tmp.one, tmp.s.set(sx * SCALE, sy * SCALE, szz * SCALE));
      mesh.setMatrixAt(k, tmp.base.multiplyMatrices(pose[i], tmp.part));
    };
    parts.forEach(({ v, p }, k) => put(b, k, v, p.at[0], p.at[1], p.at[2], p.size[0], p.size[1], p.size[2]));
    plans.forEach((v, i) => {
      const md = MODELS[v.kind];
      for (const sd of [0, 1]) {
        const z = sd ? 0.032 : -0.032;
        put(h, i * 2 + sd, i, md.nose, md.lightY, z, 0.012, 0.012, 0.012);
        put(t, i * 2 + sd, i, -md.nose - 0.002, md.lightY - 0.006, z, 0.006, 0.012, 0.02);
      }
      // A soft pool of headlight on the paving ahead, only visible at night.
      put(pl, i, i, md.nose + 0.13, 0.004, 0, 0.26, 0.003, 0.15);
    });
    b.instanceMatrix.needsUpdate = h.instanceMatrix.needsUpdate = t.instanceMatrix.needsUpdate = pl.instanceMatrix.needsUpdate = true;
  };

  useEffect(() => {
    const col = new THREE.Color();
    parts.forEach(({ color }, k) => body.current?.setColorAt(k, col.set(color)));
    if (body.current?.instanceColor) body.current.instanceColor.needsUpdate = true;
    yaw.current = [];
    pitch.current = [];
    place(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts]);

  useFrame((_, delta) => {
    const k = night.value;
    // Restrained: a warm glow at night, nothing by day.
    mats.head.emissiveIntensity = k * 2.2;
    mats.tail.emissiveIntensity = k * 1.3;
    if (!moving) return;
    const dt = Math.min(delta, 0.1);
    clock.current += dt;
    place(dt);
  });

  if (!plans.length) return null;
  return (
    <group>
      <instancedMesh ref={body} args={[g.box, m.plain, parts.length]} castShadow frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={heads} args={[g.ball, mats.head, plans.length * 2]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={tails} args={[g.box, mats.tail, plans.length * 2]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={pools} args={[g.cyl, m.pool, plans.length]} frustumCulled={false} raycast={() => null} />
    </group>
  );
}
