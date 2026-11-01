import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Canvas,useThree} from '@react-three/fiber';
import {Html,OrbitControls} from '@react-three/drei';
import type {OrbitControls as OrbitControlsImpl} from 'three-stdlib';
import * as THREE from 'three';
import {usePowerProfile} from '../../lib/power';
import {useReducedMotion} from '../../lib/motion';
import {FramePacer} from '../map3d/pacer';
import {night as cityNight} from '../map3d/materials';
import type {LightMode} from '../map3d/living';
import {MarketingAgency} from '../map3d/MarketingAgency';
import {AGENCY_NAME} from '../map3d/marketingAgencyPlan';
import CityOutside from './CityOutside';
import FloorLabel from './FloorLabel';
import AgencyCrowd from './AgencyCrowd';
import {agencyCrowd,hallSeats} from './agencyCrowdPlan';
import {leaveBuilding} from './store';
import {AGENCY_FLOORS,AGENCY_OWNER,AGENCY_ROOMS,INTERIOR,SLOT_HALF,atriumOpen,entranceX,flightEnd,slotX,stairLanding,stairSteps,type AgencyRoom} from './agencyInteriorPlan';
import '../../styles/skyline.css';

type Item={p:[number,number,number];s:[number,number,number];c:string;r?:number};
/** Everyone in the building, planned once: scripted paths, no AI. */
const CROWD=agencyCrowd();
const W=INTERIOR.width/2,D=INTERIOR.depth/2,H=INTERIOR.storey;
const CREAM='#efe8dc',COPPER='#a2552f',OAK='#c7a27a',INK='#2b2a28',LINEN='#e9e2d4';

/** All the small furniture of a floor in one instanced mesh, coloured per piece. */
function Boxes({items,shadow=true}:{items:Item[];shadow?:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;const o=new THREE.Object3D(),c=new THREE.Color();
  items.forEach((it,i)=>{o.position.set(...it.p);o.rotation.set(0,it.r??0,0);o.scale.set(...it.s);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,c.set(it.c));});
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
 },[items]);
 if(!items.length)return null;
 return <instancedMesh ref={ref} args={[undefined,undefined,items.length]} castShadow={shadow} receiveShadow><boxGeometry/><meshStandardMaterial roughness={.62}/></instancedMesh>;
}

