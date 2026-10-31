import {bridgePoint,clipConnectionRails} from "./connectionGeometry";
import {TRANSPORT} from "./transportScale";
import { doorOpenness, entranceOccupied } from "./doorTraffic";
import { useReducedMotion } from "../../lib/motion";
import { toolBrand, toolOfficeHeight } from "./toolBrand";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Health } from "../../lib/derive";
import type { BuildingStyle } from "./identity";
import { hash } from "../mapLayout";
import { billboardTexture, facadeTexture, focusable, glowTexture, houseWallTexture, nameBoardTexture, patterned, signTexture, swaying, windowLights } from "./materials";
import { ROAD_W, DECK_W, deckRise, dist, rampOf, towerRing, ringPath, type CarBridge } from "./roads";
import { FLOOR_H, LAND_BOTTOM, TERRACE_H, WATER_Y, type House, type Kiosk, type Rect, type Scene3D, type StrayBuilding, type Tower } from "./scene";

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
      // Each box's place lives in the instance matrices; the mesh itself never moves, so skip
      // recomposing its own matrix every frame (a parent group can still move it).
      matrixAutoUpdate={false}
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

// ── Road bridges ────────────────────────────────────

const RAIL = "#2f4a3a";
const DECK_T = 0.07;

/**
 * The pieces of one road bridge: a stone deck that ramps up from each terrace, railings in Atlas
 * green, pairs of pillars standing in the meadow or the brook below, and a lantern at each corner
 * that lights with the rest of the map at night.
 */
export function bridgeParts(br: CarBridge, brooks: Rect[], width: number = DECK_W, groundLevel = 0, raised = true) {
  const len = dist(br.a, br.b);
  const r = rampOf(len);
  const x = br.axis === "x";
  const yaw = x ? Math.PI / 2 : 0;
  // From (s along the deck, v across it, y) to world.
  const at = (s: number, v: number, y: number): [number, number, number] => {
    const px = br.a[0] + (x ? s : v);
    const pz = br.a[1] + (x ? v : s);
    return [px, y, pz];
  };
  const top = (s: number) => TERRACE_H + (raised ? 0.03 + deckRise(len, s) : 0.055);
  const deck: Inst[] = [];
  const rails: Inst[] = [];
  const piers: Inst[] = [];
  const lamps: Inst[] = [];
  const pools: Inst[] = [];
  const edge = width / 2 - 0.016;
  // Ramps and the level span, each a tilted slab, with a rail along each side.
  const spans: [number, number][] = [
    [-0.04, r],
    [r, len - r],
    [len - r, len + 0.04],
  ];
  for (const [s0, s1] of spans) {
    const y0 = top(Math.max(0, s0));
    const y1 = top(Math.min(len, s1));
    const run = s1 - s0;
    const tilt = -Math.atan2(y1 - y0, run);
    const l = Math.hypot(run, y1 - y0);
    const m = (s0 + s1) / 2;
    const ym = (y0 + y1) / 2;
    deck.push({ p: at(m, 0, ym - DECK_T), s: [width, DECK_T + 0.004, l], r: yaw, rx: tilt, c: "#ddd2b8" });
    for (const v of [-edge, edge]) rails.push({ p: at(m, v, ym + 0.085), s: [0.024, 0.016, l], r: yaw, rx: tilt, c: RAIL });
    for (const v of [-edge, edge]) rails.push({ p: at(m, v, ym), s: [0.03, 0.03, l], r: yaw, rx: tilt, c: "#cfc4ab" });
  }
  // Balusters between the rails.
  const posts = Math.max(4, Math.round(len / 0.16));
  for (let i = 0; i <= posts; i++) {
    const s = (len * i) / posts;
    for (const v of [-edge, edge]) rails.push({ p: at(s, v, top(s)), s: [0.016, 0.09, 0.016], c: RAIL });
  }
  // A dashed center line on the level span.
  for (let s = r + 0.06; s < len - r - 0.06; s += 0.17) deck.push({ p: at(s + 0.04, 0, top(s)), s: [0.018, 0.003, 0.08], r: yaw, c: "#c9a35a" });
  // Pillars, in pairs, down to the meadow or into the brook.
  const n = Math.max(2, Math.round(len / 0.75));
  for (let i = 1; i <= n; i++) {
    const s = (len * i) / (n + 1);
    const [px, , pz] = at(s, 0, 0);
    const ground = brooks.some((b) => px >= b.x && px <= b.x + b.w && pz >= b.z && pz <= b.z + b.d) ? -0.03 : groundLevel;
    const under = top(s) - DECK_T;
    for (const v of [-0.13, 0.13]) piers.push({ p: at(s, v, ground), s: [0.1, under - ground, 0.1] });
    rails.push({ p: at(s, 0, under - 0.05), s: [width + 0.02, 0.05, 0.1], r: yaw, c: "#cfc4ab" });
  }
  // Lanterns at the four corners, with a pool of light on the deck at night.
  for (const s of [0.06, len - 0.06])
    for (const v of [-edge, edge]) {
      rails.push({ p: at(s, v, top(s)), s: [0.022, 0.2, 0.022], c: RAIL });
      lamps.push({ p: at(s, v, top(s) + 0.225), s: [0.026, 0.026, 0.026] });
      pools.push({ p: at(s, v * 0.45, top(s) + 0.003), s: [0.34, 0.004, 0.34] });
    }
  return { deck, rails, piers, lamps, pools };
}

