import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { night } from "./materials";
import type { useGeometries, useMaterials } from "./models";
import { WATER_Y, type Scene3D } from "./scene";

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
    m.pool.opacity = k * 0.62;
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
 * A light bloom at night, only on what is brighter than the scene: lit windows, lamps and the
 * connection traces. By day, and while the bloom is off, the map renders directly.
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
