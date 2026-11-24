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
import {CreativeCampus} from '../map3d/CreativeCampus';
import {CAMPUS_KEY,CAMPUS_NAME} from '../map3d/creativeCampusPlan';
import {buildingDisplayName} from '../../modules/names';
import {catalog} from '../../catalog';
import type {Agent} from '../../catalog/types';
import {workplaceAgent} from '../../catalog/workplaces';
import CityOutside from './CityOutside';
import {lookHint,useInteriorTrackpad} from './useInteriorTrackpad';
import FloorLabel from './FloorLabel';
import {leaveBuilding} from './store';
import {WorkplaceInspector} from './WorkplaceInspector';
import {CAMPUS_BARS,CAMPUS_FLOORS,CAMPUS_INTERIOR as CI,CAMPUS_OWNER,CAMPUS_ROOMS,ENTRANCE_ANGLE,RING_R,barPoint,campusBar,campusDesks,campusFlight,flightAngle,type CampusRoom} from './campusInteriorPlan';
import '../../styles/skyline.css';

const shown=()=>buildingDisplayName(CAMPUS_KEY,CAMPUS_NAME);
type Item={p:[number,number,number];s:[number,number,number];c:string;r?:number};
const H=CI.storey,A=CI.atrium;
const WHITE='#f4f3ef',RED='#b52a2c',MAROON='#8a2629',INK='#2b2a28',DESK='#ece9e2',OAK='#c9a77f',GREY='#5d6870',GLASS='#d3e2e6',PLANT='#4f8a46',POT='#e8e4dc';
/** Rough half-extent of the floor plate, for the camera and floor labels. */
const EXTENT=Math.max(...CAMPUS_BARS.flatMap(b=>[Math.abs(b.b[0]),Math.abs(b.b[1])]))+4;

/** Agents the catalog seats here, per room. None yet: Khaneil chose empty desks (2026-11-24). */
const SEATED=new Map(CAMPUS_ROOMS.flatMap(r=>{const a=r.level>=1?workplaceAgent(catalog.agents,CAMPUS_NAME,r.level,r.id):undefined;return a?[[r.id,a] as const]:[];}));

function Boxes({items,shadow=true}:{items:Item[];shadow?:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;const o=new THREE.Object3D(),c=new THREE.Color();
  items.forEach((it,i)=>{o.position.set(...it.p);o.rotation.set(0,it.r??0,0);o.scale.set(...it.s);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,c.set(it.c));});
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
 },[items]);
 if(!items.length)return null;
 return <instancedMesh ref={ref} args={[undefined,undefined,items.length]} castShadow={shadow} receiveShadow><boxGeometry/><meshStandardMaterial roughness={.6}/></instancedMesh>;
}

/** A box in a room's own frame: u along its bar, v across it, y up from the floor. */
function roomBox(r:CampusRoom,items:Item[]){
 const b=campusBar(r);
 return (u:number,v:number,y:number,su:number,sy:number,sv:number,c:string)=>{
  if(!b){items.push({p:[r.x+u,y+sy/2,r.z+v],s:[su,sy,sv],c});return;}
  const [x,z]=barPoint(b,(r.s0+r.s1)/2+u,(r.v0+r.v1)/2+v);items.push({p:[x,y+sy/2,z],s:[su,sy,sv],c,r:r.yaw});
 };
}