export function Bridges({ scene, g, m }: { scene: Scene3D; g: G; m: M }) {
  const items = useMemo(() => {
    const all = scene.carBridges.map((br) => bridgeParts(br, scene.brooks));
    const footDeck: Inst[] = [], footRails: Inst[] = [], footPiers: Inst[] = [];
    const streets: Inst[] = [], sidewalks: Inst[] = [], markings: Inst[] = [];
    const street = (a: [number,number], b: [number,number], width: number, curb: boolean) => {
      const dx=b[0]-a[0], dz=b[1]-a[1], length=Math.hypot(dx,dz);
      if(length<0.01) return;
      const x=(a[0]+b[0])/2,z=(a[1]+b[1])/2, alongX=Math.abs(dx)>Math.abs(dz);
      streets.push({p:[x,TERRACE_H+0.034,z],s:alongX?[length,0.008,width]:[width,0.008,length],c:"#424b50"});
      if(curb) for(const side of [-1,1]) {
        sidewalks.push({p:[x+(alongX?0:side*(width/2+0.065)),TERRACE_H+0.035,z+(alongX?side*(width/2+0.065):0)],s:alongX?[length,0.035,0.13]:[0.13,0.035,length],c:"#d4cfb9"});
      }
      for(let d=0.16;d<length-0.1;d+=0.3) markings.push({p:[a[0]+dx*d/length,TERRACE_H+0.045,a[1]+dz*d/length],s:alongX?[0.12,0.006,0.018]:[0.018,0.006,0.12],c:"#e1ce8e"});
    };
    for(const br of scene.carBridges) for(const road of br.roads) {
      for(let i=1;i<road.length;i++) street(road[i-1],road[i],ROAD_W,true);
      for(const p of road.slice(1,-1)) streets.push({p:[p[0],TERRACE_H+0.034,p[1]],s:[ROAD_W,0.008,ROAD_W],c:"#424b50"});
    }
    for(const t of scene.towers) {
      const plaza=scene.paving.filter(p=>p.w>t.size&&Math.abs(p.x+p.w/2-t.x)<1e-6&&Math.abs(p.z+p.d/2-t.z)<1e-6&&Math.abs(p.w-p.d)<1e-6).sort((a,b)=>a.w-b.w)[0];
      const ring=plaza&&towerRing(t,plaza.w);
      if(!ring) continue;
      // Draw only the plaza streets that connect actual bridge exits; no decorative dead ends.
      const exits=scene.carBridges.flatMap(br=>{const end=br.ends.indexOf(t.projectId);return end<0?[]:[br.roads[end][0]];});
      const drawn=new Set<string>();
      for(let a=0;a<exits.length;a++) for(let b=a+1;b<exits.length;b++) {
        const path=[exits[a],...ringPath(ring,exits[a],exits[b])];
        for(let i=1;i<path.length;i++) {
          const key=[path[i-1].join(":"),path[i].join(":")].sort().join("|");
          if(drawn.has(key))continue;drawn.add(key);street(path[i-1],path[i],ROAD_W,true);
        }
      }
    }

    for (const w of scene.walks.filter(w => w.bridge)) {
      const alongX = Math.abs(w.x1 - w.x0) > Math.abs(w.z1 - w.z0);
      const length = Math.hypot(w.x1 - w.x0, w.z1 - w.z0), y = w.y ?? TERRACE_H;
      const x = (w.x0 + w.x1) / 2, z = (w.z0 + w.z1) / 2;
      footDeck.push({ p: [x, y - 0.05, z], s: alongX ? [length, 0.08, TRANSPORT.walkWidth] : [TRANSPORT.walkWidth, 0.08, length], c: "#b68c60" });
      for(const end of [[w.x0,w.z0],[w.x1,w.z1]]) footDeck.push({p:[end[0],y-0.01,end[1]],s:alongX?[0.24,0.04,0.5]:[0.5,0.04,0.24],c:"#d4cfb9"});
      for (const side of [-1, 1]) {
        footRails.push({ p: [x + (alongX ? 0 : side * 0.24), y + 0.22, z + (alongX ? side * 0.24 : 0)], s: alongX ? [length, 0.035, 0.035] : [0.035, 0.035, length], c: "#76b5ae" });
        for (let d = 0; d <= length; d += 0.25) {
          const point=bridgePoint([w.x0,w.z0],[w.x1,w.z1],d,side*.24);
          footRails.push({ p: [point[0], y, point[1]], s: [0.025, 0.24, 0.025], c: "#335b58" });
        }
      }
      // Paired piles and crossbeams support the span rather than leaving a floating walkway.
      const supports=Math.max(1,Math.ceil(length/0.8));
      for(let i=0;i<=supports;i++) {
        const t=(0.08+(length-0.16)*i/supports)/length;
        const px=w.x0+(w.x1-w.x0)*t,pz=w.z0+(w.z1-w.z0)*t;
        for(const side of [-1,1]) footPiers.push({p:[px+(alongX?0:side*0.18),WATER_Y-0.05,pz+(alongX?side*0.18:0)],s:[0.07,y-WATER_Y-0.01,0.07]});
        footDeck.push({p:[px,y-0.13,pz],s:alongX?[0.09,0.08,0.5]:[0.5,0.08,0.09],c:"#675440"});
      }
      // Visible timber planks distinguish the promenade from the stone vehicle deck.
      for (let d = 0.04; d < length; d += 0.13) {const point=bridgePoint([w.x0,w.z0],[w.x1,w.z1],d);footDeck.push({ p: [point[0], y, point[1]], s: alongX ? [0.018, 0.008, 0.46] : [0.46, 0.008, 0.018], c: "#775e46" });}
    }
    // Trim every sidewalk against the complete street network, including intersecting roads.
    // Independent curb strips otherwise project across junctions and cover the asphalt.
    const clearOfStreets = (item: Inst): Inst[] => {
      let rects=[{x:item.p[0]-item.s[0]/2,z:item.p[2]-item.s[2]/2,w:item.s[0],d:item.s[2]}];
      for(const road of streets) {
        const rx=road.p[0]-road.s[0]/2,rz=road.p[2]-road.s[2]/2,rw=road.s[0],rd=road.s[2];
        rects=rects.flatMap(r=>{
          const x0=Math.max(r.x,rx),x1=Math.min(r.x+r.w,rx+rw),z0=Math.max(r.z,rz),z1=Math.min(r.z+r.d,rz+rd);
          if(x1-x0<1e-6||z1-z0<1e-6)return [r];
          return [{x:r.x,z:r.z,w:x0-r.x,d:r.d},{x:x1,z:r.z,w:r.x+r.w-x1,d:r.d},{x:x0,z:r.z,w:x1-x0,d:z0-r.z},{x:x0,z:z1,w:x1-x0,d:r.z+r.d-z1}].filter(p=>p.w>0.005&&p.d>0.005);
        });
      }
      return rects.map(r=>({...item,p:[r.x+r.w/2,item.p[1],r.z+r.d/2],s:[r.w,item.s[1],r.d]}));
    };
    return {
      deck: [...all.flatMap((b) => b.deck), ...streets, ...sidewalks.flatMap(clearOfStreets), ...markings, ...footDeck.flatMap(p=>p.c==="#d4cfb9"?clearOfStreets(p):[p])],
      rails: clipConnectionRails([...all.flatMap((b) => b.rails), ...footRails],scene.freight?.localJunctions??[],.95),
      piers: [...all.flatMap((b) => b.piers), ...footPiers],
      lamps: all.flatMap((b) => b.lamps),
      pools: all.flatMap((b) => b.pools),
    };
  }, [scene]);
  return (
    <group>
      <Instanced items={items.deck} geometry={g.box} material={m.plain} />
      <Instanced items={items.rails} geometry={g.box} material={m.plain} />
      <Instanced items={items.piers} geometry={g.cyl} material={m.step} />
      <Instanced items={items.lamps} geometry={g.ball} material={m.lamp} shadow={false} />
      <Instanced items={items.pools} geometry={g.cyl} material={m.pool} shadow={false} />
    </group>
  );
}

