import { useEffect, useMemo, useRef, useState } from "react";
import { usePageVisible, usePowerProfile } from "../../lib/power";
import { FramePacer } from "../map3d/pacer";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import FloorLabel from "./FloorLabel";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { patterned } from "../map3d/materials";
import type { LightMode } from "../map3d/living";
import { ElevatorLanding, MovingLift } from "./BuildingCirculation";
import LobbyEntrance from "./LobbyEntrance";
import {cutawayCameraRadius} from "./cameraFit";
import { useInteriorTrackpad } from "./useInteriorTrackpad";
import CutawayWall from "./CutawayWall";
import CityOutside from "./CityOutside";
import AtlasHqShell from "./AtlasHqShell";
import { isAtlasHq, shellAxes } from "./atlasHqInteriorPlan";
import { hash } from "../mapLayout";
import type { OfficePlan, Runtime, ToolIcon, Workstation } from "./model";
import { displayTexture, plateTexture, screenTexture, STATE_COLOR } from "./textures";

/** One desk's worth of display data, prepared by the office layer from verified sources. */
export interface DeskData {
  ws: Workstation;
  floor?: number;
  name: string;
  accent: string;
  icon: ToolIcon;
  runtime: Runtime;
  /** The task line on the monitor: the label of the execution the state rests on, or null. */
  task: string | null;
  when: string | null;
}

export interface OfficeApi {
  zoom: (factor: number) => void;
  orbit: (radians: number) => void;
  reset: () => void;
}

interface Props {
  floor?:number;
  plan: OfficePlan;
  desks: DeskData[];
  wall: { title: string; repo: string; line: string };
  light: LightMode;
  reduced: boolean;
  selected: string | null;
  onSelect: (agentId: string | null) => void;
  api: React.MutableRefObject<OfficeApi | null>;
}

/** VirtualOffice: an open-roof cutaway of a project's headquarters, one workstation per agent. */
export default function OfficeScene(props: Props) {
  const { desks, reduced } = props;
  // The lobby doors and the lift always move unless motion is reduced; the pacer sets their frame rate.
  const power = usePowerProfile();
  const visible = usePageVisible();
  return (
    <Canvas style={{position:"absolute",inset:0,zIndex:0}} shadows dpr={[1, power.maxDpr]} frameloop={visible ? "demand" : "never"} camera={{ fov: 32, near: 0.3, far: 200 }} gl={{ antialias: true, alpha: true }}>
      <FramePacer profile={power} running={!reduced} />
      <OfficeCamera allFloors={props.floor===-1} plan={props.plan} reduced={reduced} api={props.api} focus={props.selected ? props.desks.find((d) => d.ws.agentId === props.selected)?.ws : undefined} />
      <CityOutside allFloors={props.floor===-1} projectId={props.plan.projectId} span={Math.max(props.plan.w,props.plan.d)} elevation={Math.max(0,props.floor??0)*3.4}/>
      {props.floor===-1&&<group position={[0,0,props.plan.d/2+1.1]} scale={[props.plan.w/16,0.85,1]}><MovingLift reduced={reduced}/></group>}
      {(props.floor===-1?[0,1,2,3,4]:[props.floor??4]).map(level=><group key={level} position={[0,props.floor===-1?level*3.4:0,0]}>
        <FloorLabel level={level} width={props.plan.w} depth={props.plan.d+2}/>
        {props.floor!==undefined&&<Box p={[0,-0.06,props.plan.d/2+1]} s={[props.plan.w+0.4,0.12,2.2]} m={MAT.floor}/>}
        {isAtlasHq(props.plan.projectId)&&<AtlasHqShell w={props.plan.w} d={props.plan.d} level={level} night={props.light==="night"}/>}
        <OfficeEnvironment shell={isAtlasHq(props.plan.projectId)} plan={props.plan} wall={level<4?{...props.wall,line:["Welcome · Reception & business lobby","Collaboration · Meeting rooms","Research · Planning suites","Review · Training & expansion"][level]}:props.wall} light={props.light} count={desks.length} lighting={props.floor!==-1||level===4}/>
        {(level===0||props.floor===undefined)&&<LobbyEntrance z={isAtlasHq(props.plan.projectId)?shellAxes(props.plan.w,props.plan.d).b:props.plan.d/2+0.08} width={1.4} height={2.2}/>}
        {level<4&&!desks.some(d=>(d.floor??4)===level)&&<SharedFloor plan={props.plan} floor={level}/>}
        {props.floor!==undefined&&<group position={[0,0,props.plan.d/2+1.1]} scale={[props.plan.w/16,1,1]}><ElevatorLanding lobbyWalk={false} level={level} reduced={reduced} labels={props.floor!==-1}/></group>}
        {desks.some(d=>(d.floor??4)===level)&&<WorkflowFloor desks={desks.filter(d=>(d.floor??4)===level)}/>}
        {desks.filter(d=>(d.floor??4)===level).map(d=><AgentWorkstation key={d.ws.id} d={d} reduced={reduced} night={props.light==="night"} selected={props.selected===d.ws.agentId} onSelect={props.onSelect}/>)}
      </group>)}
    </Canvas>
  );
}