/** Furniture for one room, by kind. Pieces are boxes centred on p with size s. */
function furnish(room:AgencyRoom):{items:Item[]}{
 const items:Item[]=[];const {x,z,w,d}=room,cx=x+w/2,cz=z+d/2;
 const box=(px:number,py:number,pz:number,sx:number,sy:number,sz:number,c:string,r=0)=>items.push({p:[px,py+sy/2,pz],s:[sx,sy,sz],c,r});
 const grid=(nx:number,nz:number,pad:number,fn:(px:number,pz:number,i:number)=>void)=>{let i=0;for(let a=0;a<nx;a++)for(let b=0;b<nz;b++)fn(x+pad+(w-2*pad)*(nx===1?.5:a/(nx-1)),z+pad+(d-2*pad)*(nz===1?.5:b/(nz-1)),i++);};
 // Room floor finish, a hair above the slab.
 const floorTone:{[k in AgencyRoom['kind']]:string}={reception:'#d9c3a5',lounge:'#e2d6c3',cafe:'#c9ab86',shop:'#ded4c4',studio:'#d1d1cc',desk:'#ddd3c2',meeting:'#d6c7b0',gallery:'#ece6db',archive:'#cdb593',lab:'#d9d4c9',hall:'#7d4b36','green-room':'#d7c8b1',services:'#d2cdc3'};
 box(cx,0,cz,w-.1,.03,d-.1,floorTone[room.kind]);
 switch(room.kind){
  case 'reception':break;
  case 'lounge':grid(3,2,1.6,(px,pz,i)=>{box(px,0,pz,1.9,.42,.8,i%2?'#b9a88d':'#8c6a52');box(px,0,pz+.9,.8,.32,.5,OAK);});break;
  case 'cafe':box(x+.6,0,cz,1,1.05,d-1.6,COPPER);box(x+.6,1.05,cz,1.15,.06,d-1.4,LINEN);grid(3,3,1.7,(px,pz)=>{if(px<x+2.4)return;box(px,0,pz,.9,.72,.9,OAK);box(px-.65,0,pz,.4,.45,.4,INK);box(px+.65,0,pz,.4,.45,.4,INK);});break;
  case 'shop':for(const px of [x+.5,x+w-.5])box(px,0,cz,.6,2.1,d-1,OAK);grid(2,2,2.2,(px,pz)=>{box(px,0,pz,1.6,.85,1,LINEN);box(px,.85,pz,.5,.25,.35,COPPER);});break;
  case 'studio':box(x+.5,0,cz,.2,2.8,d-1.6,'#f4f2ee');box(x+1.3,0,cz,1.6,.04,d-1.6,'#f4f2ee');for(const dz of [-1.6,1.6]){box(x+4.2,0,cz+dz,.08,1.9,.08,INK);box(x+4.2,1.9,cz+dz,.5,.4,.35,'#e9e4da');}box(x+w-1.4,0,cz,1.2,.75,2.4,OAK);box(x+w-1.4,.75,cz,.06,.5,.9,INK);break;
  case 'desk':grid(2,3,1.4,(px,pz)=>{box(px,0,pz,2,.74,.9,LINEN);box(px,.74,pz-.25,.7,.42,.05,INK);box(px,0,pz+.75,.5,.48,.5,'#56636b');});break;
  case 'meeting':box(cx,0,cz,Math.min(w-2,4.2),.76,1.4,OAK);for(let k=-2;k<=2;k++)for(const s of [-1,1])box(cx+k*.8,0,cz+s*1.05,.45,.5,.45,INK);box(cx,.9,z+.25,2.6,1.5,.08,'#26303a');break;
  case 'gallery':{const art=['#b8552e','#2f4a3a','#d9a441','#3f5f86','#8c3b52','#e7d9c3'];for(let k=0;k<5;k++){const px=x+1+(w-2)*k/4;box(px,0,z+.25,1.6,2.6,.12,'#f6f2ea');box(px,.9,z+.33,1.2,1.2,.04,art[k%art.length]);}grid(3,1,2,(px,pz,i)=>{box(px,0,pz+.6,.8,1,.8,'#f6f2ea');box(px,1,pz+.6,.45,.55,.45,art[(i+2)%art.length]);});break;}
  case 'archive':for(let k=0;k<4;k++)box(x+1+k*((w-2)/3),0,z+d*.35,.5,2.2,d*.45,OAK);box(cx,0,z+d-1.4,3,.75,1.1,LINEN);break;
  case 'lab':box(cx,.9,z+.25,w-2,1.8,.08,'#1f2a36');box(cx,1.1,z+.3,w-2.6,1.3,.02,'#3f8a87');grid(2,2,1.8,(px,pz)=>{box(px,0,pz,2,.74,.9,LINEN);box(px,.74,pz-.25,.7,.42,.05,INK);});break;
  case 'hall':{
   // Stage and screen on the north wall; seats face it, split by a centre aisle and a cross aisle
   // in line with the slot doorway, so the atrium stair and the door both lead straight in.
   box(cx,0,z+1.7,w-1.2,.5,2.8,'#5a3426');box(cx,.5,z+.3,w-2,3.1,.12,'#1f2a36');box(cx,1,z+.37,w-3,2.3,.04,'#d9a441');
   for(const [px,pz] of hallSeats(room)){box(px,0,pz,.52,.48,.52,Math.round(pz)%2?'#8c3b2e':'#a2452f');box(px,.48,pz+.22,.52,.45,.1,'#7a3326');}
   break;}
  case 'green-room':box(cx,0,z+1,w-1.6,.95,.7,OAK);grid(2,3,1.6,(px,pz)=>{if(pz<z+2.5)return;box(px,0,pz,1.8,.42,.8,'#b9a88d');});break;
  case 'services':for(let k=0;k<6;k++)box(x+.6+k*.75,0,z+.3,.7,2,.5,'#9aa0a3');break;
 }
 return {items};
}