/** Furniture for one room by kind. Desks are the open studio desks: a white top, a screen and a chair. */
function furnish(r:CampusRoom):Item[]{
 const items:Item[]=[],box=roomBox(r,items),w=r.w,d=r.d;
 // Floors by use: light oak in studios, lounges and the café; polished concrete in galleries, workshops and labs
 // (the end-block labs tinted by their red glass).
 const tone:Record<CampusRoom['kind'],string>={reception:'#e7e3da',cafe:'#d6bd98',gallery:'#dcd9d2',hall:'#8c3a32',archive:'#cdb48e',shop:'#d8d5ce',workshop:'#bfbdb7',lab:'#e2c8c3',studio:'#d9c19d',critique:'#d4bc98',lounge:'#d9c19d'};
 if(r.kind!=='reception')box(0,0,0,w-.12,.03,d-.12,tone[r.kind]);
 for(const k of campusDesks(r)){
  // Standard desk and chair; the chair sits on the side the figure would face from.
  const c=Math.cos(k.yaw),s=Math.sin(k.yaw);
  items.push({p:[k.x+s*.32,.37,k.z+c*.32],s:[1.3,.74,.7],c:DESK,r:k.yaw},{p:[k.x+s*.5,.95,k.z+c*.5],s:[.62,.38,.05],c:INK,r:k.yaw},{p:[k.x-s*.3,.24,k.z-c*.3],s:[.46,.48,.46],c:GREY,r:k.yaw},{p:[k.x-s*.52,.7,k.z-c*.52],s:[.46,.5,.08],c:GREY,r:k.yaw});
 }
 switch(r.kind){
  case 'cafe':box(-w/2+.6,0,0,.9,1.05,d-1.4,RED);box(-w/2+.6,1.05,0,1,.05,d-1.3,WHITE);for(let i=0;i<3;i++){box(-w/2+2.4+i*1.6,0,0,1.1,.74,1.1,OAK);for(const k of [-1,1])box(-w/2+2.4+i*1.6,0,k*.85,.4,.46,.4,GREY);}box(w/2-.5,0,d/2-.5,.5,.4,.5,POT);box(w/2-.5,.4,d/2-.5,.6,.7,.6,PLANT);break;
  case 'gallery':for(let i=0;i<4;i++){const u=-w/2+1+(w-2)*i/3;box(u,0,d/2-.25,1.5,2.2,.12,WHITE);box(u,.8,d/2-.33,1,1,.04,[RED,'#2f4a5a','#d9a441',MAROON][i]);}box(0,0,-.4,.9,1,.9,WHITE);box(0,1,-.4,.5,.6,.5,RED);break;
  case 'hall':box(0,0,d/2-.6,w-1,.4,1,MAROON);for(let i=0;i<4;i++)for(let j=0;j<5;j++)box(-w/2+1.2+j*(w-2.4)/4,0,-d/2+.8+i*.8,.5,.46,.5,RED);break;
  case 'archive':for(let i=0;i<4;i++)box(-w/2+1+i*(w-2)/3,0,d/2-.6,.4,2,1,OAK);box(0,0,-.8,2.4,.74,1,DESK);break;
  case 'shop':for(const u of [-w/2+.5,w/2-.5])box(u,0,0,.5,1.9,d-1,OAK);box(0,0,0,1.8,.85,1,WHITE);break;
  case 'workshop':for(let i=0;i<2;i++)box(-w/4+i*w/2,0,0,w/2-1,.9,1.6,OAK);box(0,0,d/2-.3,w-1,1.8,.3,'#9aa0a3');break;
  case 'critique':box(0,0,0,Math.min(w-2,4.4),.76,1.3,DESK);for(let k=-2;k<=2;k++)for(const s of [-1,1])box(k*.85,0,s*1,.42,.48,.42,GREY);box(0,.6,d/2-.15,w-1,1.6,.06,WHITE);break;
  case 'lounge':for(let i=0;i<3;i++){box(-w/2+1.6+i*(w-3.2)/2,0,.6,1.8,.42,.8,i%2?RED:'#b9a88d');box(-w/2+1.6+i*(w-3.2)/2,0,-.6,.8,.32,.5,OAK);}break;
  case 'studio':{
   // Pin-up wall on the corridor side, oak shelving at one end, a plant at the other.
   box(0,.5,-d/2+.12,w-1.2,1.5,.06,WHITE);for(let i=0;i<5;i++)box(-w/2+1.2+i*(w-2.4)/4,1.1,-d/2+.16,.5,.6,.02,['#f2d27a','#9cc3d5',RED,'#f4f3ef','#2f4a5a'][i]);
   box(w/2-.35,0,0,.35,1.6,d-1.6,OAK);box(-w/2+.4,0,d/2-.4,.45,.4,.45,POT);box(-w/2+.4,.4,d/2-.4,.55,.75,.55,PLANT);break;}
  case 'lab':if(!r.desks){box(0,0,0,w-2,.9,1.6,'#9aa0a3');box(0,.9,0,1.2,.5,.8,INK);}box(0,.4,d/2-.15,w-1,1.6,.05,'#1f2a36');break;
  default:break;
 }
 return items;
}