function SharedFloor({plan,floor}:{plan:OfficePlan;floor:number}) {
  const w=plan.w,d=plan.d;
  return <group>
    <Box p={[0,0.03,0]} s={[w*0.65,0.04,d*0.6]} m={MAT.rug}/>
    {floor===0?<group><Box p={[0,0.55,-d*0.2]} s={[Math.min(4,w*0.5),1.1,0.85]} m={MAT.trim}/><Box p={[0,1.12,-d*0.2]} s={[Math.min(4.2,w*0.52),0.08,1]} m={MAT.oak}/>{[-1,1].map(side=><group key={side}><Box p={[side*w*0.27,0.3,d*0.17]} s={[1.7,0.5,0.8]} m={MAT.chair}/><Box p={[side*w*0.27,0.65,d*0.17-0.35]} s={[1.7,0.6,0.12]} m={MAT.chair}/></group>)}</group>:<group>{[-1,1].map(side=><group key={side}><Box p={[side*w*0.23,0.75,0]} s={[Math.min(2.5,w*0.3),0.12,2]} m={MAT.oak}/>{[-1,1].map(row=><Box key={row} p={[side*w*0.23,0.4,row*1.35]} s={[0.65,0.7,0.6]} m={MAT.chair}/>)}</group>)}</group>}
    <Box p={[w/2-0.55,1.1,-d/2+0.15]} s={[0.9,2.2,0.08]} m={MAT.steel}/>
  </group>;
}

// ---------------------------------------------------------------- camera

type Pose = { target: THREE.Vector3; r: number; phi: number; theta: number };
const AZ = Math.PI / 4;

