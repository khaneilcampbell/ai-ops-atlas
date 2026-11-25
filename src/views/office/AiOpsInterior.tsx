import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Canvas,useThree} from '@react-three/fiber';
import {Html,OrbitControls} from '@react-three/drei';
import type {OrbitControls as OrbitControlsImpl} from 'three-stdlib';
import * as THREE from 'three';
import {usePageVisible,usePowerProfile} from '../../lib/power';
import {useReducedMotion} from '../../lib/motion';
import {FramePacer} from '../map3d/pacer';
import {night as cityNight} from '../map3d/materials';
import type {LightMode} from '../map3d/living';
import {slab} from '../map3d/ribbonTowerGeometry';
import {wall} from '../map3d/aiOpsCenterGeometry';
import {AIOPS,AIOPS_KEY,AIOPS_NAME,PODIUM_H,floorElevation,planAiOps,podiumRing} from '../map3d/aiOpsCenterPlan';
import {buildingDisplayName} from '../../modules/names';
import {catalog} from '../../catalog';
import type {Agent} from '../../catalog/types';
import CityOutside from './CityOutside';
import FloorLabel from './FloorLabel';
import {WorkplaceInspector} from './WorkplaceInspector';
import {lookHint,useInteriorTrackpad} from './useInteriorTrackpad';
import {leaveBuilding} from './store';
import {AIOPS_LEVELS,INTERIOR_K,STOREY,interiorFloor,type InteriorFloor} from './aiOpsInteriorPlan';
import '../../styles/skyline.css';

const shown=()=>buildingDisplayName(AIOPS_KEY,AIOPS_NAME);
type Item={p:[number,number,number];s:[number,number,number];c:string;r?:number};

function Boxes({items,shadow=true}:{items:Item[];shadow?:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null);
 useLayoutEffect(()=>{const m=ref.current;if(!m)return;const o=new THREE.Object3D(),c=new THREE.Color();
  items.forEach((b,i)=>{o.position.set(b.p[0],b.p[1]+b.s[1]/2,b.p[2]);o.rotation.set(0,b.r??0,0);o.scale.set(...b.s);o.updateMatrix();m.setMatrixAt(i,o.matrix);m.setColorAt(i,c.set(b.c));});
  m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;m.computeBoundingSphere();},[items]);
 if(!items.length)return null;
 return <instancedMesh key={items.length} ref={ref} args={[undefined,undefined,items.length]} castShadow={shadow} receiveShadow><boxGeometry/><meshStandardMaterial roughness={.6}/></instancedMesh>;
}

/** Agents the catalog seats here, by floor. Static figures; seating is not live work. */
const SEATED=catalog.agents.filter(a=>a.workplace?.building===AIOPS_NAME);

function Floor({f,single,night,onPick,onAgent}:{f:InteriorFloor;single:boolean;night:boolean;onPick:(t:string)=>void;onAgent:(a:Agent)=>void}){
 const geo=useMemo(()=>{
  const outline=f.outline;
  return {
   slab:slab(outline,0,.25),
   // Curtain glass: the exterior's own glass colours and floor rhythm, up to the ceiling.
   glass:wall([outline.map(([x,z])=>[x,0,z] as [number,number,number]),outline.map(([x,z])=>[x,STOREY-.3,z] as [number,number,number])],.3*INTERIOR_K,(STOREY-.3)/4),
  };
 },[f]);
 useEffect(()=>()=>{geo.slab.dispose();geo.glass.dispose();},[geo]);
 const seated=SEATED.filter(a=>a.workplace!.floor===f.level);
 return <group>
  <mesh geometry={geo.slab} receiveShadow castShadow><meshStandardMaterial color={f.level===0?'#e9e2d3':'#ece7dc'} roughness={.75}/></mesh>
  <mesh geometry={geo.glass}><meshStandardMaterial color={f.glass} transparent opacity={.28} depthWrite={false} side={THREE.DoubleSide} emissive="#ffd9a0" emissiveIntensity={night?.2:0} roughness={.1} metalness={.3}/></mesh>
  <Boxes items={f.items}/>
  {f.drum&&<mesh position={[f.drum.x,(STOREY-.3)/2,f.drum.z]}><cylinderGeometry args={[f.drum.r,f.drum.r,STOREY-.3,40,1,true]}/><meshStandardMaterial color="#cfe2dc" transparent opacity={.3} depthWrite={false} side={THREE.DoubleSide}/></mesh>}
  {f.drum&&<mesh position={[f.drum.x,STOREY-.6,f.drum.z]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[f.drum.r*.6,.08,8,48]}/><meshStandardMaterial color="#f3d18f" emissive="#ffcf7a" emissiveIntensity={night?1.6:.6}/></mesh>}
  <FloorLabel level={f.level} width={f.span[0]} depth={f.span[1]}/>
  {single&&f.desks.map(d=><Html key={d.id} position={[d.x,2.2,d.z]} center zIndexRange={[8,0]}><button className="skyline-room-label" onClick={()=>onPick(`${f.label} · ${d.role} · Planned, not running`)}>{d.label}<span>{d.role}</span></button></Html>)}
  {single&&seated.map((a,i)=>{const d=f.desks[i%Math.max(1,f.desks.length)];return d?<Html key={a.id} position={[d.x,2.9,d.z]} center zIndexRange={[9,0]}><button className="skyline-room-label" onClick={()=>onAgent(a)}>{a.registry?.title??a.name}<span>Seated · Configured, not verified</span></button></Html>:null;})}
  <pointLight position={[f.core.x,STOREY-.8,f.core.z]} color="#ffd9a8" intensity={night?40:8} distance={26} decay={2}/>
 </group>;
}