function Camera({all}:{all:boolean}){
 const controls=useRef<OrbitControlsImpl>(null);const {camera,invalidate,size}=useThree();
 const far=size.width<size.height?Math.min(2.2,1.15/(size.width/size.height)**.75):1;
 useLayoutEffect(()=>{
  const eye=(all?[EXTENT*.9,EXTENT*1.25,EXTENT*1.55]:[EXTENT*.42,EXTENT*1.0,EXTENT*.85]).map(v=>v*far) as [number,number,number];
  camera.position.set(...eye);
  const t=controls.current?.target;if(t){t.set(0,all?H*2:0,2);camera.lookAt(t);controls.current?.update();}
  invalidate();
 },[all,camera,invalidate,far]);
 useInteriorTrackpad(()=>controls.current,{x:EXTENT,z:EXTENT});
 return <OrbitControls ref={controls} makeDefault minDistance={14} maxDistance={260} maxPolarAngle={Math.PI/2.25}/>;
}

/** The gallery ring round the atrium: a full disc on the ground floor, a ring round the void above. */
function ringGeometry(level:number){
 const s=new THREE.Shape();s.absarc(0,0,RING_R,0,Math.PI*2,false);
 if(level>0){const h=new THREE.Path();h.absarc(0,0,A.r,0,Math.PI*2,true);s.holes.push(h);}
 const g=new THREE.ExtrudeGeometry(s,{depth:CI.slab,bevelEnabled:false,curveSegments:48});g.rotateX(Math.PI/2);return g;
}