function Camera({all}:{all:boolean}){
 const controls=useRef<OrbitControlsImpl>(null);const {camera,invalidate,size}=useThree();
 // Narrow screens (iPhone) step back so the whole 38 m floor fits across.
 const far=size.width<size.height?Math.min(2.2,1.15/(size.width/size.height)**.75):1;
 useLayoutEffect(()=>{
  const eye=(all?[30,40,58]:[16,30,38]).map(v=>v*far) as [number,number,number];
  camera.position.set(...eye);
  const t=controls.current?.target;if(t){t.set(2,all?7:0,0);camera.lookAt(t);controls.current?.update();}
  invalidate();
 },[all,camera,invalidate,far]);
 return <OrbitControls ref={controls} makeDefault minDistance={14} maxDistance={170} maxPolarAngle={Math.PI/2.25}/>;
}

/** A floor slab with the round atrium opening where the void runs through it. */
function slabGeometry(level:number){
 const s=new THREE.Shape();s.moveTo(-W,-D);s.lineTo(W,-D);s.lineTo(W,D);s.lineTo(-W,D);s.closePath();
 if(atriumOpen(level)){const h=new THREE.Path();h.absarc(INTERIOR.atrium.x,INTERIOR.atrium.z,INTERIOR.atrium.r,0,Math.PI*2,true);s.holes.push(h);}
 const g=new THREE.ExtrudeGeometry(s,{depth:INTERIOR.slab,bevelEnabled:false,curveSegments:48});
 // Shape y becomes world z; extrude downward from the floor surface.
 g.rotateX(Math.PI/2);return g;
}

