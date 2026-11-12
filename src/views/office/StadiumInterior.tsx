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
import {Stadium} from '../map3d/Stadium';
import {STADIUM_KEY,STADIUM_NAME} from '../map3d/stadiumPlan';
import {buildingDisplayName} from '../../modules/names';
/** The name shown inside; STADIUM_NAME stays the map key. */
const shown=()=>buildingDisplayName(STADIUM_KEY,STADIUM_NAME);
import {stadiumCentre} from '../map3d/stadiumGeometry';
import CityOutside from './CityOutside';
import {lookHint,useInteriorTrackpad} from './useInteriorTrackpad';
import FloorLabel from './FloorLabel';
import {leaveBuilding} from './store';
import {CONCOURSE_SPACES,STADIUM_INTERIOR as I,STADIUM_STATUS,STADIUM_VIEWS,aisleAngles,concourseMid,hospitalityBoxes,inAisle,lerpRing,onRing,seatRows,spacePoint,type ConcourseSpace,type Ring} from './stadiumInteriorPlan';
import '../../styles/skyline.css';

type Item={p:[number,number,number];s:[number,number,number];c:string;r?:number};
const STONE='#d9d9d4',CREAM='#efefea',INK='#2b2a28',GLASS='#a9bdc9',COURT='#2f5f63',SURROUND='#4f6670',LINE='#f3f1e6',STEEL='#f2f2ef';
/** Seat colours: blue rows, with a brown band across the front of the upper tier (Khaneil's reference), no team colours. */
const SEAT=['#2e5a86','#336394'],BAND='#7a5a48';

/** All the boxes of one view in one instanced mesh, coloured per piece (the AgencyInterior pattern). */
function Boxes({items,shadow=true}:{items:Item[];shadow?:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;const o=new THREE.Object3D(),c=new THREE.Color();
  items.forEach((it,i)=>{o.position.set(...it.p);o.rotation.set(0,it.r??0,0);o.scale.set(...it.s);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,c.set(it.c));});
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
 },[items]);
 if(!items.length)return null;
 return <instancedMesh ref={ref} args={[undefined,undefined,items.length]} castShadow={shadow} receiveShadow><boxGeometry/><meshStandardMaterial roughness={.66}/></instancedMesh>;
}

/** Boxes laid end to end round an ellipse, skipping where `skip` says (aisles, gates, the cutaway). */
function ringOf(e:Ring,n:number,y:number,h:number,thick:number,color:(k:number,a:number)=>string,skip:(a:number)=>boolean=()=>false):Item[]{
 const out:Item[]=[];
 for(let k=0;k<n;k++){
  const a0=k/n*Math.PI*2,a1=(k+1)/n*Math.PI*2,am=(a0+a1)/2;if(skip(am))continue;
  const [x0,z0]=onRing(e,a0),[x1,z1]=onRing(e,a1);
  out.push({p:[(x0+x1)/2,y+h/2,(z0+z1)/2],s:[Math.hypot(x1-x0,z1-z0)+.02,h,thick],c:color(k,am),r:-Math.atan2(z1-z0,x1-x0)});
 }
 return out;
}
/** In the all-views cutaway the south-west quarter of the stands is cut low, so the camera sees in. */
const cutaway=(a:number)=>{const n=((a%(Math.PI*2))+Math.PI*2)%(Math.PI*2);return n>Math.PI*.55&&n<Math.PI*.95;};

