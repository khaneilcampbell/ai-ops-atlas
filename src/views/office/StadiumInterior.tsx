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
import {STADIUM_NAME} from '../map3d/stadiumPlan';
import {stadiumCentre} from '../map3d/stadiumGeometry';
import CityOutside from './CityOutside';
import {lookHint,useInteriorTrackpad} from './useInteriorTrackpad';
import FloorLabel from './FloorLabel';
import {leaveBuilding} from './store';
import {CONCOURSE_SPACES,STADIUM_INTERIOR as I,STADIUM_STATUS,STADIUM_VIEWS,aisleAngles,concourseMid,hospitalityBoxes,inAisle,lerpEllipse,onEllipse,seatRows,spacePoint,type ConcourseSpace,type Ellipse} from './stadiumInteriorPlan';
import '../../styles/skyline.css';

type Item={p:[number,number,number];s:[number,number,number];c:string;r?:number};
const STONE='#d9d2c4',CREAM='#efe9dd',INK='#2b2a28',GLASS='#a9c3c6',GREEN='#3f7a4c',LINE='#f3f1e6';
/** Seat colours by tier and alternating rows: Atlas's sage, forest and gold, no team colours. */
const SEAT=[['#7f9c86','#6f8d77'],['#2f4a3a','#3a5646'],['#c9a35a','#b8924f']];

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
function ringOf(e:Ellipse,n:number,y:number,h:number,thick:number,color:(k:number,a:number)=>string,skip:(a:number)=>boolean=()=>false):Item[]{
 const out:Item[]=[];
 for(let k=0;k<n;k++){
  const a0=k/n*Math.PI*2,a1=(k+1)/n*Math.PI*2,am=(a0+a1)/2;if(skip(am))continue;
  const [x0,z0]=onEllipse(e,a0),[x1,z1]=onEllipse(e,a1);
  out.push({p:[(x0+x1)/2,y+h/2,(z0+z1)/2],s:[Math.hypot(x1-x0,z1-z0)+.02,h,thick],c:color(k,am),r:-Math.atan2(z1-z0,x1-x0)});
 }
 return out;
}
/** In the all-views cutaway the south-west quarter of the stands is cut low, so the camera sees in. */
const cutaway=(a:number)=>{const n=((a%(Math.PI*2))+Math.PI*2)%(Math.PI*2);return n>Math.PI*.55&&n<Math.PI*.95;};