function Floor({level,single,night,onPick,onAgent}:{level:number;single:boolean;night:boolean;onPick:(t:string)=>void;onAgent:(a:Agent)=>void}){
 const rooms=useMemo(()=>CAMPUS_ROOMS.filter(r=>r.level===level),[level]);
 const ring=useMemo(()=>ringGeometry(level),[level]);useEffect(()=>()=>ring.dispose(),[ring]);
 const items=useMemo(()=>{
  const items:Item[]=[],wallH=single?H-.45:1.05;
  for(const r of rooms)items.push(...furnish(r));
  for(const b of CAMPUS_BARS){
   const hw=b.width/2,yaw=-Math.atan2(b.dir[1],b.dir[0]),start=Math.max(0,Math.sqrt(RING_R*RING_R-hw*hw)-Math.hypot(b.a[0],b.a[1])-.4);
   const seg=(s0:number,s1:number,v:number,y0:number,h:number,t:number,c:string)=>{const [x,z]=barPoint(b,(s0+s1)/2,v);items.push({p:[x,y0+h/2,z],s:[s1-s0,h,t],c,r:yaw});};
   const cross=(s:number,v0:number,v1:number,h:number,t:number,c:string)=>{const [x,z]=barPoint(b,s,(v0+v1)/2);items.push({p:[x,h/2,z],s:[t,h,v1-v0],c,r:yaw});};
   // Floor slab of the wing, clear of the atrium ring it meets.
   seg(start,b.length+(b.last?0:hw),0,-CI.slab,CI.slab,b.width,level===0?'#e2ddd2':'#ebe7de');
   // Facade on both long faces: a low white sill with the sawtooth fins standing on it, as outside.
   const inset=level===0?CI.groundInset:0,endS=b.last?b.length-CI.endBlock:b.length;
   for(const k of [-1,1]){
    seg(start,endS,k*(hw-inset-.08),0,level===0?wallH:.55,.16,WHITE);
    // The sawtooth fins outside the glass: each tooth's two folded faces, full height in a single-floor view.
    const fh=single?1.5:1;
    if(level>0)for(let s=start+.4;s<endS;s+=1.36)for(const f of [-1,1]){const [x,z]=barPoint(b,s+f*.3,k*(hw+.3));items.push({p:[x,fh/2,z],s:[.66,fh,.05],c:WHITE,r:yaw+k*f*.75});}
   }
   // The leaning red end block: maroon glass walls round the lab, lower in the all-floors view.
   if(b.last){for(const k of [-1,1])seg(endS,b.length,k*(hw+.2),0,wallH,.12,MAROON);cross(b.length,-hw-.2,hw+.2,wallH,.12,MAROON);cross(endS,-hw,hw,wallH,.08,'#c98f8a');
    // White mullions on the red glass, as outside.
    for(let s=endS+1.1;s<b.length-.3;s+=2.2)for(const k of [-1,1]){const [x,z]=barPoint(b,s,k*(hw+.27));items.push({p:[x,wallH/2,z],s:[.08,wallH,.08],c:'#efe6e2',r:yaw});}}
   if(level===0)continue;
   // Corridor: glass wall between it and the rooms, with a door into each room.
   const cv=-hw+CI.corridor;
   for(const r of rooms.filter(r=>r.wing===b.wing&&r.bar===b.index)){
    const m=(r.s0+r.s1)/2;seg(r.s0+.1,m-.6,cv,0,wallH,.06,GLASS);seg(m+.6,r.s1-.1,cv,0,wallH,.06,GLASS);
    // White door frame: posts either side and a head when the walls are full height.
    for(const e of [m-.62,m+.62])seg(e-.04,e+.04,cv,0,wallH,.1,WHITE);if(single)seg(m-.66,m+.66,cv,wallH-.14,.14,.1,WHITE);
    cross(r.s1,cv,hw,wallH,.14,WHITE);
   }
   // Pin-up board along the corridor's outer wall, and the corridor's red floor stripe.
   seg(start+1,endS-1,-hw+.25,0,.04,.5,RED);
  }
  // Atrium: red balustrade bands round the void, broken where a flight leaves and arrives.
  if(level>0){
   const gaps=[flightAngle(level-1),flightAngle(level)+Math.PI].map(a=>Math.atan2(Math.sin(a),Math.cos(a)));
   const near=(t:number)=>gaps.some(g=>Math.abs(Math.atan2(Math.sin(t-g),Math.cos(t-g)))<.2);
   // Gallery edge as in the reference: the red band on the slab edge, glass balustrade above, a white handrail.
   for(let k=0;k<48;k++){const t=k/48*Math.PI*2;if(near(t))continue;const x=Math.cos(t)*(A.r+.06),z=Math.sin(t)*(A.r+.06),r=-t-Math.PI/2;
    items.push({p:[x,-.12,z],s:[.92,.46,.12],c:RED,r},{p:[x,.56,z],s:[.92,.9,.03],c:GLASS,r},{p:[x,1.04,z],s:[.92,.06,.1],c:WHITE,r});}
   // White columns round the gallery, clear of the flights.
   for(let k=0;k<8;k++){const t=(k+.5)/8*Math.PI*2;if(near(t))continue;items.push({p:[Math.cos(t)*(A.r+.7),single?(H-.4)/2:.6,Math.sin(t)*(A.r+.7)],s:[.34,single?H-.4:1.2,.34],c:WHITE,r:-t});}
  }else{
   // Reception: a round white desk in the atrium, a red inlay ring and the plaza doors.
   for(let k=0;k<30;k++){const t=k/30*Math.PI*2;if(Math.abs(Math.atan2(Math.sin(t-ENTRANCE_ANGLE),Math.cos(t-ENTRANCE_ANGLE)))<.45)continue;items.push({p:[Math.cos(t)*2.2,.55,Math.sin(t)*2.2],s:[.32,1.1,.5],c:WHITE,r:-t},{p:[Math.cos(t)*2.2,1.12,Math.sin(t)*2.2],s:[.34,.05,.62],c:RED,r:-t});}
   for(let k=0;k<64;k++){const t=k/64*Math.PI*2;items.push({p:[Math.cos(t)*A.r,.02,Math.sin(t)*A.r],s:[.7,.03,.14],c:RED,r:-t-Math.PI/2});}
   const ex=Math.cos(ENTRANCE_ANGLE)*(RING_R-.2),ez=Math.sin(ENTRANCE_ANGLE)*(RING_R-.2);
   items.push({p:[ex,.02,ez],s:[1.4,.03,3.2],c:MAROON,r:-ENTRANCE_ANGLE},{p:[ex,1.2,ez],s:[.06,2.4,3],c:'#b9d2d4',r:-ENTRANCE_ANGLE});
  }
  // The atrium's glass drum round the gallery ring, as a low rail in the cutaway.
  for(let k=0;k<40;k++){const t=k/40*Math.PI*2;if(level===0&&Math.abs(Math.atan2(Math.sin(t-ENTRANCE_ANGLE),Math.cos(t-ENTRANCE_ANGLE)))<.25)continue;
   const inBar=CAMPUS_BARS.some(b=>{const x=Math.cos(t)*RING_R,z=Math.sin(t)*RING_R,v=-(x-b.a[0])*b.dir[1]+(z-b.a[1])*b.dir[0],s=(x-b.a[0])*b.dir[0]+(z-b.a[1])*b.dir[1];return Math.abs(v)<b.width/2&&s>-5;});
   if(!inBar)items.push({p:[Math.cos(t)*RING_R,.35,Math.sin(t)*RING_R],s:[1.6,.7,.08],c:'#c9d6da',r:-t-Math.PI/2});}
  return items;
 },[rooms,single,level]);
 // Red stair flights crossing the void: this floor's flight up, and in a single-floor view the one arriving.
 const steps=useMemo(()=>{
  const out:Item[]=[],add=(lv:number,dy:number)=>{const a=flightAngle(lv),px=-Math.sin(a),pz=Math.cos(a);
   for(const st of campusFlight(lv)){out.push({p:[st.x,st.y-dy-.08,st.z],s:[1.1,.16,CI.stair.width],c:WHITE,r:st.yaw});
    // Red stringer bands either side, the reference's red stair ribbons.
    for(const k of [-1,1]){const x=st.x+px*k*CI.stair.width/2,z=st.z+pz*k*CI.stair.width/2;out.push({p:[x,st.y-dy-.2,z],s:[1.16,.42,.12],c:RED,r:st.yaw},
     // Glass balustrade and a white handrail along each side.
     {p:[x,st.y-dy+.45,z],s:[1.12,.85,.03],c:GLASS,r:st.yaw},{p:[x,st.y-dy+.9,z],s:[1.14,.05,.08],c:WHITE,r:st.yaw});}}};
  if(level<CI.levels-1)add(level,level*H);
  if(single&&level>0)add(level-1,level*H);
  return out;
 },[level,single]);
 const top=level===CI.levels-1;
 return <group>
  <mesh geometry={ring} receiveShadow castShadow><meshStandardMaterial color={level===0?'#e6e2da':'#eeebe4'} roughness={.8}/></mesh>
  {single&&level>0&&<mesh position={[0,-level*H+.01,0]} rotation={[-Math.PI/2,0,0]} receiveShadow><circleGeometry args={[A.r+.1,48]}/><meshStandardMaterial color="#e6e2da" roughness={.8}/></mesh>}
  <Boxes items={items}/><Boxes items={steps} shadow={false}/>
  {/* The triangulated skylight over the atrium: glass and red ribs, shown with the top floor. */}
  {top&&<group position={[0,H+.15,0]}>
   <mesh><coneGeometry args={[A.r+.4,CAMPUS_SKYLIGHT_H,12,1,true]}/><meshStandardMaterial color="#cfe3e8" transparent opacity={.28} roughness={.1} side={THREE.DoubleSide} depthWrite={false}/></mesh>
   {Array.from({length:12},(_,k)=>{const t=k/12*Math.PI*2,len=Math.hypot(A.r+.4,CAMPUS_SKYLIGHT_H);return <mesh key={k} position={[Math.cos(t)*(A.r+.4)/2,0,Math.sin(t)*(A.r+.4)/2]} rotation={[0,-t,Math.PI-Math.atan2(CAMPUS_SKYLIGHT_H,A.r+.4)]}><boxGeometry args={[len,.1,.1]}/><meshStandardMaterial color={RED} roughness={.4}/></mesh>;})}
  </group>}
  {single&&rooms.map(r=>{const agent=SEATED.get(r.id);const desks=r.desks?` · ${r.desks} open desks`:'';return <Html key={r.id} position={[r.x,2.4,r.z]} center zIndexRange={[8,0]}><button className="skyline-room-label" onClick={()=>agent?onAgent(agent):onPick(`${r.name} · ${r.purpose}`)}>{r.name}<span>{agent?`${agent.registry?.title??agent.name} · Configured, not verified`:r.desks?`No agent yet${desks}`:r.role}</span></button></Html>;})}
  <FloorLabel level={level} width={EXTENT*2} depth={EXTENT*2}/>
  <pointLight position={[0,H-.6,0]} color="#ffe2bd" intensity={night?50:10} distance={30} decay={2}/>
 </group>;
}
const CAMPUS_SKYLIGHT_H=2.6;

