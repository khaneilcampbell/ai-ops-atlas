import {MODELS,SCALE} from "./vehicleModels";
import {SkyBalloons} from "./SkyBalloons";
import { beginPedestrianFrame, reportPedestrian, pedestrianAllowed } from "./doorTraffic";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { wake } from "../../lib/power";
import { focusable, night } from "./materials";
import { Instanced, type Inst, type useGeometries, type useMaterials } from "./models";
import { TERRACE_H, WATER_Y, type Scene3D } from "./scene";
import { planVehicles, planDealershipTraffic, planHighwayTraffic, vehicleAt, vehicleVisible } from "./vehicles";

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
    else if (night.value !== target) {
      night.value += (target - night.value) * (1 - Math.exp(-Math.min(dt, 0.1) * 2.2));
      wake(100);
    }
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
    }).flatMap(w => [w,w]).map(w => {
      const route=w.route?.length ? w.route : [{gx:w.x0,gy:w.z0},{gx:w.x1,gy:w.z1}];
      const lengths=route.slice(1).map((p,j)=>Math.hypot(p.gx-route[j].gx,p.gy-route[j].gy));
      return {...w,route,lengths,len:lengths.reduce((a,b)=>a+b,0)};
    });
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
    // Join the actual district promenade, rather than stopping at the cliff edge.
    const sidewalks=scene.paving.filter(r=>harborX>=r.x && harborX<=r.x+r.w && r.z<shoreZ && r.z+r.d>shoreZ-2 && r.y>=TERRACE_H);
    const cityWalkZ=sidewalks.length ? Math.max(...sidewalks.map(r=>Math.min(shoreZ-0.2,r.z+r.d/2))) : shoreZ-0.8;
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
    return { curve, length: curve.getLength(), dockU, dockX, dockZ, pierZ, shoreZ, cityWalkZ };
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
        const size = [0.7, 1.15, 1.85][i % 3];
        o.scale.set(0.78*size, 0.12, 0.3*size);
        o.updateMatrix();
        h.setMatrixAt(i, o.matrix);
        o.position.set(p.x,p.y+0.11+bob,p.z);o.scale.set(0.76*size,0.025,0.28*size);o.updateMatrix();yachtDeck.current?.setMatrixAt(i,o.matrix);
        o.position.set(p.x - Math.cos(yaw) * 0.08*size, p.y + 0.1 + bob, p.z + Math.sin(yaw) * 0.08*size);
        o.scale.set(0.32*size, 0.15, 0.2*size);
        o.updateMatrix();
        cb.setMatrixAt(i, o.matrix);
        o.position.y=p.y+0.25+bob;o.scale.set(0.25*size,0.025,0.23*size);o.updateMatrix();yachtRoof.current?.setMatrixAt(i,o.matrix);
        o.position.set(p.x + Math.cos(yaw) * 0.26*size, p.y + 0.13 + bob, p.z - Math.sin(yaw) * 0.26*size);
        o.scale.setScalar(0.022);
        o.updateMatrix();
        l.setMatrixAt(i, o.matrix);
        for(let j=0;j<2;j++) {
          const along=(j?0.2:-0.2)*size;
          const px=p.x+Math.cos(yaw)*along, pz=p.z-Math.sin(yaw)*along;
          const visible=pedestrianAllowed(scene.pedestrianExclusion,px,pz)?1:0;
          o.rotation.set(0,yaw,0);o.position.set(px,p.y+0.13+bob,pz);o.scale.set(0.055*visible,0.12*visible,0.055*visible);o.updateMatrix(); passengers.current?.setMatrixAt(i*2+j,o.matrix);
          o.position.y=p.y+0.28+bob;o.scale.setScalar(0.03*visible);o.updateMatrix();passengerHeads.current?.setMatrixAt(i*2+j,o.matrix);
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
      beginPedestrianFrame();
      walkers.forEach((w, i) => {
        const {route,lengths,len}=w;
        // Walk to the end, pause, walk back.
        const pause = w.shopEntrance ? 8 : 3;
        const period = (len / STROLL_SPEED) * 2 + pause*2;
        const ph = (((t + i * 7.3) % period) + period) % period;
        const leg = len / STROLL_SPEED;
        const f = ph < leg ? ph / leg : ph < leg + pause ? 1 : ph < leg * 2 + pause ? 1 - (ph - leg - pause) / leg : 0;
        let side = (ph < leg + pause ? 1 : -1) * 0.1;
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
        if(w.shopEntrance) side *= Math.min(1,(1-f)*5);
        let visitorScale=w.shopEntrance && f>0.96 ? 0 : 1;
        const x = a.gx + dx*distance - dz*side;
        const z = a.gy + dz*distance + dx*side;
        if(!pedestrianAllowed(scene.pedestrianExclusion,x,z))visitorScale=0;
        if(visitorScale>0) reportPedestrian(x,z);
        const step = moving ? Math.abs(Math.sin(t * 7 + i)) * 0.008 : 0;
        const sidewalkLift = Math.abs(side) > 0.2 ? 0.05 : 0;
        o.rotation.set(0, Math.atan2(dx, dz) + (ph < leg+pause ? 0 : Math.PI), 0);
        o.position.set(x, (w.y ?? 0) + sidewalkLift + 0.02 + step, z);
        o.scale.set(0.07*visitorScale, 0.16*visitorScale, 0.06*visitorScale);
        o.updateMatrix();
        bd.setMatrixAt(i, o.matrix);
        o.position.set(x, (w.y ?? 0) + sidewalkLift + 0.21 + step, z);
        o.scale.setScalar(0.035*visitorScale);
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
      <SkyBalloons scene={scene} g={g} m={m} moving={moving} />
      <DockVisitors x={loop.dockX} z={loop.pierZ} cityZ={loop.cityWalkZ} g={g} m={m} moving={moving} exclusion={scene.pedestrianExclusion} />
      <Marina x={loop.dockX} z={loop.pierZ} cityZ={loop.cityWalkZ} shoreZ={loop.shoreZ} g={g} m={m} />
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


/**
 * Miniature sedans, vans and service vehicles touring the districts' stone paths, with headlights
 * and taillights at night. Decorative only: their routes come from the map's paths, never from
 * project data or agent activity. Frozen in place when motion is off.
 */
export function Vehicles({ scene, g, m, moving }: { scene: Scene3D; g: G; m: M; moving: boolean }) {
  const plans = useMemo(() => [...planVehicles(scene),...planDealershipTraffic(scene),...planHighwayTraffic(scene)], [scene]);
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
      return new THREE.Matrix4().compose(tmp.p.set(at.x, y0 + at.y, at.z), tmp.q.setFromEuler(tmp.e), tmp.s.setScalar(pedestrianAllowed(scene.pedestrianExclusion,at.x,at.z)&&vehicleVisible(v,clock.current)?1:0));
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
    <group name="atlas-road-traffic">
      {plans.map(v=><VehicleBadge key={v.id} plan={v} moving={moving} />)}
      <instancedMesh ref={body} args={[g.box, m.plain, parts.length]} castShadow frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={heads} args={[g.ball, mats.head, plans.length * 2]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={tails} args={[g.box, mats.tail, plans.length * 2]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={pools} args={[g.cyl, m.pool, plans.length]} frustumCulled={false} raycast={() => null} />
    </group>
  );
}

/** Timber pier, berthing platform and navigation lights outside the southern shoreline. */
/** Visitors follow the stair treads in both directions, then stroll along the pier. */
function DockVisitors({ x, z, cityZ, g, m, moving, exclusion }: { x:number; z:number; cityZ:number; g:G; m:M; moving:boolean;exclusion?:Scene3D["pedestrianExclusion"] }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const elapsed = useRef(0);
  const object = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    const color = new THREE.Color();
    for (let i=0;i<8;i++) {
      bodies.current?.setColorAt(i,color.set(CLOTHES[i%CLOTHES.length]));
      heads.current?.setColorAt(i,color.set(i%3 ? "#e3b994" : "#9c6b4a"));
    }
    if(bodies.current?.instanceColor) bodies.current.instanceColor.needsUpdate=true;
    if(heads.current?.instanceColor) heads.current.instanceColor.needsUpdate=true;
  }, []);
  useFrame((_,dt) => {
    if(moving) elapsed.current += Math.min(dt,0.1);
    const start=cityZ-0.2, end=z+1.05, length=end-start;
    const cityTop=TERRACE_H+0.03, dockTop=WATER_Y+0.22;
    for(let i=0;i<8;i++) {
      const phase=(elapsed.current*STROLL_SPEED+i*length/4)%(length*2);
      const down=phase<length;
      const along=start+(down?phase:length*2-phase);
      const stairProgress=Math.max(0,Math.min(1,(along-(z-1.8))/1.8));
      const tread=Math.min(12,Math.floor(stairProgress*12)+1);
      const floor=along<z-1.8?cityTop:along>=z?dockTop:cityTop-(cityTop-dockTop)*tread/12;
      object.rotation.set(0,down?0:Math.PI,0);
      object.position.set(x+(down?-0.12:0.12),floor+0.02,along);
      const visible=pedestrianAllowed(exclusion,object.position.x,along)?1:0;
      object.scale.set(0.07*visible,0.16*visible,0.06*visible);object.updateMatrix();bodies.current?.setMatrixAt(i,object.matrix);
      object.position.y=floor+0.21;object.scale.setScalar(0.035*visible);object.updateMatrix();heads.current?.setMatrixAt(i,object.matrix);
    }
    if(bodies.current) bodies.current.instanceMatrix.needsUpdate=true;
    if(heads.current) heads.current.instanceMatrix.needsUpdate=true;
  });
  return <group><instancedMesh ref={bodies} args={[g.cyl,m.plain,8]} castShadow frustumCulled={false} raycast={()=>null}/><instancedMesh ref={heads} args={[g.ball,m.plain,8]} castShadow frustumCulled={false} raycast={()=>null}/></group>;
}

function Marina({x,z,cityZ,shoreZ,g,m}:{x:number;z:number;cityZ:number;shoreZ:number;g:G;m:M}) {
  const parts=useMemo(()=>{
    const deck:Inst[]=[{p:[x,WATER_Y+0.13,z+0.55],s:[0.5,0.09,1.1],c:"#a7835d"},{p:[x,WATER_Y+0.13,z+1.05],s:[3.6,0.09,0.38],c:"#b89569"}];
    const posts:Inst[]=[],lights:Inst[]=[];
    const dockTop=WATER_Y+0.22, cityTop=TERRACE_H+0.03;
    const count=12, run=1.8, tread=run/count;
    const stairStart=z-run;
    const approachStart=cityZ-0.25, approachEnd=stairStart;
    const approachLength=Math.max(0.25,approachEnd-approachStart);
    deck.push({p:[x,cityTop-0.09,(approachStart+approachEnd)/2],s:[0.8,0.09,approachLength],c:"#d4cfb9"});
    const railStart=Math.max(shoreZ+0.02,approachStart);
    const railLength=Math.max(0,approachEnd-railStart);
    if(railLength>0) for(const side of [-1,1]) {
      posts.push({p:[x+side*0.35,cityTop+0.3,(railStart+approachEnd)/2],s:[0.035,0.025,railLength],c:"#76b5ae"});
      const spans=Math.max(1,Math.ceil(railLength/0.25));
      for(let i=0;i<=spans;i++) posts.push({p:[x+side*0.35,cityTop,railStart+i*railLength/spans],s:[0.025,0.32,0.025],c:"#335b58"});
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
    for(const side of [-1,1]) { posts.push({p:[x+side*1.72,WATER_Y-0.45,z+1.05],s:[0.07,0.85,0.07],c:"#54493f"}); lights.push({p:[x+side*1.72,WATER_Y+0.42,z+1.05],s:[0.055,0.055,0.055]}); }
    return {deck,posts,lights};
  },[x,z,cityZ,shoreZ]);
  return <group><Instanced items={parts.deck} geometry={g.box} material={m.plain}/><Instanced items={parts.posts} geometry={g.box} material={m.plain}/><Instanced items={parts.lights} geometry={g.ball} material={m.lamp}/></group>;
}

/** Executive jet; shared geometry and the existing decorative waterfront circuit. */
function CityFlyover({scene,g,m,moving}:{scene:Scene3D;g:G;m:M;moving:boolean}) {
  const group=useRef<THREE.Group>(null), time=useRef(0);
  const jet=useMemo(()=>({
    body:[
      {p:[0,.13,0],s:[1.18,.17,.19],c:"#f5f2e9"},
      {p:[.76,.20,0],s:[.25,.10,.155],c:"#233f4c"},
      {p:[-.64,.18,-.32],s:[.34,.12,.12],c:"#e6dfcc"},
      {p:[-.64,.18,.32],s:[.34,.12,.12],c:"#e6dfcc"},
      {p:[-.33,.18,-.32],s:[.035,.085,.085],c:"#243b34"},
      {p:[-.33,.18,.32],s:[.035,.085,.085],c:"#243b34"},
      ...[-1,1].flatMap(side=>Array.from({length:6},(_,i)=>({p:[.48-i*.17,.22,side*.175],s:[.045,.045,.016],c:"#284a50"}))),
    ] as Inst[],
    trim:[
      {p:[-.18,.10,-.62],s:[.37,.045,1.2],r:-.38,c:"#eee9db"},
      {p:[-.18,.10,.62],s:[.37,.045,1.2],r:.38,c:"#eee9db"},
      {p:[-.40,.14,-1.13],s:[.22,.18,.035],c:"#29483b"},
      {p:[-.40,.14,1.13],s:[.22,.18,.035],c:"#29483b"},
      {p:[-.95,.24,0],s:[.32,.43,.055],c:"#29483b"},
      {p:[-1.0,.64,0],s:[.32,.04,.85],c:"#eee9db"},
      {p:[-.96,.47,.031],s:[.27,.055,.012],c:"#c9a35a"},
      ...[-1,1].map(side=>({p:[-.05,.12,side*.187],s:[1.55,.025,.012],c:"#b8893b"})),
    ] as Inst[],
  }),[]);
  useFrame((_,dt)=>{
    if(moving)time.current+=Math.min(dt,0.1);
    if(!group.current)return;
    const b=scene.bounds,cx=(b.x0+b.x1)/2,cz=(b.z0+b.z1)/2;
    group.current.visible=true;
    const rx=(b.x1-b.x0)/2+3,rz=(b.z1-b.z0)/2+3,t=time.current*0.085;
    group.current.position.set(cx+Math.cos(t)*rx,8.5+Math.sin(t*2)*0.2,cz+Math.sin(t)*rz);
    group.current.rotation.set(0,Math.atan2(-Math.cos(t)*rz,-Math.sin(t)*rx),Math.sin(t)*0.035);
  });
  return <group ref={group}><Instanced items={jet.body} geometry={g.ball} material={m.plain}/><Instanced items={jet.trim} geometry={g.box} material={m.plain}/></group>;
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