function OfficeCamera({ plan, reduced, api, focus, allFloors }: { allFloors:boolean; plan: OfficePlan; reduced: boolean; api: Props["api"]; focus?: Workstation }) {
  const { camera, gl, invalidate, size } = useThree();
  const home = useMemo<Pose>(() => ({ target: new THREE.Vector3(0, allFloors?8.1:0.7, allFloors?0.9:0.2), r: allFloors?cutawayCameraRadius(plan.w,plan.d,size.width/size.height):(Math.max(plan.w,plan.d)*0.95+2.5)*Math.max(1,0.8/(size.width/size.height)), phi: allFloors?1.05:0.98, theta: AZ }), [plan.w, plan.d,allFloors,size.width,size.height]);
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.enablePan = false;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.9;
    // All the way round: the walls between the camera and the room step aside (CutawayWall).
    // Stay above the floor.
    c.minPolarAngle = 0.42;
    c.maxPolarAngle = 1.22;
    return c;
  }, [camera, gl]);
  // Registered as the canvas's default controls, as drei's makeDefault does in the other interiors.
  const setState = useThree((st) => st.set);
  useEffect(() => {
    setState({ controls: controls as unknown as THREE.EventDispatcher });
    return () => setState({ controls: null });
  }, [controls, setState]);
  useEffect(() => {
    controls.minDistance = 4;
    controls.maxDistance = home.r * 1.7;
  }, [controls, home]);
  const anim = useRef<{ t0: number; ms: number; from: Pose; to: Pose } | null>(null);
  // Mac trackpad: look around through a full circle, pinch, twist, Option-scroll to move.
  useInteriorTrackpad(() => controls, { x: plan.w / 2, z: plan.d / 2 + 1 }, () => (anim.current = null));
  const sph = useMemo(() => new THREE.Spherical(), []);

  const current = (): Pose => {
    sph.setFromVector3(camera.position.clone().sub(controls.target));
    return { target: controls.target.clone(), r: sph.radius, phi: sph.phi, theta: sph.theta };
  };
  const apply = (p: Pose) => {
    controls.target.copy(p.target);
    sph.set(p.r, p.phi, p.theta);
    camera.position.copy(p.target).add(new THREE.Vector3().setFromSpherical(sph));
    camera.lookAt(p.target);
  };
  const glide = (to: Pose, ms = 520) => {
    if (reduced) {
      anim.current = null;
      apply(to);
    } else {
      // Turn the short way round: the view can now be anywhere on the circle.
      const from = current();
      const turn = THREE.MathUtils.euclideanModulo(to.theta - from.theta + Math.PI, Math.PI * 2) - Math.PI;
      anim.current = { t0: performance.now(), ms, from, to: { ...to, theta: from.theta + turn } };
    }
    invalidate();
  };

  useEffect(() => {
    const on = () => invalidate();
    controls.connect(gl.domElement);
    controls.addEventListener("change", on);
    const stop = () => (anim.current = null);
    controls.addEventListener("start", stop);
    // Arrive with a short descent into the room, the way the map glides in.
    apply(reduced ? home : { ...home, r: home.r * 1.55, phi: 0.62, theta: AZ - 0.25 });
    if (!reduced) glide(home, 1100);
    return () => {
      controls.removeEventListener("change", on);
      controls.removeEventListener("start", stop);
      controls.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, home]);

  // Selecting a desk leans the view toward it; clearing the selection leaves the camera alone.
  useEffect(() => {
    if (!focus) return;
    const c = current();
    glide({ ...c, target: new THREE.Vector3(focus.x * 0.6, allFloors?14.4:0.8, focus.z * 0.6 + 0.2), r: Math.min(c.r, home.r * 0.82) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id]);

  api.current = {
    zoom: (f) => {
      const c = current();
      glide({ ...c, r: THREE.MathUtils.clamp(c.r / f, controls.minDistance, controls.maxDistance) }, 320);
    },
    orbit: (d) => {
      const c = current();
      glide({ ...c, theta: THREE.MathUtils.clamp(c.theta + d, controls.minAzimuthAngle, controls.maxAzimuthAngle) }, 420);
    },
    reset: () => glide(home, 620),
  };

  useFrame(() => {
    const a = anim.current;
    if (a) {
      const p = Math.min(1, (performance.now() - a.t0) / a.ms);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const L = THREE.MathUtils.lerp;
      apply({ target: a.from.target.clone().lerp(a.to.target, e), r: L(a.from.r, a.to.r, e), phi: L(a.from.phi, a.to.phi, e), theta: L(a.from.theta, a.to.theta, e) });
      if (p >= 1) anim.current = null;
      invalidate();
    }
    controls.update();
  });
  return null;
}

// ---------------------------------------------------------------- shared geometry and materials

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
const SPHERE = new THREE.SphereGeometry(0.5, 20, 14);
const LEAF = new THREE.IcosahedronGeometry(0.5, 0);
const TORSO = new THREE.CapsuleGeometry(0.17, 0.26, 4, 12);
const RING = new THREE.RingGeometry(0.9, 0.98, 48);

const std = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
const MAT = {
  floor: patterned("#d8d2c3", "stone", { roughness: 0.75 }),
  rug: std("#2f4535", { roughness: 1 }),
  wall: std("#ece5d2"),
  trim: std("#2f4535", { roughness: 0.6 }),
  frame: std("#3a4a3f", { roughness: 0.5, metalness: 0.2 }),
  grass: patterned("#8fae6a", "grass"),
  oak: std("#c49a6c", { roughness: 0.55 }),
  steel: std("#a8aea6", { roughness: 0.35, metalness: 0.6 }),
  dark: std("#232a26", { roughness: 0.45, metalness: 0.3 }),
  key: std("#e9e6dc", { roughness: 0.6 }),
  chair: std("#36403a", { roughness: 0.7 }),
  skin: [std("#f0c9a4"), std("#d9a27a"), std("#a8714d"), std("#7a4f33")],
  hair: [std("#2b2420"), std("#5a3a22"), std("#b88a4a"), std("#d9d2c4")],
  pot: std("#b8836a", { roughness: 0.9 }),
  leaf: std("#4f7f4a", { roughness: 0.9, flatShading: true }),
  leaf2: std("#6a9a52", { roughness: 0.9, flatShading: true }),
  inactive: std("#8e938b"),
  pane: new THREE.MeshStandardMaterial({ color: "#cfe6f2", emissive: "#cfe6f2", emissiveIntensity: 0.02, transparent:true,opacity:0.14,depthWrite:false, roughness: 0.1, metalness: 0.1 }),
  led: new THREE.MeshBasicMaterial({ color: "#7fdc8e" }),
  ledOff: new THREE.MeshBasicMaterial({ color: "#3d4a41" }),
};

const shadow = { castShadow: true, receiveShadow: true } as const;

function Box({ p, s, m, r }: { p: [number, number, number]; s: [number, number, number]; m: THREE.Material; r?: [number, number, number] }) {
  return <mesh geometry={BOX} material={m} position={p} scale={s} rotation={r} {...shadow} />;
}

// ---------------------------------------------------------------- environment

/** OfficeEnvironment: floor, cutaway walls with windows, wall display, server rack and plants. */
function OfficeEnvironment({ plan, wall, light, count, lighting=true, shell=false }: { plan: OfficePlan; wall: Props["wall"]; light: LightMode; count: number; lighting?:boolean; shell?: boolean }) {
  const { w, d } = plan;
  const night = light === "night";
  const H = 2.7;
  const T = 0.16;
  const display = useMemo(() => displayTexture(wall.title, wall.repo, wall.line, count), [wall.title, wall.repo, wall.line, count]);
  useEffect(() => () => display.dispose(), [display]);
  useEffect(() => {
    MAT.pane.color.set(night ? "#22314f" : "#cfe6f2");
    MAT.pane.emissive.set(night ? "#2c3f66" : "#cfe6f2");
    MAT.pane.emissiveIntensity = 0.02;
  }, [night]);
  const sun = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const s = sun.current;
    if (!s) return;
    const c = s.shadow.camera;
    c.left = c.bottom = -Math.max(w, d);
    c.right = c.top = Math.max(w, d);
    c.updateProjectionMatrix();
  }, [w, d]);
  // Windows: three on the left wall, two on the back wall either side of the display.
  const leftWins = [-d / 3, 0, d / 3];
  const backWins = [-w / 2 + w * 0.17, w / 2 - w * 0.17];
  return (
    <group>
      {lighting&&<hemisphereLight args={[night ? "#9fb4d8" : "#fff6e4", night ? "#2a3328" : "#8a9a7a", night ? 0.65 : 1.2]} />}
      {lighting&&<directionalLight ref={sun} castShadow position={[-6, 11, 7]} intensity={night ? 0.35 : 2.1} color={night ? "#a8b8e0" : "#fff0d2"} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0005} shadow-normalBias={0.03} />}
      {/* After dark the room lights are on. */}
      {night && [-1,1].map(side=><group key={side}><pointLight position={[0,2.3,side*d*0.24]} intensity={30} distance={Math.max(w,d)*1.3} decay={1.6} color="#ffe1af"/><mesh position={[0,2.6,side*d*0.24]}><boxGeometry args={[1.2,0.045,0.5]}/><meshStandardMaterial color="#f1e3c4" emissive="#ffe2aa" emissiveIntensity={1.5}/></mesh></group>)}


      <Box p={[0, 0.006, 0.25]} s={[w - 2.6, 0.012, d - 3]} m={MAT.rug} />
      {/* A building with its own shell (Atlas HQ) draws its own slab, glass and core instead. */}
      {!shell&&<>
      <Box p={[0, -0.06, 0]} s={[w + T * 2, 0.12, d + T * 2]} m={MAT.floor} />

      {/* Back and left walls stand full height; the front two are cut down to a sill. A full
          wall steps aside while the camera looks in from its side, so the room turns all the way round. */}
      <CutawayWall side="back">
      {[0.45,2.45].map((y,i)=><Box key={y} p={[0,y,-d/2-T/2]} s={[w+T*2,i?0.5:0.9,T]} m={MAT.wall}/>)}
      {[-w/2-T,...backWins.map(x=>x+0.65)].map((start,i)=>{const end=i<backWins.length?backWins[i]-0.65:w/2+T;return end>start?<Box key={i} p={[(start+end)/2,1.55,-d/2-T/2]} s={[end-start,1.3,T]} m={MAT.wall}/>:null;})}
      <Box p={[0, H + 0.03, -d / 2 - T / 2]} s={[w + T * 2 + 0.04, 0.06, T + 0.04]} m={MAT.trim} />
      {backWins.map((x) => (
        <group key={`b${x}`} position={[x, 1.55, -d / 2 + 0.005]}>
          {[-1,1].map(side=><group key={side}><Box p={[side*0.65,0,0]} s={[0.06,1.3,0.04]} m={MAT.frame}/><Box p={[0,side*0.65,0]} s={[1.3,0.06,0.04]} m={MAT.frame}/></group>)}
          <Box p={[0, 0, 0.02]} s={[1.18, 1.18, 0.02]} m={MAT.pane} />
          <Box p={[0, 0, 0.04]} s={[0.04, 1.18, 0.02]} m={MAT.frame} />
        </group>
      ))}
      </CutawayWall>
      <CutawayWall side="left">
      {[0.45,2.45].map((y,i)=><Box key={y} p={[-w/2-T/2,y,0]} s={[T,i?0.5:0.9,d]} m={MAT.wall}/>)}
      {[-d/2,...leftWins.map(z=>z+0.75)].map((start,i)=>{const end=i<leftWins.length?leftWins[i]-0.75:d/2;return end>start?<Box key={i} p={[-w/2-T/2,1.55,(start+end)/2]} s={[T,1.3,end-start]} m={MAT.wall}/>:null;})}
      <Box p={[-w / 2 - T / 2, H + 0.03, 0]} s={[T + 0.04, 0.06, d]} m={MAT.trim} />
      {leftWins.map((z) => (
        <group key={`l${z}`} position={[-w / 2 + 0.005, 1.55, z]}>
          {[-1,1].map(side=><group key={side}><Box p={[0,side*0.65,0]} s={[0.04,0.06,1.5]} m={MAT.frame}/><Box p={[0,0,side*0.75]} s={[0.04,1.3,0.06]} m={MAT.frame}/></group>)}
          <Box p={[0.02, 0, 0]} s={[0.02, 1.18, 1.38]} m={MAT.pane} />
          <Box p={[0.04, 0, 0]} s={[0.02, 1.18, 0.04]} m={MAT.frame} />
        </group>
      ))}
      </CutawayWall>
      {[-1,1].map(side=><Box key={side} p={[side*(w/4+0.35),0.16,d/2+T/2]} s={[w/2-0.7+T*2,0.32,T]} m={MAT.wall}/>)}
      <Box p={[w / 2 + T / 2, 0.16, 0]} s={[T, 0.32, d]} m={MAT.wall} />
      <Box p={[0, 0.34, d / 2 + T / 2]} s={[w + T * 2 + 0.04, 0.04, T + 0.04]} m={MAT.trim} />
      <Box p={[w / 2 + T / 2, 0.34, 0]} s={[T + 0.04, 0.04, d]} m={MAT.trim} />

      </>}

      {/* Wall display: the project and its verified CI line, the same facts as the map. */}
      <CutawayWall side="back" always={shell}>
      <group position={[0, 1.6, -d / 2 + 0.03]}>
        <Box p={[0, 0, 0]} s={[2.5, 1.3, 0.06]} m={MAT.dark} />
        <mesh position={[0, 0, 0.035]}>
          <planeGeometry args={[2.36, 1.18]} />
          <meshBasicMaterial map={display} toneMapped={false} />
        </mesh>
      </group>
      </CutawayWall>

      {/* Server rack in the back corner. Its lights are decoration, not telemetry. */}
      <group position={shell ? [-w / 2 + 1.0, 0, -d / 2 + 1.0] : [-w / 2 + 0.55, 0, -d / 2 + 0.55]}>
        <Box p={[0, 0.95, 0]} s={[0.62, 1.9, 0.62]} m={MAT.dark} />
        {[0.5, 0.8, 1.1, 1.4, 1.7].map((y, i) => (
          <group key={y}>
            <Box p={[0.12, y, 0.315]} s={[0.4, 0.2, 0.01]} m={MAT.frame} />
            <mesh geometry={BOX} material={i % 2 ? MAT.ledOff : MAT.led} position={[-0.2, y, 0.32]} scale={[0.03, 0.03, 0.01]} />
          </group>
        ))}
      </group>

      <Plant p={[w / 2 - 0.5, 0, -d / 2 + 0.5]} s={1.1} />
      <Plant p={[-w / 2 + 0.5, 0, d / 2 - 0.5]} s={0.9} />
      <Plant p={[-w / 2 + 1.35, 0, -d / 2 + 0.45]} s={0.7} />
    </group>
  );
}