function Floor({level,single,night,animate,onPick}:{level:number;single:boolean;night:boolean;animate:boolean;onPick:(text:string)=>void}){
 const rooms=AGENCY_ROOMS.filter(r=>r.level===level);
 const crowd=useMemo(()=>CROWD.filter(p=>p.level===level),[level]);
 const slab=useMemo(()=>slabGeometry(level),[level]);useEffect(()=>()=>slab.dispose(),[slab]);
 const {items}=useMemo(()=>{
  const items:Item[]=[];
  for(const r of rooms)items.push(...furnish(r).items);
  const wallH=single?H-.5:1.1,a=INTERIOR.atrium;
  // Cutaway shell: the north and west walls stand full height, the plaza and river sides are low sills.
  items.push({p:[0,wallH/2,-D+.12],s:[W*2,wallH,.24],c:CREAM},{p:[-W+.12,wallH/2,0],s:[.24,wallH,D*2],c:CREAM});
  items.push({p:[0,.3,D-.1],s:[W*2,.6,.2],c:CREAM},{p:[W-.1,.3,0],s:[.2,.6,D*2],c:CREAM});
  // The slot's two glass walls, framed in copper, with a doorway through each at mid-depth.
  for(const side of [-1,1])for(const [z0,z1] of [[-D,-1.4],[1.4,D]]){const n=6;for(let k=0;k<n;k++){const za=z0+(z1-z0)*k/n,zb=z0+(z1-z0)*(k+1)/n,zm=(za+zb)/2,xa=slotX(za)+side*SLOT_HALF,xb=slotX(zb)+side*SLOT_HALF,len=Math.hypot(xb-xa,zb-za),yaw=-Math.atan2(zb-za,xb-xa);
   items.push({p:[(xa+xb)/2,wallH/2,zm],s:[len,wallH,.06],c:'#c9a58a',r:yaw},{p:[(xa+xb)/2,wallH-.06,zm],s:[len,.12,.12],c:COPPER,r:yaw});}}
  // Slot floor: warm stone under the skylit light street.
  for(let k=0;k<8;k++){const za=-D+D*2*k/8,zb=-D+D*2*(k+1)/8,xm=(slotX(za)+slotX(zb))/2,len=Math.hypot(slotX(zb)-slotX(za),zb-za),yaw=-Math.atan2(zb-za,slotX(zb)-slotX(za));items.push({p:[xm,.016,(za+zb)/2],s:[len,.03,SLOT_HALF*2],c:'#cfa785',r:yaw});}
  // Lift core, glass with a copper frame.
  const l=INTERIOR.lift;items.push({p:[l.x,(single?H-.5:1.1)/2,l.z],s:[l.w,single?H-.5:1.1,l.d],c:'#cdb7a3'},{p:[l.x,.02,l.z+l.d/2+.4],s:[l.w+.6,.04,.6],c:COPPER});
  if(atriumOpen(level)){
   // Balustrade round the atrium edge.
   const gap=flightEnd(level-1),near=(t:number)=>Math.abs(Math.atan2(Math.sin(t-gap),Math.cos(t-gap)))<.32;
   for(let k=0;k<40;k++){const t=k/40*Math.PI*2;if(near(t))continue;const x=a.x+Math.cos(t)*(a.r+.05),z=a.z+Math.sin(t)*(a.r+.05);items.push({p:[x,.5,z],s:[.68,1,.05],c:'#d7c2ad',r:-t-Math.PI/2},{p:[x,1.02,z],s:[.68,.06,.1],c:COPPER,r:-t-Math.PI/2});}
  }
  if(level===0){
   // Round reception desk and a ring of seats in the atrium; the floor inlay marks the circle.
   for(let k=0;k<28;k++){const t=k/28*Math.PI*2;if(Math.abs(t-Math.PI/2)<.5)continue;items.push({p:[a.x+Math.cos(t)*1.4,.5,a.z+Math.sin(t)*1.4],s:[.34,1,.32],c:k%2?'#b9805d':COPPER,r:-t});}
   for(let k=0;k<64;k++){const t=k/64*Math.PI*2;items.push({p:[a.x+Math.cos(t)*a.r,.03,a.z+Math.sin(t)*a.r],s:[.42,.04,.12],c:COPPER,r:-t-Math.PI/2});}
   // Entrance under the copper sweep: mat and a pair of glass leaves.
   const ex=entranceX();items.push({p:[ex,.02,D-.9],s:[3,.04,1.4],c:'#5a3426'},{p:[ex-.8,1.2,D-.08],s:[1.5,2.4,.05],c:'#b9d2d4'},{p:[ex+.8,1.2,D-.08],s:[1.5,2.4,.05],c:'#b9d2d4'});
  }
  return {items};
 },[rooms,single,level]);
 // On a single-floor view the flight arriving from below shows through the void too.
 const arriving=useMemo(()=>single&&level>0&&atriumOpen(level)?stairSteps(level-1).map(st=>({p:[st.x,st.y-level*H-.09,st.z] as [number,number,number],s:[INTERIOR.stair.width,.18,.55] as [number,number,number],c:'#e9dccb',r:st.yaw})):[],[single,level]);
 const steps=useMemo(()=>level<INTERIOR.atrium.openTo?[...stairSteps(level).map(st=>({p:[st.x,st.y-level*H-.09,st.z],s:[INTERIOR.stair.width,.18,.55],c:'#e9dccb',r:st.yaw})),{...(()=>{const ln=stairLanding(level);return {p:[ln.x,ln.y-level*H-.12,ln.z] as [number,number,number],s:[ln.length,.24,ln.width] as [number,number,number],c:'#e9dccb',r:ln.yaw};})()}] as Item[]:[],[level]);
 return <group>
  <mesh geometry={slab} receiveShadow castShadow><meshStandardMaterial color={level===0?'#e4dccd':'#ece5d8'} roughness={.8}/></mesh>
  {/* Single-floor view: the lobby floor and its copper ring seen down through the atrium void. */}
  {single&&atriumOpen(level)&&<mesh position={[INTERIOR.atrium.x,-INTERIOR.slab-.6,INTERIOR.atrium.z]} rotation={[-Math.PI/2,0,0]} receiveShadow><circleGeometry args={[INTERIOR.atrium.r+.2,48]}/><meshStandardMaterial color="#d9c3a5" roughness={.8}/></mesh>}
  {atriumOpen(level)&&<mesh position={[INTERIOR.atrium.x,-INTERIOR.slab/2,INTERIOR.atrium.z]}><torusGeometry args={[INTERIOR.atrium.r,.09,6,64]}/><meshStandardMaterial color={COPPER} roughness={.35} metalness={.5}/></mesh>}
  <Boxes items={items}/><Boxes items={steps}/><Boxes items={arriving} shadow={false}/>
  <AgencyCrowd people={crowd} animate={animate}/>
  <FloorLabel level={level} width={W*2} depth={D*2}/>
  {single&&rooms.map(r=><Html key={r.id} position={[r.x+r.w/2,2.6,r.z+r.d/2]} center zIndexRange={[8,0]}><button className="skyline-room-label" onClick={()=>onPick(`${r.name} · ${r.role} · Planned, not running`)}>{r.name}<span>{r.role}</span></button></Html>)}
  {single&&level===0&&<Html position={[entranceX(),2.9,D]} center zIndexRange={[8,0]}><span className="skyline-room-label">Plaza entrance</span></Html>}
  {/* Warm downlights; the scene's only point lights, one per floor. */}
  <pointLight position={[INTERIOR.atrium.x,H-.8,INTERIOR.atrium.z]} color="#ffd9a8" intensity={night?40:8} distance={22} decay={2}/>
 </group>;
}