function bowlItems(all:boolean):Item[]{
 const items:Item[]=[];
 // Pitch, run-off, markings and goals.
 const P=I.pitch;items.push({p:[0,.05,0],s:[P.w,.04,P.d],c:GREEN});
 for(let k=0;k<8;k++)items.push({p:[-P.w/2+P.w*(k+.5)/8,.072,0],s:[P.w/8-.02,.004,P.d-.02],c:k%2?'#3a7347':'#448253'});
 const lw=.12,ly=.08;
 items.push({p:[0,ly,-P.d/2],s:[P.w,.01,lw],c:LINE},{p:[0,ly,P.d/2],s:[P.w,.01,lw],c:LINE},{p:[-P.w/2,ly,0],s:[lw,.01,P.d],c:LINE},{p:[P.w/2,ly,0],s:[lw,.01,P.d],c:LINE},{p:[0,ly,0],s:[lw,.01,P.d],c:LINE});
 items.push(...ringOf({rx:2.6,rz:2.6},24,ly-.005,.01,lw,()=>LINE));
 for(const side of [-1,1]){
  const gx=side*P.w/2;
  // Penalty box and goal: two posts and a crossbar, with a net box behind.
  items.push({p:[gx-side*2.6,ly,-3.2],s:[5.2,.01,lw],c:LINE},{p:[gx-side*2.6,ly,3.2],s:[5.2,.01,lw],c:LINE},{p:[gx-side*5.2,ly,0],s:[lw,.01,6.5],c:LINE});
  items.push({p:[gx,.6,-1.1],s:[.1,1.2,.1],c:'#ffffff'},{p:[gx,.6,1.1],s:[.1,1.2,.1],c:'#ffffff'},{p:[gx,1.2,0],s:[.1,.1,2.3],c:'#ffffff'},{p:[gx+side*.5,.6,0],s:[1,1.15,2.2],c:'#dfe4df'});
 }
 // Seat rows: a riser and a seat line for each row, aisles left open.
 const rows=seatRows();
 for(const r of rows){
  const n=Math.round(r.ring.rx*1.6),low=all&&cutaway;
  items.push(...ringOf(r.ring,n,r.y-.5,.5,.85,()=>'#cfc8b9',a=>inAisle(a)||(!!low&&low(a)&&r.tier>0)));
  items.push(...ringOf(r.ring,n,r.y,.28,.5,k=>SEAT[r.tier][(r.row+k)%2],a=>inAisle(a)||(!!low&&low(a)&&r.tier>0)));
 }
 // Aisle steps up through every tier.
 for(const a of aisleAngles())for(const r of rows){if(all&&cutaway(a)&&r.tier>0)continue;const [x,z]=onEllipse(r.ring,a);items.push({p:[x,r.y-.25,z],s:[.6,.5,.75],c:'#bdb5a5',r:-a});}
 // Tier fronts: a low wall at the front of each tier.
 for(let t=0;t<I.tiers;t++){const f=rows.find(r=>r.tier===t&&r.row===0)!;items.push(...ringOf(lerpEllipse(f.ring,{rx:0,rz:0},.015),Math.round(f.ring.rx*1.6),f.y-.5,.9,.18,()=>CREAM,a=>!!(all&&t>0&&cutaway(a))));}
 // Hospitality ring between the middle and upper tiers: glass-fronted boxes.
 for(const b of hospitalityBoxes()){
  const a=-b.yaw;if(all&&cutaway(a))continue;const o=I.hospitality,[fx,fz]=onEllipse(lerpEllipse(b.ring,{rx:0,rz:0},-.02),a);
  items.push({p:[b.x,b.y+o.height/2-.4,b.z],s:[3.4,o.height,o.depth],c:'#e7dfd0',r:b.yaw+Math.PI/2},{p:[fx,b.y+o.height/2-.3,fz],s:[3.2,o.height*.7,.06],c:GLASS,r:b.yaw+Math.PI/2});
 }
 // Two scoreboards on the short ends, above the top row, facing the pitch.
 const top=rows[rows.length-1];
 for(const side of [-1,1]){const x=side*(top.ring.rx-1.2);items.push({p:[x,top.y+I.scoreboard.h/2+1.4,0],s:[.3,I.scoreboard.h+.4,I.scoreboard.w+.4],c:INK},{p:[x-side*.17,top.y+I.scoreboard.h/2+1.4,0],s:[.04,I.scoreboard.h,I.scoreboard.w],c:'#3f6f66'},{p:[x,top.y/2+.7,0],s:[.3,top.y+1.4,.3],c:'#8d8a82'});}
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
 return <section className={`skyline-interior ${isNight?'night':'day'}`} aria-label={`${STADIUM_NAME} interior`}>
  <Canvas style={{position:'absolute',inset:0,zIndex:0}} frameloop={visible?"demand":"never"} dpr={[1,power.maxDpr]} shadows camera={{position:VIEW_EYES[-1],fov:40}}>
   <FramePacer profile={power} running={!reduced}/>
   <color attach="background" args={[isNight?'#101b2c':'#dbe2d8']}/>
   <ambientLight color={isNight?'#c1cfed':'#ffffff'} intensity={isNight?.32:.75}/>
   <hemisphereLight args={[isNight?'#91abdc':'#eef6ff',isNight?'#303e35':'#8c7e64',isNight?.45:1.25]}/>
   <directionalLight color={isNight?'#99b8ed':'#fff4da'} position={[16,34,20]} intensity={isNight?.35:1.9} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-34} shadow-camera-right={34} shadow-camera-top={34} shadow-camera-bottom={-34}/>
   <Camera view={view}/>
   <CityOutside allFloors={all} building={STADIUM_NAME} span={16} clearSpan={I.glass.rx*2} anchorAt={s=>s.stadium&&(()=>{const [x,z]=stadiumCentre(s.stadium);return {x,z};})()}
    extras={({scene,g,m})=><Stadium plan={scene.stadium} site={scene.stadiumSite} g={g} m={m} pick={pick} night={isNight} building={false}/>}/>
   <group scale={[I.glass.rx+.2,1,I.glass.rz+.2]}><mesh position={[0,-.18,0]} receiveShadow><cylinderGeometry args={[1,1,.33,64]}/><meshStandardMaterial color="#e4dccd" roughness={.85}/></mesh></group>
   {/* Run-off round the pitch, oval like the first row of seats. */}
   {view!==0&&<group scale={[I.seatsInner.rx,1,I.seatsInner.rz]}><mesh position={[0,.02,0]} receiveShadow><cylinderGeometry args={[1,1,.04,64]}/><meshStandardMaterial color="#5d7f61" roughness={.9}/></mesh></group>}
   <Boxes items={concourse}/><Boxes items={bowl}/>
   <FloorLabel level={view<0?0:view} width={I.glass.rx*2} depth={I.glass.rz*2} name={all?'Concourse and bowl':title}/>
   {view===0&&CONCOURSE_SPACES.map(s=>{const [x,z]=onEllipse(mid,s.angle);return <Html key={s.id} position={[x,3.4,z]} center zIndexRange={[8,0]}><button className="skyline-room-label" onClick={()=>setPicked(`${s.name} · ${s.what} · ${STADIUM_STATUS}`)}>{s.name}</button></Html>;})}
   {view===1&&[['Pitch','Grass field with goals and markings',[0,2,0]],['Lower tier','Seat rows nearest the pitch',[0,3.4,I.seatsInner.rz+2]],['Hospitality boxes','Glass-fronted boxes between the middle and upper tiers',[0,9,-(I.seatsOuter.rz-1.5)]],['Scoreboard','Blank screen, no scores shown',[I.seatsOuter.rx-1.2,12.5,0]]].map(([name,what,p])=><Html key={name as string} position={p as [number,number,number]} center zIndexRange={[8,0]}><button className="skyline-room-label" onClick={()=>setPicked(`${name} · ${what} · ${STADIUM_STATUS}`)}>{name as string}<span>{what as string}</span></button></Html>)}
   {/* The view's only point light: a warm wash over the pitch, or over the concourse ring. */}
   <pointLight position={view===0?[0,6,0]:[0,16,0]} color="#ffe6bf" intensity={isNight?(view===0?60:140):10} distance={view===0?40:48} decay={1.6}/>
  </Canvas>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label={`Exit ${STADIUM_NAME} and return to city`}>← Exit building</button><div><small>{STADIUM_NAME.toUpperCase()} · SPORTS AND EVENTS VENUE</small><h2>{title}</h2></div></header>
  <nav className="skyline-floor-picker" aria-label={`Choose ${STADIUM_NAME} view`}><strong>Floor navigation</strong>{[-1,1,0].map(n=><button key={n} aria-pressed={view===n} onClick={()=>{setView(n);setPicked(null);}}>{n===-1?'All':STADIUM_VIEWS[n]}</button>)}</nav>
  <aside className="skyline-interior-note">{picked??(all?`Concourse under the stands, and the seating bowl round the pitch · ${lookHint()}`:view===0?'Gates, stair cores, escalators, food kiosks, the shop, first aid and restrooms · Select a space':'Pitch, three tiers with aisles, hospitality boxes and two scoreboards · Select a part')}<span>{`${STADIUM_STATUS} · No tickets, attendance, scores or schedules · Nobody is shown inside · A schematic of the venue, not a seat-by-seat model`}</span></aside>
 </section>;
}