function bowlItems(all:boolean):Item[]{
 const items:Item[]=[];
 // One show court: teal, white lines, a net between two posts.
 const C=I.court,lw=.1,ly=.08;items.push({p:[0,.05,0],s:[C.w,.04,C.d],c:COURT});
 const single=C.d*.75;
 items.push({p:[0,ly,-C.d/2],s:[C.w,.01,lw],c:LINE},{p:[0,ly,C.d/2],s:[C.w,.01,lw],c:LINE},{p:[0,ly,-single/2],s:[C.w,.01,lw*.8],c:LINE},{p:[0,ly,single/2],s:[C.w,.01,lw*.8],c:LINE});
 for(const x of [-C.w/2,C.w/2])items.push({p:[x,ly,0],s:[lw,.01,C.d],c:LINE});
 for(const x of [-C.w*.27,C.w*.27])items.push({p:[x,ly,0],s:[lw*.8,.01,single],c:LINE});
 items.push({p:[0,ly,0],s:[C.w*.54,.01,lw*.8],c:LINE});
 for(const z of [-C.d/2-.4,C.d/2+.4])items.push({p:[0,.5,z],s:[.1,1,.1],c:INK});
 items.push({p:[0,.45,0],s:[.04,.8,C.d+.8],c:'#3d4a4f'},{p:[0,.88,0],s:[.06,.06,C.d+.8],c:'#f4f4f0'});
 // Seat rows: a riser and a seat line for each row, aisles left open.
 const rows=seatRows();
 for(const r of rows){
  const n=Math.round(r.ring.rx*2.2),low=all&&cutaway;
  items.push(...ringOf(r.ring,n,r.y-.5,.5,.85,()=>'#c9cac6',a=>inAisle(a)||(!!low&&low(a)&&r.tier>0)));
  items.push(...ringOf(r.ring,n,r.y,.28,.5,k=>r.tier===1&&r.row<2?BAND:SEAT[(r.row+k)%2],a=>inAisle(a)||(!!low&&low(a)&&r.tier>0)));
 }
 // Aisle steps up through every tier.
 for(const a of aisleAngles())for(const r of rows){if(all&&cutaway(a)&&r.tier>0)continue;const [x,z]=onRing(r.ring,a);items.push({p:[x,r.y-.25,z],s:[.6,.5,.75],c:'#b9bab5',r:-a});}
 // Tier fronts: a low wall at the front of each tier.
 for(let t=0;t<I.tiers;t++){const f=rows.find(r=>r.tier===t&&r.row===0)!;items.push(...ringOf(lerpRing(f.ring,{rx:0,rz:0,k:f.ring.k},.015),Math.round(f.ring.rx*2.2),f.y-.5,.9,.18,()=>CREAM,a=>!!(all&&t>0&&cutaway(a))));}
 // Hospitality ring between the lower and upper tiers: glass-fronted boxes.
 for(const b of hospitalityBoxes()){
  const a=-b.yaw;if(all&&cutaway(a))continue;const o=I.hospitality,[fx,fz]=onRing(lerpRing(b.ring,{rx:0,rz:0,k:b.ring.k},-.02),a);
  items.push({p:[b.x,b.y+o.height/2-.4,b.z],s:[3.4,o.height,o.depth],c:'#e3e3de',r:b.yaw+Math.PI/2},{p:[fx,b.y+o.height/2-.3,fz],s:[3.2,o.height*.7,.06],c:GLASS,r:b.yaw+Math.PI/2});
 }
 // Exposed roof trusses across the short span, with a light grid between them (not in the cutaway, so the camera sees in).
 if(!all){
  const top=I.glassH+.6,hz=I.glass.rz;
  for(let k=0;k<I.trusses;k++){
   const x=-I.glass.rx+.6+(I.glass.rx*2-1.2)*k/(I.trusses-1);
   items.push({p:[x,top,0],s:[.14,.14,hz*2],c:STEEL},{p:[x,top-.9,0],s:[.1,.1,hz*2-1.4],c:STEEL});
   for(let j=0;j<=4;j++)items.push({p:[x,top-.45,-hz+.7+(hz*2-1.4)*j/4],s:[.08,.9,.08],c:STEEL});
  }
  for(const z of [-hz*.5,0,hz*.5])items.push({p:[0,top-1,z],s:[I.glass.rx*2-1.2,.06,.22],c:'#fff5dc'});
 }
 return items;
}

/** One concourse space, by kind. */
function spaceItems(s:ConcourseSpace):Item[]{
 const [x,z]=spacePoint(s),yaw=-s.angle,out:Item[]=[],at=(dr:number,dt:number):[number,number]=>[x+Math.cos(s.angle)*dr-Math.sin(s.angle)*dt,z+Math.sin(s.angle)*dr+Math.cos(s.angle)*dt];
 const box=(dr:number,dt:number,y:number,sr:number,h:number,st:number,c:string)=>{const [px,pz]=at(dr,dt);out.push({p:[px,y+h/2,pz],s:[sr,h,st],c,r:yaw});};
 switch(s.kind){
  case 'gate':for(const dt of [-2.4,-.8,.8,2.4])box(1.2,dt,0,.15,1.1,.15,'#8d8a82');box(1.6,0,2.6,.06,.04,6,'#5a5248');box(-.6,0,0,.1,2.6,5.6,'#8a7f6c');break;
  case 'stairs':for(let k=0;k<8;k++)box(-1+k*.3,0,k*.3,.3,.3*(k+1),1.6,'#d6cfbf');box(-1,0,0,.12,3,2,'#bcb3a3');break;
  case 'escalator':for(const dt of [-.6,.6]){box(.3,0,dt,3.4,.9,.9,'#9aa0a3');box(.3,.9,dt,3.4,.08,.95,INK);}break;
  case 'food':box(-.4,0,0,1,1.1,3,'#a2552f');box(-.4,1.1,0,1.1,.06,3.1,CREAM);box(-.9,1.6,0,.08,.9,2.8,INK);for(const dt of [-1,1])box(.8,0,dt,.05,.95,.05,'#8d8a82');box(.8,.95,0,.05,.05,2.1,'#8d8a82');break;
  case 'shop':for(const dt of [-1.6,1.6])box(-.6,0,dt,.5,2,1.2,'#c7a27a');box(.4,0,0,1.6,.85,1,CREAM);box(.4,.85,0,.4,.3,.5,'#2f4a3a');break;
  case 'first-aid':box(-.4,0,0,2.2,2.4,3.2,'#f1eee8');box(.72,1.6,0,.04,.6,.2,'#b84a3a');box(.72,1.6,0,.04,.2,.6,'#b84a3a');break;
  case 'restrooms':box(-.4,0,0,2,2.4,3.4,'#cdd2d0');box(.62,0,0,.06,2.1,1,'#7d8a8c');break;
  case 'info':box(0,0,0,1.6,1,1.6,'#2f4a3a');box(0,1,0,1.7,.06,1.7,CREAM);break;
 }
 return out;
}