// ── Terrain ─────────────────────────────────────────

export function Terrain({ scene, g, m, onTerrace }: { scene: Scene3D; g: G; m: M; onTerrace: Pick }) {
  const items = useMemo(() => {
    const top = TERRACE_H;
    return {
      land: scene.land.map((r) => slab(r, LAND_BOTTOM, 0)),
      sand: scene.land.map((r) => slab(grow(r, 0.42), LAND_BOTTOM, WATER_Y + 0.07)),
      foam: scene.land.map((r) => slab(grow(r, 0.72), WATER_Y - 0.02, WATER_Y + 0.006)),
      terraces: scene.terraces.map((t) => slab(t, 0, top)),
      neighborhood: [...(scene.neighborhoodLand??[]),...(scene.airportForecourt?[scene.airportForecourt]:[])].map(t=>slab(t,0,top)),
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
      <Instanced items={items.neighborhood} geometry={g.box} material={m.terrace} />
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
  const automationSign = useMemo(() => signMaterial(signTexture({ symbol: "automation", style: "tech", accent: "#a5afa5" }, "Automation")), []);
  useEffect(() => () => automationSign.dispose(), [automationSign]);
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
      <EntranceDoors doors={items.doors} g={g} m={m} />
      <Instanced items={items.stoops} geometry={g.box} material={m.plain} shadow={false} />
      <Instanced items={items.chimneys} geometry={g.box} material={m.plain} />
      <Instanced items={items.solar} geometry={g.box} material={m.solar} />
      {houses.map(h => <mesh key={h.key} geometry={g.plane} material={automationSign} position={[h.x, TERRACE_H + h.h + h.roofH + 0.19, h.z + h.d * 0.18]} rotation={[0, Math.PI / 4, 0]} scale={[0.38, 0.38, 1]} raycast={noRaycast} />)}
    </group>
  );
}

/** Shared double sliding entrance; panels respond to actual pedestrians, not a timer. */
function EntranceDoors({doors,g,m}:{doors:Inst[];g:G;m:M}) {
  const mesh=useRef<THREE.InstancedMesh>(null),handles=useRef<THREE.InstancedMesh>(null);
  const openings=useRef<number[]>([]);
  const object=useMemo(()=>new THREE.Object3D(),[]);
  const glass=useMemo(()=>focusable(new THREE.MeshPhysicalMaterial({color:"#b7d4cc",transparent:true,opacity:0.28,roughness:0.12,metalness:0.15,depthWrite:false})),[]);
  useEffect(()=>()=>glass.dispose(),[glass]);
  const foyer=useMemo<Inst[]>(()=>doors.flatMap(door=>{
    const [x,y,z]=door.p,[w,h]=door.s,depth=Math.max(0.13,h*0.48);
    return [
      {p:[x,y,z+depth/2],s:[w*1.12,0.025,depth],c:"#d9cfb8"},
      {p:[x,y,z+0.018],s:[w,h,0.025],c:"#ece5d2"},
      {p:[x,y+h*0.16,z+depth*0.4],s:[w*0.56,h*0.24,depth*0.24],c:"#254936"},
      {p:[x,y+h*0.4,z+0.035],s:[w*0.32,h*0.23,0.015],c:"#244c3d"},
      {p:[x,y+h,z+depth/2],s:[w*1.12,0.025,depth],c:"#c3ad78"},
      {p:[x,y+0.025,z+depth*0.75],s:[w*0.65,0.01,depth*0.4],c:"#315c49"},
      ...[-1,1].map(side=>({p:[x+side*w*0.54,y,z+depth/2],s:[w*0.05,h,depth],c:"#c6a766"} as Inst)),
      {p:[x,y,z+depth],s:[w*1.1,0.02,0.08],c:"#c6a766"},
    ] as Inst[];
  }),[doors]);
  const reduced=useReducedMotion();
  useFrame((_,dt)=>{
    if(!mesh.current)return;
    doors.forEach((door,i)=>{
      const [x,y,z]=door.p,[w,h,d]=door.s,depth=Math.max(0.13,h*0.48);
      const open=reduced?(entranceOccupied(x,z)?1:0):doorOpenness(openings.current[i]??0,entranceOccupied(x,z),dt);
      openings.current[i]=open;
      for(let side=0;side<2;side++){
        const panelX=x+(side?1:-1)*w*(0.25+open*0.48);
        object.position.set(panelX,y,z+depth+0.012);
        object.scale.set(w*0.48,h,d);object.updateMatrix();mesh.current!.setMatrixAt(i*2+side,object.matrix);
        object.position.set(panelX+(side?-1:1)*w*0.16,y+h*0.3,z+depth+0.035);
        object.scale.set(0.012,h*0.3,0.012);object.updateMatrix();handles.current?.setMatrixAt(i*2+side,object.matrix);
      }
    });
    mesh.current.instanceMatrix.needsUpdate=true;
    if(handles.current)handles.current.instanceMatrix.needsUpdate=true;
  });
  return <group><Instanced items={foyer} geometry={g.box} material={m.plain}/><instancedMesh ref={mesh} args={[g.box,glass,doors.length*2]} frustumCulled={false}/><instancedMesh ref={handles} args={[g.box,m.metal,doors.length*2]} frustumCulled={false}/></group>;
}

/** Small branded business offices, kept below the project headquarters skyline. */
export function Kiosks({ kiosks, g, m, pick }: { kiosks: Kiosk[]; g: G; m: M; pick: PickHandlerSet }) {
  const items = useMemo(() => {
    const y = TERRACE_H + 0.03;
    const walls: Inst[] = [], slabs: Inst[] = [], accents: Inst[] = [], windows: Inst[] = [], domes: Inst[] = [], pediments: Inst[] = [], doors: Inst[] = [];
    for (const k of kiosks) {
      const OFFICE_H = toolOfficeHeight(k.name);
      const brand = toolBrand(k.name), w = k.size, d = w * 0.8;
      if (["Starbucks","Zara","Smashburger","Chipotle","Wells Fargo"].includes(k.name)) {
        const zara=k.name==="Zara",cafe=k.name==="Starbucks",chipotle=k.name==="Chipotle";
        walls.push({p:[k.x,y,k.z],s:[w,OFFICE_H,d],c:chipotle?"#845544":brand.wall});
        slabs.push({p:[k.x,y,k.z],s:[w*1.12,0.06,d*1.12],c:"#c2b7a4"});
        slabs.push({p:[k.x,y+OFFICE_H,k.z],s:[w*1.1,0.08,d*1.12],c:brand.roof});
        // Large storefront glazing and a central entrance distinguish shops from office towers.
        for(const side of [-1,1]) {
          windows.push({p:[k.x+side*w*0.3,y+0.12,k.z+d/2+0.012],s:[w*0.26,0.72,0.025],c:zara?"#fff6de":"#d1e1d9"});
          accents.push({p:[k.x+side*w*0.48,y,k.z+d/2+0.025],s:[w*0.055,OFFICE_H,0.04],c:brand.primary});
        }
        doors.push({p:[k.x,y+0.03,k.z+d/2+0.028],s:[w*0.23,0.7,0.035],c:"#263e42"});
        accents.push({p:[k.x+w*0.055,y+0.28,k.z+d/2+0.05],s:[0.012,0.16,0.015],c:"#c9b98d"});
        if(cafe) {
          // A pitched cafe roof and timber louvers give the coffeehouse a softer silhouette.
          pediments.push({p:[k.x,y+OFFICE_H+0.08,k.z],s:[d*1.16,0.24,w*1.12],r:Math.PI/2,c:brand.roof});
          for(let slat=0;slat<5;slat++) accents.push({p:[k.x+w/2+0.02,y+0.18,k.z+(slat-2)*d*0.17],s:[0.035,0.76,0.035],c:"#a48862"});
          slabs.push({p:[k.x,y+0.9,k.z+d/2+0.12],s:[w*1.12,0.07,0.36],c:brand.primary});
          for(const side of [-1,1]) accents.push({p:[k.x+side*w*0.4,y+0.06,k.z+d/2+0.28],s:[0.12,0.16,0.12],c:"#3e5842"});
        } else if(zara) {
          // Sculpted ivory crown and dark vertical fins frame a fashion-house facade.
          slabs.push({p:[k.x,y+OFFICE_H+0.08,k.z],s:[w*0.8,0.24,d*0.78],c:"#eeeae0"});
          for(const side of [-1,1]) accents.push({p:[k.x+side*w*0.46,y+0.98,k.z+d/2+0.04],s:[0.045,1.72,0.08],c:"#181818"});
          for(let floor=0;floor<3;floor++) for(const side of [-1,1]) windows.push({p:[k.x+side*w*0.25,y+1.05+floor*0.4,k.z+d/2+0.014],s:[w*0.33,0.3,0.025],c:"#ffeed1"});
          slabs.push({p:[k.x,y+0.94,k.z+d/2+0.07],s:[w*1.05,0.04,0.22],c:"#171717"});
        } else if(k.name==="Wells Fargo") {
          // Classical branch portico: paired columns, broad steps and a triangular pediment.
          for(const side of [-1,1]) {
            accents.push({p:[k.x+side*w*0.36,y+0.12,k.z+d/2+0.17],s:[w*0.09,0.81,0.09],c:"#e9ddbc"});
            slabs.push({p:[k.x+side*w*0.36,y+0.9,k.z+d/2+0.17],s:[w*0.15,0.065,0.15],c:"#d7b66c"});
          }
          for(let step=0;step<3;step++) slabs.push({p:[k.x,y+step*0.035,k.z+d/2+0.18-step*0.035],s:[w*0.94,0.035,0.36-step*0.07],c:"#d2c5a7"});
          slabs.push({p:[k.x,y+0.95,k.z+d/2+0.15],s:[w*1.15,0.08,0.38],c:"#e4d7b7"});
          // Gable ends provide the familiar triangular bank entrance silhouette.
          pediments.push({p:[k.x,y+1.03,k.z+d/2+0.15],s:[0.38,0.3,w*1.12],r:Math.PI/2,c:"#d7b66c"});
          accents.push({p:[k.x-w*0.32,y+0.2,k.z+d/2+0.08],s:[0.12,0.25,0.06],c:"#36454a"});
        } else if(chipotle) {
          // Industrial brick parapet, metal rooftop vents and exposed facade joints.
          slabs.push({p:[k.x,y+OFFICE_H+0.08,k.z-d*0.36],s:[w*1.08,0.2,d*0.16],c:"#845544"});
          for(const side of [-1,1]) accents.push({p:[k.x+side*w*0.24,y+OFFICE_H+0.08,k.z],s:[0.1,0.23,0.1],c:"#8d9593"});
          for(let row=0;row<6;row++) accents.push({p:[k.x,y+0.1+row*0.16,k.z-d/2-0.01],s:[w,0.018,0.02],c:"#b98b72"});
          slabs.push({p:[k.x,y+0.94,k.z+d/2+0.08],s:[w*1.1,0.06,0.25],c:"#57463c"});
        } else {
          // A diner-style stepped red crown and cream checker trim distinguish Smashburger.
          slabs.push({p:[k.x,y+OFFICE_H+0.08,k.z],s:[w*0.68,0.23,d*0.8],c:"#bf292b"});
          for(let tile=0;tile<8;tile++) accents.push({p:[k.x+(tile-3.5)*w/8,y+0.18,k.z+d/2+0.025],s:[w/8,0.08,0.025],c:tile%2?"#f2e8d6":"#382c29"});
          slabs.push({p:[k.x,y+0.92,k.z+d/2+0.12],s:[w*1.12,0.09,0.32],c:"#bf292b"});
          accents.push({p:[k.x,y+0.09,k.z+d/2+0.03],s:[w,0.07,0.04],c:"#bf292b"});
        }
        continue;
      }
      walls.push({ p: [k.x, y, k.z], s: [w, OFFICE_H, d], c: brand.wall });
      slabs.push({ p: [k.x, y, k.z], s: [w * 1.08, 0.08, d * 1.1], c: brand.roof });
      slabs.push({ p: [k.x, y + OFFICE_H, k.z], s: [w * 1.08, 0.1, d * 1.12], c: brand.roof });
      if(k.name==="Anthropic") {
        // Keep facade ribs between the lobby and the dedicated sign band.
        for(let rib=0;rib<5;rib++) accents.push({p:[k.x+(rib-2)*w*0.21,y+0.72,k.z+d/2+0.025],s:[w*0.025,OFFICE_H-1.38,0.025],c:brand.primary});
        slabs.push({p:[k.x,y+OFFICE_H+0.1,k.z-d*0.08],s:[w*0.62,0.14,d*0.6],c:brand.primary});
      }
      if(k.name==="OpenAI") {
        // A layered glass pavilion with a floating green roof and an entrance portal.
        for(let tier=0;tier<3;tier++) slabs.push({p:[k.x,y+OFFICE_H+0.1+tier*0.12,k.z],s:[w*(1.14-tier*0.16),0.06,d*(1.14-tier*0.16)],c:tier%2?"#e8eeeb":brand.primary});
        for(const side of [-1,1]) accents.push({p:[k.x+side*w*0.22,y+0.04,k.z+d/2+0.08],s:[0.045,0.53,0.1],c:brand.primary});
      }
      // Six office floors with a regular curtain-wall grid and branded cornices.
      const floorCount=OFFICE_H < 2 ? 3 : 6;
      const floorSpacing=Math.min(0.36,(OFFICE_H-(k.name==="Anthropic"?1.1:0.68))/floorCount);
      for (let floor = 0; floor < floorCount; floor++) {
        slabs.push({ p: [k.x, y + 0.48 + floor * floorSpacing, k.z], s: [w * 1.03, 0.035, d * 1.04], c: floor % 2 ? brand.secondary : brand.primary });
        for (let col = 0; col < 3; col++) {
          windows.push({ p: [k.x + (col - 1) * w * 0.25, y + 0.58 + floor * floorSpacing, k.z + d / 2 + 0.008], s: [w * 0.17, 0.22, 0.018], c: "#fff5d9" });
          windows.push({ p: [k.x + w / 2 + 0.008, y + 0.58 + floor * floorSpacing, k.z + (col - 1) * d * 0.25], s: [0.018, 0.22, d * 0.17], c: "#e5e8e1" });
          windows.push({ p: [k.x + (col - 1) * w * 0.25, y + 0.58 + floor * floorSpacing, k.z - d / 2 - 0.008], s: [w * 0.17, 0.22, 0.018], c: "#fff5d9" });
          windows.push({ p: [k.x - w / 2 - 0.008, y + 0.58 + floor * floorSpacing, k.z + (col - 1) * d * 0.25], s: [0.018, 0.22, d * 0.17], c: "#e5e8e1" });
        }
      }
      // Slim corner columns and a recessed rooftop plant room give the offices a corporate silhouette.
      for (const side of [-1, 1]) {
        accents.push({ p: [k.x + side * w * 0.47, y + 0.08, k.z + d * 0.49], s: [w * 0.045, OFFICE_H - 0.08, 0.035], c: brand.roof });
      }
      if(k.name!=="Anthropic") slabs.push({ p: [k.x, y + OFFICE_H + 0.1, k.z - d * 0.12], s: [w * 0.48, 0.16, d * 0.45], c: brand.wall });
      accents.push({ p: [k.x - w * 0.43, y + 0.12, k.z + d / 2 + 0.012], s: [w * 0.09, OFFICE_H - 0.12, 0.035], c: brand.primary });
      accents.push({ p: [k.x + w / 2 + 0.012, y + 0.12, k.z - d * 0.43], s: [0.035, OFFICE_H - 0.12, d * 0.09], c: brand.secondary });
      doors.push({ p: [k.x, y + 0.08, k.z + d / 2 + 0.018], s: [w * 0.24, 0.34, 0.03], c: "#233e49" });
      slabs.push({ p: [k.x, y + 0.43, k.z + d * 0.38], s: [w * 0.5, 0.045, d * 0.3], c: brand.primary });
      if (brand.rounded) domes.push({ p: [k.x, y + OFFICE_H + 0.1, k.z], s: [w * 0.62, 0.2, d * 0.62], c: brand.primary });
      if (brand.stepped && k.name!=="Anthropic") slabs.push({ p: [k.x - w * 0.1, y + OFFICE_H + 0.1, k.z - d * 0.1], s: [w * 0.65, 0.2, d * 0.65], c: brand.secondary });
    }
    return { walls, slabs, accents, windows, domes, pediments, doors };
  }, [kiosks]);
  return <group>
    <Instanced items={items.walls} geometry={g.box} material={m.plain} pick={pick.of(kiosks.map(k => k.key))} />
    <Instanced items={items.slabs} geometry={g.box} material={m.plain} />
    <Instanced items={items.accents} geometry={g.box} material={m.plain} />
    <Instanced items={items.windows} geometry={g.box} material={m.glass} />
    <Instanced items={items.domes} geometry={g.cyl} material={m.plain} />
    <Instanced items={items.pediments} geometry={g.gable} material={m.plain} />
    <Instanced items={items.pediments} geometry={g.gableEnds} material={m.plain} />
    <EntranceDoors doors={items.doors} g={g} m={m} />
    {kiosks.map(k => <ToolSign key={k.key} tool={k} geometry={g.plane} />)}
  </group>;
}

function ToolSign({ tool, geometry }: { tool: Kiosk; geometry: THREE.PlaneGeometry }) {
  const texture = useMemo(() => {
    const brand = toolBrand(tool.name);
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 192;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 512, 192);
    gradient.addColorStop(0, brand.primary); gradient.addColorStop(1, brand.secondary);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 192);
    ctx.fillStyle = tool.name === "Zara" ? "#171717" : "#ffffff";
    if(tool.name==="Zara") {ctx.fillStyle="#f5f0e6";ctx.fillRect(0,0,512,192);ctx.fillStyle="#171717";}
    ctx.font = tool.name === "Canva" ? "italic 110px Georgia, serif" : "600 100px system-ui, sans-serif";
    if(tool.name==="Wells Fargo") {ctx.fillStyle="#f4d78e";ctx.font="bold 74px Georgia,serif";}
    if(tool.name==="Zara")ctx.font="110px Georgia,serif";
    if(tool.name==="Starbucks")ctx.font="bold 66px system-ui,sans-serif";
    if(tool.name==="Chipotle")ctx.font="bold 78px system-ui,sans-serif";
    if(tool.name==="Smashburger")ctx.font="bold 68px system-ui,sans-serif";
    if(tool.name==="Anthropic")ctx.font="600 82px Georgia,serif";
    if(tool.name==="OpenAI")ctx.font="600 96px system-ui,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(tool.name === "Splunk" ? "splunk>" : tool.name==="Zara"?"ZARA":tool.name==="Starbucks"?"STARBUCKS":tool.name==="Chipotle"?"CHIPOTLE":tool.name, 256, 100, 460);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, [tool.name]);
  const material = useMemo(() => signMaterial(texture), [texture]);
  useEffect(() => () => { material.dispose(); texture.dispose(); }, [material, texture]);
  const w = tool.size, y = TERRACE_H + toolOfficeHeight(tool.name) - (tool.name==="Anthropic"?0.32:0.08);
  return <group>
    <mesh geometry={geometry} material={material} position={[tool.x, y, tool.z + w * 0.4 + 0.035]} scale={[w * 0.94, w * 0.35, 1]} raycast={noRaycast} />
    <mesh geometry={geometry} material={material} position={[tool.x + w * 0.5 + 0.035, y, tool.z]} rotation={[0, Math.PI / 2, 0]} scale={[w * 0.73, w * 0.28, 1]} raycast={noRaycast} />
  </group>;
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
    // Front entrance panels are animated separately from the fixed facade glass.
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
      <EntranceDoors doors={towers.map(t=>({p:[t.x,FLOOR_BASE,t.z+t.size/2+0.025],s:[t.size*0.38,0.24,0.025]}))} g={g} m={m}/>
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
    const worker = t.agents + t.automations > 0 ? signMaterial(signTexture({ symbol: t.agents > 0 ? "agent" : "automation", style: "tech", accent: "#a5afa5" }, "Project workers")) : null;
    return { sign, frame, board, worker };
  }, [id, t.name, t.repository, t.agents, t.automations]);

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
      {mats.worker && <mesh geometry={g.plane} material={mats.worker} position={[t.x - s * 0.27, TERRACE_H + 0.55, t.z + s / 2 + 0.065]} scale={[s * 0.28, s * 0.28, 1]} raycast={noRaycast} />}
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

/** Residential landmark: Atlas-inspired green roofs, gold trim and a sheltered lobby. */
export function Skyline({parks,g,m,onSelect}:{parks:Scene3D["parks"];g:G;m:M;onSelect?:()=>void}) {
  const parts=useMemo(()=>{
    const walls:Inst[]=[],trim:Inst[]=[],roofs:Inst[]=[],glass:Inst[]=[],doors:Inst[]=[];
    for(const p of parks) {
      const x=p.x+p.w/2,z=p.z+p.d/2,y=TERRACE_H+0.03;
      for(const [offset,width,height] of [[0,1.5,4.5],[-1.22,0.95,2.6],[1.22,0.95,3.1]]) {
        walls.push({p:[x+offset,y+0.4,z],s:[width,height-0.4,0.95]});
        roofs.push({p:[x+offset,y+height,z],s:[width*1.12,0.4,1.08],c:"#294c40"});
        trim.push({p:[x+offset,y+height-0.06,z],s:[width*1.08,0.08,1.03],c:"#d3b36e"});
        for(const side of [-1,1]) trim.push({p:[x+offset+side*width*0.48,y,z+0.49],s:[0.035,height,0.035],c:"#d3b36e"});
        for(let floor=0;floor<Math.floor((height-0.7)/0.35);floor++) for(let col=-1;col<=1;col++) {
          glass.push({p:[x+offset+col*width*0.27,y+0.6+floor*0.35,z+0.483],s:[width*0.19,0.23,0.018],c:"#fff1cd"});
          glass.push({p:[x+offset+col*width*0.27,y+0.6+floor*0.35,z-0.483],s:[width*0.19,0.23,0.018],c:"#fff1cd"});
        }
        doors.push({p:[x+offset,y,z],s:[width,0.4,0.95],c:"#28434a"});
      }
      // Double glass lobby doors, framed in brass, on the residents' approach path.

      for(const side of [-1,1]) {
        trim.push({p:[x+side*0.3,y,z+0.51],s:[0.035,0.55,0.04],c:"#d3b36e"});

      }
      trim.push({p:[x,y+0.54,z+0.51],s:[0.64,0.035,0.04],c:"#d3b36e"});

      trim.push({p:[x,y+0.62,z+0.54],s:[0.76,0.035,0.24],c:"#d3b36e"});
      trim.push({p:[x,y+4.9,z],s:[0.045,0.35,0.045],c:"#d3b36e"});
    }
    return {walls,trim,roofs,glass,doors};
  },[parks]);
  return <group><Instanced items={parts.walls} geometry={g.box} material={m.facades.timber} pick={{keys:parts.walls.map(()=>"skyline"),over:()=>{},out:()=>{},click:()=>onSelect?.()}}/><Instanced items={parts.trim} geometry={g.box} material={m.plain}/><Instanced items={parts.roofs} geometry={g.hip} material={m.plain}/><Instanced items={parts.glass} geometry={g.box} material={m.glass}/><Instanced items={parts.doors} geometry={g.box} material={m.darkGlass}/><EntranceDoors doors={parks.map(p=>({p:[p.x+p.w/2,TERRACE_H+0.03,p.z+p.d/2+0.51],s:[0.56,0.52,0.025]}))} g={g} m={m}/></group>;
}