function Plant({ p, s }: { p: [number, number, number]; s: number }) {
  return (
    <group position={p} scale={s}>
      <mesh geometry={CYL} material={MAT.pot} position={[0, 0.22, 0]} scale={[0.42, 0.44, 0.42]} {...shadow} />
      <mesh geometry={LEAF} material={MAT.leaf} position={[0, 0.72, 0]} scale={[0.62, 0.7, 0.62]} {...shadow} />
      <mesh geometry={LEAF} material={MAT.leaf2} position={[0.12, 1.02, 0.05]} scale={[0.4, 0.46, 0.4]} rotation={[0.4, 0.6, 0]} {...shadow} />
    </group>
  );
}

// ---------------------------------------------------------------- workstation

/** AgentWorkstation: desk, monitor, keyboard, chair, nameplate, the agent and its status. */
function AgentWorkstation({ d, reduced, night, selected, onSelect }: { d: DeskData; reduced: boolean; night: boolean; selected: boolean; onSelect: (id: string | null) => void }) {
  const [hover, setHover] = useState(false);
  const { state } = d.runtime;
  const screen = useMemo(() => screenTexture({ name: d.name, icon: d.icon, accent: d.accent, state, task: d.task, when: d.when }), [d.name, d.icon, d.accent, state, d.task, d.when]);
  const plate = useMemo(() => plateTexture(d.name, d.accent, d.icon), [d.name, d.accent, d.icon]);
  useEffect(() => () => screen.dispose(), [screen]);
  useEffect(() => () => plate.dispose(), [plate]);
  useEffect(() => {
    document.body.style.cursor = hover ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover]);
  const dim = state === "offline";
  const glow = dim ? 0 : state === "unknown" ? 0.18 : 0.38 + (night ? 0.2 : 0);
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 4) return;
    onSelect(selected ? null : d.ws.agentId);
  };

  return (
    <group
      position={[d.ws.x, 0, d.ws.z]}
      rotation={[0, d.ws.ry, 0]}
      onClick={click}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
    >
      {(selected || hover) && (
        <mesh geometry={RING} position={[0, 0.02, 0.3]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.05, 1.05, 1]} raycast={() => null}>
          <meshBasicMaterial color={selected ? "#c9a35a" : "#fff6d8"} transparent opacity={selected ? 0.95 : 0.7} depthWrite={false} />
        </mesh>
      )}
      {/* Desk */}
      <Box p={[0, 0.74, 0]} s={[1.5, 0.05, 0.76]} m={MAT.oak} />
      <Box p={[-0.7, 0.36, 0]} s={[0.05, 0.72, 0.7]} m={MAT.steel} />
      <Box p={[0.7, 0.36, 0]} s={[0.05, 0.72, 0.7]} m={MAT.steel} />
      <Box p={[0, 0.5, -0.33]} s={[1.36, 0.36, 0.03]} m={MAT.steel} />
      {/* Monitor and its soft spill on the desk */}
      <Box p={[0, 0.82, -0.2]} s={[0.22, 0.02, 0.16]} m={MAT.dark} />
      <Box p={[0, 0.94, -0.24]} s={[0.05, 0.22, 0.04]} m={MAT.dark} />
      <Box p={[0, 1.18, -0.22]} s={[0.84, 0.5, 0.04]} m={MAT.dark} />
      <mesh position={[0, 1.18, -0.198]}>
        <planeGeometry args={[0.78, 0.44]} />
        <meshBasicMaterial map={screen} toneMapped={false} color={dim ? "#555" : "#fff"} />
      </mesh>
      <mesh position={[0, 0.768, -0.02]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[1.0, 0.5]} />
        <meshBasicMaterial color={d.accent} transparent opacity={glow * 0.35} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <Box p={[0, 0.775, 0.08]} s={[0.52, 0.02, 0.17]} m={MAT.key} />
      <Box p={[0.38, 0.775, 0.1]} s={[0.07, 0.02, 0.11]} m={MAT.key} />
      <mesh geometry={CYL} material={MAT.key} position={[-0.52, 0.81, -0.05]} scale={[0.08, 0.1, 0.08]} {...shadow} />
      {/* Nameplate on top of the monitor */}
      <mesh position={[0, 1.6, -0.22]} rotation={[-0.12, 0, 0]}>
        <planeGeometry args={[1.12, 0.21]} />
        <meshBasicMaterial map={plate} toneMapped={false} transparent />
      </mesh>
      <AgentStatusIndicator state={state} reduced={reduced} />
      <Chair />
      <AgentCharacter seed={d.ws.agentId} accent={d.accent} state={state} reduced={reduced} />
    </group>
  );
}