function concourseItems(all:boolean):Item[]{
 const items:Item[]=[],mid=concourseMid();
 // Concourse floor ring, then the glass lobby wall with mullions (the gates stay open).
 items.push(...ringOf(mid,72,-.02,.04,I.glass.rx-I.concourseInner.rx+.4,()=>STONE));
 const gate=(a:number)=>CONCOURSE_SPACES.some(s=>s.kind==='gate'&&Math.abs(Math.atan2(Math.sin(a-s.angle),Math.cos(a-s.angle)))<.09);
 const low=all?cutaway:()=>false,h=all?I.glassH:I.glassH;
 items.push(...ringOf(I.glass,96,0,h,.08,()=>GLASS,a=>gate(a)||low(a)));
 items.push(...ringOf(I.glass,48,0,h,.14,()=>'#d8d2c6',a=>gate(a)||low(a)).map(it=>({...it,s:[.14,it.s[1],.14] as [number,number,number]})));
 // Inner wall under the stands: the back of the lower tier, with the tunnel mouths open at the aisles.
 items.push(...ringOf(I.concourseInner,72,0,2.6,.25,()=>CREAM,a=>inAisle(a)||low(a)));
 for(const s of CONCOURSE_SPACES)items.push(...spaceItems(s));
 return items;
}

const VIEW_EYES:{[k:number]:[number,number,number]}={[-1]:[34,46,62],0:[26,40,44],1:[20,36,40]};
function Camera({view}:{view:number}){
 const controls=useRef<OrbitControlsImpl>(null);const {camera,invalidate,size}=useThree();
 // Narrow screens (iPhone) step back so the whole bowl fits across.
 const far=size.width<size.height?Math.min(2.2,1.15/(size.width/size.height)**.75):1;
 useLayoutEffect(()=>{
  camera.position.set(...VIEW_EYES[view].map(v=>v*far) as [number,number,number]);
  const t=controls.current?.target;if(t){t.set(0,view===1?1.5:0,0);camera.lookAt(t);controls.current?.update();}
  invalidate();
 },[view,camera,invalidate,far]);
 useInteriorTrackpad(()=>controls.current,{x:I.glass.rx,z:I.glass.rz});
 return <OrbitControls ref={controls} makeDefault minDistance={12} maxDistance={180} maxPolarAngle={Math.PI/2.2}/>;
}

/**
 * Inside Atlas Stadium: an open cutaway of the concourse and the seating bowl, the plaza and city
 * outside at matching scale, a view picker and labels for each space. A planned venue: no
 * events, tickets, attendance, scores or schedules exist, and nobody is shown inside.
 */