/**
 * Inside the Benjaire Marketing Agency: four floors in an open cutaway, the city and the plaza
 * outside at matching scale, a floor picker and room labels. Visual plan only: every role is
 * planned, nothing runs, no accounts are connected.
 */
export default function AgencyInterior({light}:{light:LightMode}){
 const [floor,setFloor]=useState(-1);const [picked,setPicked]=useState<string|null>(null);
 const power=usePowerProfile(),reduced=useReducedMotion(),isNight=light==='night';
 useEffect(()=>{cityNight.value=isNight?1:0;},[isNight]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();leaveBuilding(true);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[]);
 const all=floor===-1,levels=all?Array.from({length:INTERIOR.levels},(_,i)=>i):[floor];
 const pick=useMemo(()=>({keys:[] as string[],over:()=>{},out:()=>{},click:()=>{}}),[]);
 return <section className={`skyline-interior ${isNight?'night':'day'}`} aria-label={`${AGENCY_NAME} interior`}>
  <Canvas style={{position:'absolute',inset:0,zIndex:0}} frameloop="demand" dpr={[1,power.maxDpr]} shadows camera={{position:[30,40,58],fov:40}}>
   <FramePacer profile={power} running={!reduced}/>
   <color attach="background" args={[isNight?'#101b2c':'#dbe2d8']}/>
   <ambientLight color={isNight?'#c1cfed':'#ffffff'} intensity={isNight?.3:.75}/>
   <hemisphereLight args={[isNight?'#91abdc':'#eef6ff',isNight?'#303e35':'#8c7e64',isNight?.45:1.25]}/>
   <directionalLight color={isNight?'#99b8ed':'#fff4da'} position={[14,30,18]} intensity={isNight?.35:1.9} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30}/>
   <Camera all={all}/>
   <CityOutside allFloors={all} building={AGENCY_NAME} elevation={floor>0?floor*H:0} anchorAt={s=>s.agency&&{x:s.agency.cx,z:s.agency.cz}}
    extras={({scene,g,m})=><MarketingAgency plan={scene.agency} g={g} m={m} pick={pick} night={isNight} building={false}/>}/>
   {levels.map(level=><group key={level} position={[0,all?level*H:0,0]}><Floor level={level} single={!all} night={isNight} animate={!reduced} onPick={setPicked}/></group>)}
  </Canvas>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label={`Exit ${AGENCY_NAME} and return to city`}>← Exit building</button><div><small>{AGENCY_NAME.toUpperCase()} · BRAND, CONTENT & CAMPAIGNS</small><h2>{all?'All floors · Open cutaway':floor===0?AGENCY_FLOORS[0]:`Floor ${floor} · ${AGENCY_FLOORS[floor]}`}</h2></div></header>
  <nav className="skyline-floor-picker" aria-label={`Choose ${AGENCY_NAME} floor`}><strong>Floor navigation</strong>{[-1,3,2,1,0].map(n=><button key={n} aria-pressed={floor===n} onClick={()=>{setFloor(n);setPicked(null);}}>{n===-1?'All floors':n===0?'Lobby':`Floor ${n}`}</button>)}</nav>
  <aside className="skyline-interior-note">{picked??(all?'Lobby + 3 floors round a central atrium · Drag to orbit · Scroll to zoom':`${AGENCY_ROOMS.filter(r=>r.level===floor).map(r=>r.name).join(' · ')} · Select a room`)}<span>{`Owning agent: ${AGENCY_OWNER} · Planned, not running · No ad, email or social accounts connected · People shown are scripted illustrations, not running agents`}</span></aside>
 </section>;
}