function Chair() {
  return (
    <group position={[0, 0, 0.66]}>
      <Box p={[0, 0.46, 0]} s={[0.5, 0.07, 0.48]} m={MAT.chair} />
      <Box p={[0, 0.8, 0.24]} s={[0.48, 0.56, 0.07]} m={MAT.chair} r={[-0.08, 0, 0]} />
      <mesh geometry={CYL} material={MAT.steel} position={[0, 0.24, 0]} scale={[0.05, 0.42, 0.05]} {...shadow} />
      <Box p={[0, 0.04, 0]} s={[0.5, 0.04, 0.08]} m={MAT.steel} />
      <Box p={[0, 0.04, 0]} s={[0.08, 0.04, 0.5]} m={MAT.steel} />
    </group>
  );
}

/** AgentCharacter: a seated miniature figure. Types only while a run is observed in progress. */
function AgentCharacter({ seed, accent, state, reduced }: { seed: string; accent: string; state: Runtime["state"]; reduced: boolean }) {
  const shirt = useMemo(() => std(accent, { roughness: 0.85 }), [accent]);
  useEffect(() => () => shirt.dispose(), [shirt]);
  const h = hash(seed);
  const skin = MAT.skin[Math.floor(h * 4) % 4];
  const hair = MAT.hair[Math.floor(h * 17) % 4];
  const inactive = state === "offline";
  const L = useRef<THREE.Group>(null);
  const R = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  // Arms: on the keys while working, lifted off them while waiting for approval, resting otherwise.
  const rest = state === "working" ? 1.25 : state === "awaiting" ? 0.95 : 0.55;
  useFrame(({ clock }) => {
    if (!L.current || !R.current || !head.current) return;
    const t = clock.elapsedTime;
    const typing = state === "working" && !reduced;
    L.current.rotation.x = rest + (typing ? Math.sin(t * 13) * 0.07 : 0);
    R.current.rotation.x = rest + (typing ? Math.sin(t * 13 + 1.7) * 0.07 : 0);
    head.current.rotation.x = inactive ? -0.4 : typing ? -0.08 + Math.sin(t * 2.1) * 0.03 : 0.05;
  });
  return (
    <group position={[0, 0, 0.62]}>
      {/* Legs under the desk */}
      <Box p={[-0.1, 0.55, -0.2]} s={[0.15, 0.13, 0.44]} m={inactive ? MAT.inactive : MAT.chair} />
      <Box p={[0.1, 0.55, -0.2]} s={[0.15, 0.13, 0.44]} m={inactive ? MAT.inactive : MAT.chair} />
      <mesh geometry={TORSO} material={inactive ? MAT.inactive : shirt} position={[0, 0.86, 0.04]} rotation={[inactive ? 0.18 : -0.06, 0, 0]} {...shadow} />
      <group ref={head} position={[0, 1.18, 0.02]}>
        <mesh geometry={SPHERE} material={skin} position={[0, 0.07, 0]} scale={0.27} {...shadow} />
        <mesh geometry={SPHERE} material={hair} position={[0, 0.12, 0.03]} scale={[0.285, 0.24, 0.285]} {...shadow} />
      </group>
      {[L, R].map((ref, i) => (
        <group key={i} ref={ref} position={[i ? 0.21 : -0.21, 0.98, 0.02]} rotation={[rest, 0, 0]}>
          <mesh geometry={BOX} material={inactive ? MAT.inactive : shirt} position={[0, -0.2, 0]} scale={[0.08, 0.4, 0.09]} {...shadow} />
          <mesh geometry={SPHERE} material={skin} position={[0, -0.42, 0]} scale={0.08} />
        </group>
      ))}
    </group>
  );
}