export default function StadiumInterior({light}:{light:LightMode}){
 const [view,setView]=useState(-1);const [picked,setPicked]=useState<string|null>(null);
 const power=usePowerProfile(),visible=usePageVisible(),reduced=useReducedMotion(),isNight=light==='night',all=view===-1;
 useEffect(()=>{cityNight.value=isNight?1:0;},[isNight]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();leaveBuilding(true);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[]);
 const concourse=useMemo(()=>view!==1?concourseItems(all):[],[view,all]);
 const bowl=useMemo(()=>view!==0?bowlItems(all):[],[view,all]);
 const pick=useMemo(()=>({keys:[] as string[],over:()=>{},out:()=>{},click:()=>{}}),[]);
 const mid=concourseMid(),title=all?'All · Open cutaway':STADIUM_VIEWS[view];
 return <section className={`skyline-interior ${isNight?'night':'day'}`} aria-label={`${shown()} interior`}>
  <Canvas style={{position:'absolute',inset:0,zIndex:0}} frameloop={visible?"demand":"never"} dpr={[1,power.maxDpr]} shadows camera={{position:VIEW_EYES[-1],fov:40}}>
   <FramePacer profile={power} running={!reduced}/>
   <color attach="background" args={[isNight?'#101b2c':'#dbe2d8']}/>
   <ambientLight color={isNight?'#c1cfed':'#ffffff'} intensity={isNight?.32:.75}/>
   <hemisphereLight args={[isNight?'#91abdc':'#eef6ff',isNight?'#303e35':'#8c7e64',isNight?.45:1.25]}/>
   <directionalLight color={isNight?'#99b8ed':'#fff4da'} position={[16,34,20]} intensity={isNight?.35:1.9} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-34} shadow-camera-right={34} shadow-camera-top={34} shadow-camera-bottom={-34}/>
   <Camera view={view}/>
   <CityOutside allFloors={all} building={STADIUM_NAME} span={16} clearSpan={I.glass.rx*2} anchorAt={s=>s.stadium&&(()=>{const [x,z]=stadiumCentre(s.stadium);return {x,z};})()}
    extras={({scene,g,m})=><Stadium plan={scene.stadium} site={scene.stadiumSite} g={g} m={m} pick={pick} night={isNight} building={false}/>}/>
   <mesh position={[0,-.18,0]} receiveShadow><boxGeometry args={[I.glass.rx*2+.4,.33,I.glass.rz*2+.4]}/><meshStandardMaterial color="#e2e2dd" roughness={.85}/></mesh>
   {/* The court's surround, out to the first row of seats. */}
   {view!==0&&<mesh position={[0,.02,0]} receiveShadow><boxGeometry args={[I.seatsInner.rx*2,.04,I.seatsInner.rz*2]}/><meshStandardMaterial color={SURROUND} roughness={.9}/></mesh>}
   <Boxes items={concourse}/><Boxes items={bowl}/>
   <FloorLabel level={view<0?0:view} width={I.glass.rx*2} depth={I.glass.rz*2} name={all?'Concourse and bowl':title}/>
   {view===0&&CONCOURSE_SPACES.map(s=>{const [x,z]=onRing(mid,s.angle);return <Html key={s.id} position={[x,3.4,z]} center zIndexRange={[8,0]}><button className="skyline-room-label" onClick={()=>setPicked(`${s.name} · ${s.what} · ${STADIUM_STATUS}`)}>{s.name}</button></Html>;})}
   {view===1&&[['Show court','One court with its lines and net, empty',[0,2,0]],['Lower tier','Seat rows nearest the court',[0,3.4,I.seatsInner.rz+2]],['Hospitality boxes','Glass-fronted boxes between the lower and upper tiers',[0,8,-(I.seatsOuter.rz-1.5)]],['Roof trusses','Exposed steel trusses under the sloping roof',[I.glass.rx-3,I.glassH,0]]].map(([name,what,p])=><Html key={name as string} position={p as [number,number,number]} center zIndexRange={[8,0]}><button className="skyline-room-label" onClick={()=>setPicked(`${name} · ${what} · ${STADIUM_STATUS}`)}>{name as string}<span>{what as string}</span></button></Html>)}
   {/* The view's only point light: a warm wash over the court, or over the concourse ring. */}
   <pointLight position={view===0?[0,6,0]:[0,16,0]} color="#ffe6bf" intensity={isNight?(view===0?60:140):10} distance={view===0?40:48} decay={1.6}/>
  </Canvas>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label={`Exit ${shown()} and return to city`}>← Exit building</button><div><small>{shown().toUpperCase()} · SPORTS AND EVENTS VENUE</small><h2>{title}</h2></div></header>
  <nav className="skyline-floor-picker" aria-label={`Choose ${shown()} view`}><strong>Floor navigation</strong>{[-1,1,0].map(n=><button key={n} aria-pressed={view===n} onClick={()=>{setView(n);setPicked(null);}}>{n===-1?'All':STADIUM_VIEWS[n]}</button>)}</nav>
  <aside className="skyline-interior-note">{picked??(all?`Concourse inside the glass, and the seating bowl round the show court · ${lookHint()}`:view===0?'Gates, stair cores, escalators, food kiosks, the shop, first aid and restrooms · Select a space':'An octagonal bowl round one show court, two tiers with aisles, hospitality boxes and the roof trusses · Select a part')}<span>{`${STADIUM_STATUS} · No tickets, attendance, scores or schedules · Nobody is shown inside · A schematic of the venue, not a seat-by-seat model`}</span></aside>
 </section>;
}