/**
 * Inside the Atlas Creative Campus: five storeys round the skylit atrium in an open cutaway, the
 * three wings with their studios and red-glass end-block labs, and the island outside at matching scale.
 * Every desk is open: no agent works here yet.
 */
export default function CreativeCampusInterior({light}:{light:LightMode}){
 const [floor,setFloor]=useState(-1);const [picked,setPicked]=useState<string|null>(null);const [agent,setAgent]=useState<Agent|null>(null);
 const power=usePowerProfile(),visible=usePageVisible(),reduced=useReducedMotion(),isNight=light==='night';
 useEffect(()=>{cityNight.value=isNight?1:0;},[isNight]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();leaveBuilding(true);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[]);
 const all=floor===-1,levels=all?Array.from({length:CI.levels},(_,i)=>i):[floor];
 const pick=useMemo(()=>({keys:[] as string[],over:()=>{},out:()=>{},click:()=>{}}),[]);
 const desks=CAMPUS_ROOMS.reduce((n,r)=>n+r.desks,0);
 return <section className={`skyline-interior ${isNight?'night':'day'}`} aria-label={`${shown()} interior`}>
  <Canvas style={{position:'absolute',inset:0,zIndex:0}} frameloop={visible?'demand':'never'} dpr={[1,power.maxDpr]} shadows="percentage" camera={{position:[40,56,70],fov:40}}>
   <FramePacer profile={power} running={!reduced}/>
   <color attach="background" args={[isNight?'#101b2c':'#dbe2d8']}/>
   <ambientLight color={isNight?'#c1cfed':'#ffffff'} intensity={isNight?.3:.75}/>
   <hemisphereLight args={[isNight?'#91abdc':'#eef6ff',isNight?'#303e35':'#8c7e64',isNight?.45:1.25]}/>
   <directionalLight color={isNight?'#99b8ed':'#fff4da'} position={[20,40,26]} intensity={isNight?.35:1.9} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45}/>
   {/* Daylight through the atrium skylight: one shared light for the whole building. */}
   <spotLight position={[0,CI.levels*H+8,0]} angle={.42} penumbra={.8} color={isNight?'#ffd9a8':'#fff6e2'} intensity={isNight?60:260} distance={60} decay={1.6}/>
   <Camera all={all}/>
   <CityOutside allFloors={all} building={CAMPUS_NAME} span={EXTENT*2} clearSpan={16} elevation={floor>0?floor*H:0} anchorAt={s=>s.campus&&{x:s.campus.cx,z:s.campus.cz}} scaleOverride={()=>CI.scale}
    extras={({scene,g,m})=><CreativeCampus plan={scene.campus} g={g} m={m} pick={pick} night={isNight} building={false}/>}/>
   {levels.map(level=><group key={level} position={[0,all?level*H:0,0]}><Floor level={level} single={!all} night={isNight} onPick={t=>{setAgent(null);setPicked(t);}} onAgent={a=>{setPicked(null);setAgent(a);}}/></group>)}
  </Canvas>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label={`Exit ${shown()} and return to city`}>← Exit building</button><div><small>{shown().toUpperCase()} · DESIGN, MEDIA & MAKING STUDIOS</small><h2>{all?'All floors · Open cutaway':floor===0?CAMPUS_FLOORS[0]:`Floor ${floor} · ${CAMPUS_FLOORS[floor]}`}</h2></div></header>
  <nav className="skyline-floor-picker" aria-label={`Choose ${shown()} floor`}><strong>Floor navigation</strong>{[-1,4,3,2,1,0].map(n=><button key={n} aria-pressed={floor===n} onClick={()=>{setFloor(n);setPicked(null);setAgent(null);}}>{n===-1?'All floors':n===0?'Lobby':`Floor ${n}`}</button>)}</nav>
  <aside className="skyline-interior-note">{picked??(all?`Lobby + 4 floors in three wings round a skylit atrium · ${lookHint()}`:`${CAMPUS_ROOMS.filter(r=>r.level===floor).map(r=>r.name).filter((n,i,a)=>a.indexOf(n)===i).join(' · ')} · Select a room`)}<span>{`Owning agent: ${CAMPUS_OWNER} · Planned, not running · ${desks} open desks, ${SEATED.size} agents seated · No accounts or workflows connected`}</span></aside>
  {agent&&<WorkplaceInspector agent={agent} onClose={()=>setAgent(null)}/>}
 </section>;
}