/** AgentStatusIndicator: a lamp on the desk, and a marker above the desk when a person is needed. */
function AgentStatusIndicator({ state, reduced }: { state: Runtime["state"]; reduced: boolean }) {
  const color = STATE_COLOR[state];
  const lamp = useRef<THREE.MeshBasicMaterial>(null);
  const marker = useRef<THREE.Group>(null);
  const flag = state === "awaiting" || state === "failed";
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (lamp.current) lamp.current.opacity = state === "working" && !reduced ? 0.75 + Math.sin(t * 4) * 0.25 : 1;
    if (marker.current && !reduced) marker.current.position.y = 1.98 + (state === "awaiting" ? Math.sin(t * 2.4) * 0.04 : 0);
  });
  return (
    <group>
      <mesh geometry={CYL} material={MAT.dark} position={[0.6, 0.79, -0.24]} scale={[0.09, 0.05, 0.09]} />
      <mesh geometry={SPHERE} position={[0.6, 0.85, -0.24]} scale={0.085}>
        <meshBasicMaterial ref={lamp} color={color} transparent toneMapped={false} />
      </mesh>
      {flag && (
        <group ref={marker} position={[0, 1.98, -0.22]}>
          <mesh rotation={[0, Math.PI / 4, 0]} scale={[0.2, 0.2, 0.2]}>
            <octahedronGeometry args={[1, 0]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}

const FLOOR_ZONES = {
  coordination: {label:"Coordination",color:"#aa8951"},
  research: {label:"Research",color:"#6a8d91"},
  production: {label:"Production",color:"#7a9073"},
  quality: {label:"Quality review",color:"#8d819b"},
};

/** Small floor inlays mark work areas without obscuring desks or implying live progress. */
function WorkflowFloor({desks}:{desks:DeskData[]}) {
  const textures=useMemo(()=>Object.fromEntries(Object.entries(FLOOR_ZONES).map(([key,zone])=>{
    const canvas=document.createElement("canvas");canvas.width=512;canvas.height=96;
    const ctx=canvas.getContext("2d")!;ctx.fillStyle=zone.color;ctx.font="500 38px system-ui,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(zone.label.toUpperCase()+"  →",256,48);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;return [key,map];
  })),[]);
  useEffect(()=>()=>Object.values(textures).forEach(t=>t.dispose()),[textures]);
  return <group>{desks.map(({ws})=>{
    const zone=FLOOR_ZONES[ws.zone];
    return <group key={ws.id} position={[ws.x,0.025,ws.z]}>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0,0.15]} raycast={()=>null}><planeGeometry args={[2.12,2.22]}/><meshStandardMaterial color={zone.color} transparent opacity={0.075} depthWrite={false}/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.002,1.16]} raycast={()=>null}><planeGeometry args={[1.95,0.018]}/><meshBasicMaterial color={zone.color} transparent opacity={0.55} depthWrite={false}/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.003,1.03]} raycast={()=>null}><planeGeometry args={[1.72,0.25]}/><meshBasicMaterial map={textures[ws.zone]} transparent opacity={0.75} depthWrite={false}/></mesh>
    </group>;
  })}</group>;
}
