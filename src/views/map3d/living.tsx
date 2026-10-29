import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { focusable, night } from "./materials";
import { Instanced, type Inst, type useGeometries, type useMaterials } from "./models";
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

const BOATS = 8;
const BOAT_SPEED = 0.22;
const STROLL_SPEED = 0.12;
const CLOTHES = ["#c96f53", "#4f78a8", "#e0c068", "#6d9b6a", "#9a74b8"];

/**
 * Quiet background life: a few boats circling offshore and people strolling the walkways.
 * Decorative only, never tied to project data. Frozen in place when motion is off.
 */
export function Traffic({ scene, g, m, moving }: { scene: Scene3D; g: G; m: M; moving: boolean }) {
  const hull = useRef<THREE.InstancedMesh>(null);
  const yachtDeck = useRef<THREE.InstancedMesh>(null);
  const yachtRoof = useRef<THREE.InstancedMesh>(null);
  const boatGeometry = useMemo(() => {
    const shape=new THREE.Shape();
    shape.moveTo(-0.48,-0.38);shape.lineTo(0.12,-0.46);shape.quadraticCurveTo(0.39,-0.32,0.56,0);shape.quadraticCurveTo(0.39,0.32,0.12,0.46);shape.lineTo(-0.48,0.38);shape.quadraticCurveTo(-0.56,0,-0.48,-0.38);
    const hull=new THREE.ExtrudeGeometry(shape,{depth:0.7,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:0.07,bevelThickness:0.15,curveSegments:8});
    hull.rotateX(-Math.PI/2);hull.translate(0,0.15,0);
    const profile=new THREE.Shape(); profile.moveTo(-0.5,0);profile.lineTo(0.5,0);profile.lineTo(0.22,0.8);profile.lineTo(-0.35,1);profile.closePath();
    const cabin=new THREE.ExtrudeGeometry(profile,{depth:1,bevelEnabled:false});cabin.translate(0,0,-0.5);
    return {hull,cabin};
  },[]);
  useEffect(()=>()=>{boatGeometry.hull.dispose();boatGeometry.cabin.dispose();},[boatGeometry]);
  const cabin = useRef<THREE.InstancedMesh>(null);
  const light = useRef<THREE.InstancedMesh>(null);
  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const passengers = useRef<THREE.InstancedMesh>(null);
  const passengerHeads = useRef<THREE.InstancedMesh>(null);
  const walkers = useMemo(() => {
    const seen = new Set<string>();
    return scene.walks.filter(w => {
      const key = [w.x0,w.z0,w.x1,w.z1,w.y].join(":");
      if (seen.has(key) || Math.hypot(w.x1-w.x0,w.z1-w.z0)<0.02) return false;
      seen.add(key); return true;
    }).flatMap(w => [w,w]);
  }, [scene]);

  // A rounded loop around the island, clear of the cliffs and waterfalls.
  const loop = useMemo(() => {
    const b = scene.bounds;
    const pad = 4.6;
    const shore=scene.terraces.reduce((best,p)=>p.z+p.d>best.z+best.d?p:best,scene.terraces[0]);
    const harborX=shore ? shore.x+shore.w/2 : (b.x0+b.x1)/2;
    const shoreZ=shore ? shore.z+shore.d : b.z1;
    const coastZ=Math.max(shoreZ,...scene.land.filter(r=>harborX>=r.x && harborX<=r.x+r.w).map(r=>r.z+r.d));
    const pierZ=coastZ+1.8;
    const curve = new THREE.CatmullRomCurve3(
      [
        [b.x0 - pad, b.z0 - pad],
        [(b.x0 + b.x1) / 2, b.z0 - pad * 1.3],
        [b.x1 + pad, b.z0 - pad],
        [b.x1 + pad * 1.3, (b.z0 + b.z1) / 2],
        [b.x1 + pad, b.z1 + pad],
        [harborX, pierZ + 1.4],
        [b.x0 - pad, b.z1 + pad],
        [b.x0 - pad * 1.3, (b.z0 + b.z1) / 2],
      ].map(([x, z]) => new THREE.Vector3(x, WATER_Y + 0.02, z)),
      true,
      "centripetal",
    );
    const dockX=harborX, dockZ=pierZ+1.4;
    let dockU=0, nearest=Infinity;
    for(let i=0;i<=1000;i++) { const q=curve.getPointAt(i/1000); const d=Math.hypot(q.x-dockX,q.z-dockZ); if(d<nearest) { nearest=d;dockU=i/1000; } }
    return { curve, length: curve.getLength(), dockU, dockX, dockZ, pierZ, shoreZ };
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
        const travelTime=loop.length/BOAT_SPEED, cycle=travelTime+10;
        const phase=((t+i*cycle/BOATS)%cycle+cycle)%cycle;
        const travel=Math.max(0,phase-10)/travelTime;
        const easedTravel = travel - Math.sin(2*Math.PI*travel)/(2*Math.PI);
        const u=(loop.dockU+easedTravel)%1;
        loop.curve.getPointAt(u, p);
        loop.curve.getTangentAt(u, tan);
        const yaw = Math.atan2(-tan.z, tan.x);
        const bob = Math.sin(t * 1.3 + i * 2) * 0.012;
        o.rotation.set(0, yaw, Math.sin(t * 0.9 + i) * 0.03);
        o.position.set(p.x, p.y + bob, p.z);
        const size = 1 + (i % 3) * 0.18;
        o.scale.set(0.78*size, 0.12, 0.3*size);
        o.updateMatrix();
        h.setMatrixAt(i, o.matrix);
        o.position.set(p.x,p.y+0.11+bob,p.z);o.scale.set(0.76*size,0.025,0.28*size);o.updateMatrix();yachtDeck.current?.setMatrixAt(i,o.matrix);
        o.position.set(p.x - Math.cos(yaw) * 0.08, p.y + 0.1 + bob, p.z + Math.sin(yaw) * 0.08);
        o.scale.set(0.32*size, 0.15, 0.2*size);
        o.updateMatrix();
        cb.setMatrixAt(i, o.matrix);
        o.position.y=p.y+0.25+bob;o.scale.set(0.25*size,0.025,0.23*size);o.updateMatrix();yachtRoof.current?.setMatrixAt(i,o.matrix);
        o.position.set(p.x + Math.cos(yaw) * 0.26, p.y + 0.13 + bob, p.z - Math.sin(yaw) * 0.26);
        o.scale.setScalar(0.022);
        o.updateMatrix();
        l.setMatrixAt(i, o.matrix);
        for(let j=0;j<2;j++) {
          const along=(j?0.2:-0.2)*size;
          const px=p.x+Math.cos(yaw)*along, pz=p.z-Math.sin(yaw)*along;
          o.rotation.set(0,yaw,0);o.position.set(px,p.y+0.13+bob,pz);o.scale.set(0.055,0.12,0.055);o.updateMatrix(); passengers.current?.setMatrixAt(i*2+j,o.matrix);
          o.position.y=p.y+0.28+bob;o.scale.setScalar(0.03);o.updateMatrix();passengerHeads.current?.setMatrixAt(i*2+j,o.matrix);
        }
      }
      h.instanceMatrix.needsUpdate = cb.instanceMatrix.needsUpdate = l.instanceMatrix.needsUpdate = true;
      if(yachtDeck.current) yachtDeck.current.instanceMatrix.needsUpdate=true;
      if(yachtRoof.current) yachtRoof.current.instanceMatrix.needsUpdate=true;
      if(passengers.current) passengers.current.instanceMatrix.needsUpdate=true;
      if(passengerHeads.current) passengerHeads.current.instanceMatrix.needsUpdate=true;
    }
    const bd = body.current;
    const hd = head.current;
    if (bd && hd) {
      walkers.forEach((w, i) => {
        const route = w.route?.length ? w.route : [{ gx: w.x0, gy: w.z0 }, { gx: w.x1, gy: w.z1 }];
        const lengths = route.slice(1).map((p, j) => Math.hypot(p.gx-route[j].gx, p.gy-route[j].gy));
        const len = lengths.reduce((a,b) => a+b, 0);
        // Walk to the end, pause, walk back.
        const period = (len / STROLL_SPEED) * 2 + 6;
        const ph = (((t + i * 7.3) % period) + period) % period;
        const leg = len / STROLL_SPEED;
        const f = ph < leg ? ph / leg : ph < leg + 3 ? 1 : ph < leg * 2 + 3 ? 1 - (ph - leg - 3) / leg : 0;
        let side = (ph < leg + 3 ? 1 : -1) * 0.1;
        let distance = f * len, segment = 0;
        while (segment < lengths.length - 1 && distance > lengths[segment]) distance -= lengths[segment++];
        const a = route[segment], b = route[segment+1];
        const segmentLength = lengths[segment] || 1;
        const dx = (b.gx-a.gx)/segmentLength, dz = (b.gy-a.gy)/segmentLength;
        // Where a pedestrian approach shares a street alignment, use its raised sidewalk.
        if (!(w.bridge && ((a.gx === w.x0 && a.gy === w.z0 && b.gx === w.x1 && b.gy === w.z1) || (b.gx === w.x0 && b.gy === w.z0 && a.gx === w.x1 && a.gy === w.z1)))) for (const bridge of scene.carBridges) for (const road of bridge.roads) for (let j=1;j<road.length;j++) {
          const r=road[j-1], q=road[j], mx=(a.gx+b.gx)/2, mz=(a.gy+b.gy)/2;
          if ((Math.abs(dx)>0.9 && Math.abs(r[1]-q[1])<1e-6 && Math.abs(mz-r[1])<0.05 && mx>=Math.min(r[0],q[0]) && mx<=Math.max(r[0],q[0])) || (Math.abs(dz)>0.9 && Math.abs(r[0]-q[0])<1e-6 && Math.abs(mx-r[0])<0.05 && mz>=Math.min(r[1],q[1]) && mz<=Math.max(r[1],q[1]))) side = Math.sign(side)*0.265;
        }
        const x = a.gx + dx*distance - dz*side;
        const z = a.gy + dz*distance + dx*side;
        const step = moving ? Math.abs(Math.sin(t * 7 + i)) * 0.008 : 0;
        const sidewalkLift = Math.abs(side) > 0.2 ? 0.05 : 0;
        o.rotation.set(0, Math.atan2(dx, dz) + (ph < leg+3 ? 0 : Math.PI), 0);
        o.position.set(x, (w.y ?? 0) + sidewalkLift + 0.02 + step, z);
        o.scale.set(0.07, 0.16, 0.06);
        o.updateMatrix();
        bd.setMatrixAt(i, o.matrix);
        o.position.set(x, (w.y ?? 0) + sidewalkLift + 0.21 + step, z);
        o.scale.setScalar(0.035);
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
    for (let i = 0; i < BOATS; i++) hull.current?.setColorAt(i, c.set(["#f4f1e8","#427fa4","#d36b58","#65a593","#dfbd67","#8f80b2","#d5dce2","#33556e"][i]));
    if (hull.current?.instanceColor) hull.current.instanceColor.needsUpdate = true;
    for(let i=0;i<BOATS*2;i++) { passengers.current?.setColorAt(i,c.set(CLOTHES[i%CLOTHES.length]));passengerHeads.current?.setColorAt(i,c.set(i%3?"#e3b994":"#9c6b4a")); }
    if(passengers.current?.instanceColor) passengers.current.instanceColor.needsUpdate=true;
    if(passengerHeads.current?.instanceColor) passengerHeads.current.instanceColor.needsUpdate=true;
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
      <CityFlyover scene={scene} g={g} m={m} moving={moving} />
      <Marina x={loop.dockX} z={loop.pierZ} cityZ={loop.shoreZ} g={g} m={m} />
      <instancedMesh ref={passengers} args={[g.cyl,m.plain,BOATS*2]} frustumCulled={false} raycast={()=>null} />
      <instancedMesh ref={passengerHeads} args={[g.ball,m.plain,BOATS*2]} frustumCulled={false} raycast={()=>null} />
      <instancedMesh ref={hull} args={[boatGeometry.hull, m.plain, BOATS]} castShadow frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={yachtDeck} args={[boatGeometry.hull,m.plain,BOATS]} frustumCulled={false} raycast={()=>null} />
      <instancedMesh ref={yachtRoof} args={[g.box,m.plain,BOATS]} frustumCulled={false} raycast={()=>null} />
      <instancedMesh ref={cabin} args={[boatGeometry.cabin, m.darkGlass, BOATS]} castShadow frustumCulled={false} raycast={() => null} />
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
  sports: {
    parts:[...wheels(0.074),
      {at:[0,0.012,0],size:[0.235,0.028,0.105],color:null},
      {at:[0.064,0.04,0],size:[0.105,0.012,0.1],color:null},
      {at:[-0.025,0.042,0],size:[0.098,0.025,0.083],color:GLASS},
      {at:[-0.03,0.067,0],size:[0.065,0.008,0.078],color:null},
      {at:[-0.096,0.062,0],size:[0.022,0.008,0.119],color:TIRE},
      {at:[-0.096,0.04,-0.035],size:[0.01,0.022,0.008],color:TIRE},
      {at:[-0.096,0.04,0.035],size:[0.01,0.022,0.008],color:TIRE},
      {at:[0.118,0.019,-0.018],size:[0.006,0.018,0.022],color:TIRE},
      {at:[0.118,0.019,0.018],size:[0.006,0.018,0.022],color:TIRE},
      {at:[0,0.012,-0.055],size:[0.2,0.008,0.008],color:TIRE},
      {at:[0,0.012,0.055],size:[0.2,0.008,0.008],color:TIRE}],
    nose:0.118,lightY:0.03
  },
  amazon: {parts:[...wheels(0.08),{at:[0,0.014,0],size:[0.25,0.11,0.106],color:null},{at:[0.097,0.07,0],size:[0.055,0.043,0.11],color:GLASS},{at:[-0.035,0.054,0],size:[0.13,0.012,0.11],color:"#55bde7"}],nose:0.125,lightY:0.04},
  ups: {parts:[...wheels(0.08),{at:[0,0.014,0],size:[0.25,0.12,0.106],color:null},{at:[0.1,0.075,0],size:[0.052,0.045,0.11],color:GLASS},{at:[-0.03,0.068,0],size:[0.14,0.014,0.11],color:"#dcaf4d"}],nose:0.125,lightY:0.04},
  bus: {parts:[...wheels(0.13),{at:[0,0.014,0],size:[0.35,0.12,0.108],color:null},{at:[0,0.07,0],size:[0.32,0.045,0.112],color:GLASS},{at:[0,0.052,0],size:[0.35,0.014,0.113],color:"#2473b9"},...[-0.1,-0.04,0.02,0.08,0.14].map(x=>({at:[x,0.07,0] as [number,number,number],size:[0.009,0.045,0.114] as [number,number,number],color:TRIM}))],nose:0.175,lightY:0.04},
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
      {plans.map(v=><VehicleBadge key={v.id} plan={v} moving={moving} />)}
      <instancedMesh ref={body} args={[g.box, m.plain, parts.length]} castShadow frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={heads} args={[g.ball, mats.head, plans.length * 2]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={tails} args={[g.box, mats.tail, plans.length * 2]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={pools} args={[g.cyl, m.pool, plans.length]} frustumCulled={false} raycast={() => null} />
    </group>
  );
}

/** Timber pier, berthing platform and navigation lights outside the southern shoreline. */
function Marina({x,z,cityZ,g,m}:{x:number;z:number;cityZ:number;g:G;m:M}) {
  const parts=useMemo(()=>{
    const deck:Inst[]=[{p:[x,WATER_Y+0.13,z+0.55],s:[0.5,0.09,1.1],c:"#a7835d"},{p:[x,WATER_Y+0.13,z+1.05],s:[2.2,0.09,0.38],c:"#b89569"}];
    const posts:Inst[]=[],lights:Inst[]=[];
    const dockTop=WATER_Y+0.22, cityTop=TERRACE_H+0.03;
    const count=12, run=1.8, tread=run/count;
    const stairStart=z-run;
    const approachStart=cityZ-0.25, approachEnd=stairStart;
    const approachLength=Math.max(0.25,approachEnd-approachStart);
    deck.push({p:[x,cityTop-0.09,(approachStart+approachEnd)/2],s:[0.8,0.09,approachLength],c:"#d4cfb9"});
    for(const side of [-1,1]) {
      posts.push({p:[x+side*0.38,cityTop+0.3,(approachStart+approachEnd)/2],s:[0.035,0.025,approachLength],c:"#76b5ae"});
      for(let d=0;d<=approachLength;d+=0.25) posts.push({p:[x+side*0.38,cityTop,approachStart+d],s:[0.025,0.32,0.025],c:"#335b58"});
    }
    // A broad stone stair descends from the city promenade to the pier's shore end.
    deck.push({p:[x,cityTop-0.08,z-run-0.22],s:[0.8,0.08,0.44],c:"#d4cfb9"});
    // The bottom landing overlaps the pier, keeping the final riser flush with the deck.
    deck.push({p:[x,dockTop-0.09,z+0.06],s:[0.76,0.09,0.28],c:"#b89569"});
    for(let i=0;i<count;i++) {
      const top=cityTop-(cityTop-dockTop)*(i+1)/count;
      const along=z-run+(i+0.5)*tread;
      deck.push({p:[x,dockTop-0.12,along],s:[0.72,top-dockTop+0.12,tread+0.015],c:i%2?"#aaa99e":"#bab7a8"});
      for(const side of [-1,1]) {
        posts.push({p:[x+side*0.35,top,along],s:[0.025,0.32,0.025],c:"#335b58"});
        posts.push({p:[x+side*0.35,top+0.3,along],s:[0.035,0.025,tread+0.02],c:"#76b5ae"});
      }
    }

    for(const side of [-1,1]) for(const along of [0.15,0.95]) posts.push({p:[x+side*0.22,WATER_Y-0.45,z+along],s:[0.06,0.85,0.06],c:"#54493f"});
    for(const side of [-1,1]) { posts.push({p:[x+side*1.02,WATER_Y-0.45,z+1.05],s:[0.07,0.85,0.07],c:"#54493f"}); lights.push({p:[x+side*1.02,WATER_Y+0.42,z+1.05],s:[0.055,0.055,0.055]}); }
    return {deck,posts,lights};
  },[x,z,cityZ]);
  return <group><Instanced items={parts.deck} geometry={g.box} material={m.plain}/><Instanced items={parts.posts} geometry={g.box} material={m.plain}/><Instanced items={parts.lights} geometry={g.ball} material={m.lamp}/></group>;
}

/** A light aircraft towing a Benjaire banner on a slow circuit above the waterfront. */
function CityFlyover({scene,g,m,moving}:{scene:Scene3D;g:G;m:M;moving:boolean}) {
  const group=useRef<THREE.Group>(null), time=useRef(0);
  const banner=useMemo(()=>{
    const canvas=document.createElement("canvas");canvas.width=768;canvas.height=192;
    const ctx=canvas.getContext("2d")!;
    ctx.fillStyle="#f4ead1";ctx.fillRect(0,0,768,192);
    ctx.strokeStyle="#b8893b";ctx.lineWidth=12;ctx.strokeRect(8,8,752,176);
    ctx.fillStyle="#203b32";ctx.font="600 116px Georgia, serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("Benjaire",384,101);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.SpriteMaterial({map:texture,depthTest:true,depthWrite:false});
    return {texture,material};
  },[]);
  useEffect(()=>()=>{banner.texture.dispose();banner.material.dispose();},[banner]);
  const parts:Inst[]= [
    {p:[0,0,0],s:[1.1,0.16,0.16],c:"#f1eee4"},
    {p:[0.1,0.07,0],s:[0.3,0.11,0.15],c:"#34586a"},
    {p:[0,0.04,0],s:[0.3,0.045,1.35],c:"#eee5ce"},
    {p:[-0.43,0.09,0],s:[0.22,0.035,0.55],c:"#b8893b"},
    {p:[-0.43,0.1,0],s:[0.17,0.25,0.035],c:"#b8893b"},
    {p:[0.57,0.01,0],s:[0.025,0.36,0.035],c:"#374a44"},
    {p:[-1.05,0.03,0],s:[1.1,0.012,0.012],c:"#cbbd9e"},
  ];
  useFrame((_,dt)=>{
    if(moving)time.current+=Math.min(dt,0.1);
    if(!group.current)return;
    const b=scene.bounds,cx=(b.x0+b.x1)/2,cz=(b.z0+b.z1)/2;
    group.current.visible=true;
    const rx=(b.x1-b.x0)/2+3,rz=(b.z1-b.z0)/2+3,t=time.current*0.045;
    group.current.position.set(cx+Math.cos(t)*rx,8.5+Math.sin(t*2)*0.2,cz+Math.sin(t)*rz);
    group.current.rotation.set(0,Math.atan2(-Math.cos(t)*rz,-Math.sin(t)*rx),Math.sin(t)*0.035);
  });
  return <group ref={group}><Instanced items={parts} geometry={g.box} material={m.plain}/><sprite material={banner.material} position={[-2.25,-0.05,0]} scale={[1.6,0.4,1]} raycast={()=>null}/></group>;
}

function VehicleBadge({plan,moving}:{plan:ReturnType<typeof planVehicles>[number];moving:boolean}) {
  const ref=useRef<THREE.Group>(null),clock=useRef(0);
  const label=({amazon:"amazon",ups:"UPS",bus:"MTA"} as Record<string,string>)[plan.kind];
  const badge=useMemo(()=>{
    const c=document.createElement("canvas");c.width=256;c.height=96;const ctx=c.getContext("2d")!;
    ctx.fillStyle=plan.color;ctx.fillRect(0,0,256,96);ctx.fillStyle=plan.kind==="ups"?"#e5bd62":"#ffffff";ctx.font="bold 64px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(label??"",128,50,245);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
    return {texture,material:new THREE.MeshBasicMaterial({map:texture})};
  },[label,plan.color,plan.kind]);
  useEffect(()=>()=>{badge.texture.dispose();badge.material.dispose();},[badge]);
  useFrame((_,dt)=>{if(moving)clock.current+=Math.min(dt,0.1);if(!ref.current)return;const a=vehicleAt(plan,clock.current);ref.current.position.set(a.x,TERRACE_H+0.03+a.y,a.z);ref.current.rotation.y=Math.atan2(-a.dz,a.dx);});
  if(!label)return null;
  return <group ref={ref} scale={SCALE}>{[-1,1].map(side=><mesh key={side} position={[-0.035,0.09,side*0.058]} rotation={[0,side<0?Math.PI:0,0]} material={badge.material} raycast={()=>null}><planeGeometry args={[0.115,0.04]}/></mesh>)}</group>;
}