/** On a tower floor seen alone: the podium and its planted terrace below, so the floor stands at its real height. */
function Podium({below}:{below:number}){
 const geo=useMemo(()=>slab(podiumRing(1).map(([x,z])=>[x*INTERIOR_K,z*INTERIOR_K] as [number,number]),PODIUM_H*INTERIOR_K-below,PODIUM_H*INTERIOR_K),[below]);
 useEffect(()=>()=>geo.dispose(),[geo]);
 return <mesh geometry={geo} receiveShadow castShadow><meshStandardMaterial color={AIOPS.palette.lawn} roughness={.9}/></mesh>;
}

function Camera({all}:{all:boolean}){
 const controls=useRef<OrbitControlsImpl>(null);const {camera,invalidate,size}=useThree();
 const far=size.width<size.height?Math.min(2.2,1.15/(size.width/size.height)**.75):1;
 useLayoutEffect(()=>{
  const eye=(all?[28,34,44]:[16,26,30]).map(v=>v*far) as [number,number,number];
  camera.position.set(...eye);const t=controls.current?.target;if(t){t.set(0,all?6:0,0);camera.lookAt(t);controls.current?.update();}invalidate();
 },[all,camera,invalidate,far]);
 useInteriorTrackpad(()=>controls.current,{x:16,z:12});
 return <OrbitControls ref={controls} makeDefault minDistance={12} maxDistance={160} maxPolarAngle={Math.PI/2.25}/>;
}

/**
 * Inside the Atlas AI Operations Center: the lobby and operations floor in the podium and three tower floors,
 * each drawn from the same outlines, glass colours and bronze ribbon as the map model (aiOpsInteriorPlan.ts).
 * Every floor has a desk for its planned role; agents the catalog seats here show at those desks.
 */
export default function AiOpsInterior({light}:{light:LightMode}){
 const [floor,setFloor]=useState(-1);const [picked,setPicked]=useState<string|null>(null);const [agent,setAgent]=useState<Agent|null>(null);
 const power=usePowerProfile(),visible=usePageVisible(),reduced=useReducedMotion(),isNight=light==='night';
 useEffect(()=>{cityNight.value=isNight?1:0;},[isNight]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();leaveBuilding(true);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[]);
 const floors=useMemo(()=>AIOPS_LEVELS.map(l=>interiorFloor(l)),[]);
 const all=floor===-1,shownFloors=all?floors:[floors[floor]];
 const current=floors[floor];
 return <section className={`skyline-interior ${isNight?'night':'day'}`} aria-label={`${shown()} interior`}>
  <Canvas style={{position:'absolute',inset:0,zIndex:0}} frameloop={visible?"demand":"never"} dpr={[1,power.maxDpr]} shadows="percentage" camera={{position:[28,34,44],fov:40}}>
   <FramePacer profile={power} running={!reduced}/>
   <color attach="background" args={[isNight?'#101b2c':'#dbe2d8']}/>
   <ambientLight color={isNight?'#c1cfed':'#ffffff'} intensity={isNight?.3:.75}/>
   <hemisphereLight args={[isNight?'#91abdc':'#eef6ff',isNight?'#303e35':'#8c7e64',isNight?.45:1.25]}/>
   <directionalLight color={isNight?'#99b8ed':'#fff4da'} position={[14,30,18]} intensity={isNight?.35:1.9} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30}/>
   <Camera all={all}/>
   <CityOutside allFloors={all} building={AIOPS_NAME} span={30} elevation={!all&&floor>0?floorElevation(floor)*INTERIOR_K:0} anchorAt={s=>planAiOps(s)} scaleOverride={()=>INTERIOR_K}/>
   {!all&&floor>=2&&<Podium below={floorElevation(floor)*INTERIOR_K}/>}
   {shownFloors.map(f=><group key={f.level} position={[0,all?f.level*STOREY:0,0]}><Floor f={f} single={!all} night={isNight} onPick={t=>{setAgent(null);setPicked(t);}} onAgent={a=>{setPicked(null);setAgent(a);}}/></group>)}
  </Canvas>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label={`Exit ${shown()} and return to city`}>← Exit building</button><div><small>{shown().toUpperCase()} · MODEL, DATA & PLATFORM OPERATIONS</small><h2>{all?'All floors · Open cutaway':floor===0?current.label:`Floor ${floor} · ${current.label}`}</h2></div></header>
  <nav className="skyline-floor-picker" aria-label={`Choose ${shown()} floor`}><strong>Floor navigation</strong>{[-1,...[...AIOPS_LEVELS].reverse()].map(n=><button key={n} aria-pressed={floor===n} onClick={()=>{setFloor(n);setPicked(null);setAgent(null);}}>{n===-1?'All floors':n===0?'Lobby':`Floor ${n}`}</button>)}</nav>
  <aside className="skyline-interior-note">{picked??(all?`Lobby + 4 floors: podium and tower, same glass and bronze ribbon as outside · ${lookHint()}`:`${current.summary} Select a desk.`)}<span>{`${SEATED.length} agents seated here · Every desk shows its planned role · Planned, not running · No accounts or data connected`}</span></aside>
  {agent&&<WorkplaceInspector agent={agent} onClose={()=>setAgent(null)}/>}
 </section>;
}
