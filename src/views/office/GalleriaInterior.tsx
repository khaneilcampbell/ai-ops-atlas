import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import * as THREE from 'three';
import {Canvas,useThree} from '@react-three/fiber';
import {Html,OrbitControls} from '@react-three/drei';
import type {OrbitControls as OrbitControlsImpl} from 'three-stdlib';
import {usePageVisible,usePowerProfile,wake} from '../../lib/power';
import {FramePacer} from '../map3d/pacer';
import {type LightMode} from '../map3d/living';
import {night as cityNight} from '../map3d/materials';
import type {Pt} from '../map3d/roads';
import {slabGeometry,wallGeometry} from '../map3d/Galleria';
import {GALLERIA_ATRIUM_LINE,GALLERIA_BASEMENT,GALLERIA_FLOORS,GALLERIA_KEY,GALLERIA_NAME,GALLERIA_UNITS,GALLERIA,glassOutline,insidePoly,slabOutline,type GalleriaKind,type GalleriaUnit} from '../map3d/galleriaPlan';
import CityOutside from './CityOutside';
import AgencyCrowd from './AgencyCrowd';
import type {CrowdPerson} from './agencyCrowdPlan';
import {useReducedMotion} from '../../lib/motion';
import {lookHint,useInteriorTrackpad} from './useInteriorTrackpad';
import {leaveBuilding} from './store';
import '../../styles/skyline.css';
import {buildingDisplayName} from '../../modules/names';
/** The name shown inside; GALLERIA_NAME stays the map key. */
const shown=()=>buildingDisplayName(GALLERIA_KEY,GALLERIA_NAME);

/** Interior units per plan metre: the 80 m building is about 34 units across. */
export const GALLERIA_IN={k:.42,heights:[3,4,3.6,3.2] as readonly number[]} as const;
const ALL=99;
/** Floor base heights: basement below the ground, then each storey stacked. */
const BASE=[-GALLERIA_IN.heights[0],0,GALLERIA_IN.heights[1],GALLERIA_IN.heights[1]+GALLERIA_IN.heights[2]];
/** Plan metres to interior x/z: same turn as the map, so the entrance notch faces +x. */
export const toIn=([px,py]:Pt):Pt=>[-(px-40)*GALLERIA_IN.k,(py-30)*GALLERIA_IN.k];
const ACCENT:Record<GalleriaKind,string>={shop:'#c9a35a',food:'#b8735a',market:'#4f7a52',service:'#a9b4a0',lobby:'#d0ad69',play:'#d98f6b',office:'#294237',parking:'#7d8682'};
const FINISH:Record<GalleriaKind,string>={shop:'#d9c19a',food:'#efe6d6',market:'#e8e4da',service:'#d7d9d2',lobby:'#e6d6b4',play:'#c9dcc0',office:'#8aa08e',parking:'#6a706d'};

/** Plate (floor slab outline, plan metres) for a floor: basement box, ground, Floor 1, Floor 2. */
const plateOf=(floor:number)=>floor===0?GALLERIA_BASEMENT:slabOutline(floor-1);
const centroid=(p:Pt[]):Pt=>[p.reduce((a,q)=>a+q[0],0)/p.length,p.reduce((a,q)=>a+q[1],0)/p.length];
const COLUMN_IN=toIn(GALLERIA.column);

interface B {p:[number,number,number];s:[number,number,number];c:string;r?:number}
/** All of a floor's furniture boxes in one instanced mesh, so a floor stays a handful of draws. */
function Boxes({items}:{items:B[]}){
 const ref=useRef<THREE.InstancedMesh>(null);
 useLayoutEffect(()=>{const m=ref.current;if(!m)return;const o=new THREE.Object3D(),c=new THREE.Color();
  items.forEach((b,i)=>{o.position.set(b.p[0],b.p[1]+b.s[1]/2,b.p[2]);o.rotation.set(0,b.r??0,0);o.scale.set(...b.s);o.updateMatrix();m.setMatrixAt(i,o.matrix);m.setColorAt(i,c.set(b.c));});
  m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;m.computeBoundingSphere();},[items]);
 if(!items.length)return null;
 return <instancedMesh key={items.length} ref={ref} args={[undefined,undefined,items.length]} castShadow receiveShadow><boxGeometry/><meshStandardMaterial roughness={.65}/></instancedMesh>;
}
/** A wall box along a→b with its base at y. */
const seg=(a:Pt,b:Pt,y:number,h:number,t:number,c:string):B=>({p:[(a[0]+b[0])/2,y,(a[1]+b[1])/2],s:[Math.hypot(b[0]-a[0],b[1]-a[1])+.02,h,t],c,r:-Math.atan2(b[1]-a[1],b[0]-a[0])});

/**
 * What stands in one unit, all as boxes: racks and a counter in a shop, tables in the food court,
 * long aisles and checkouts in the supermarket, desks in the management suite, play blocks, arcade
 * cabinets, and parked cars between the basement columns.
 */
export function fitout(u:GalleriaUnit,y:number,near:boolean):B[]{
 const poly=u.poly.map(toIn),out:B[]=[];
 const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
 const inside=(x:number,z:number,pad=.5)=>[[0,0],[pad,0],[-pad,0],[0,pad],[0,-pad]].every(([dx,dz])=>insidePoly(poly,[x+dx,z+dz]));
 // Walls: every edge but the one facing the atrium, which is the glazed shopfront.
 const [cx,cz]=COLUMN_IN;let front=0,best=Infinity;
 poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length],d=Math.hypot((a[0]+b[0])/2-cx,(a[1]+b[1])/2-cz);if(d<best){best=d;front=i;}});
 const wall=near?.9:2.8;
 if(u.kind!=='parking')poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length];if(i===front){out.push(seg(a,b,y,.06,.08,ACCENT[u.kind]),seg(a,b,y+2.6,.3,.1,ACCENT[u.kind]));}else out.push(seg(a,b,y,wall,.12,'#f7f7f0'));});
 const grid=(step:number,each:(x:number,z:number,i:number)=>void,pad=.6)=>{let i=0;for(let x=x0+step/2;x<x1;x+=step)for(let z=z0+step/2;z<z1;z+=step)if(inside(x,z,pad))each(x,z,i++);};
 switch(u.kind){
  case 'market':
   // Shelving aisles run north-south, checkouts line the shopfront.
   for(let x=x0+1.2;x<x1-.8;x+=1.5)for(let z=z0+1;z<z1-1;z+=.5)if(inside(x,z,.7))out.push({p:[x,y,z],s:[.5,1.5,.52],c:(Math.floor(z*2)%3===0)?'#e9e3d3':'#c9a35a'});
   grid(3.2,(x,z,i)=>{if(i%5===0)out.push({p:[x,y,z],s:[.9,.9,.6],c:'#294237'});},1.4);
   break;
  case 'food':grid(1.6,(x,z)=>{out.push({p:[x,y,z],s:[.8,.74,.8],c:'#f3eadb'});for(const d of [-.6,.6])out.push({p:[x+d,y,z],s:[.34,.46,.34],c:'#b8735a'});});break;
  case 'shop':grid(1.4,(x,z,i)=>out.push(i%3===0?{p:[x,y,z],s:[1.1,.95,.5],c:ACCENT.shop}:{p:[x,y,z],s:[.9,1.6,.3],c:'#e6dccb'}));break;
  case 'office':grid(1.5,(x,z,i)=>{out.push({p:[x,y,z],s:[1.1,.75,.6],c:'#b28c56'},{p:[x,y+.75,z-.12],s:[.5,.32,.04],c:'#18372b'});if(i%6===5)out.push({p:[x+.75,y,z],s:[.06,2.4,1.4],c:'#d4e9e6'});});break;
  case 'play':grid(1.3,(x,z,i)=>out.push(u.id.endsWith('arcade')?{p:[x,y,z],s:[.6,1.6,.55],c:['#294237','#4f7a52','#8c3b34'][i%3]}:{p:[x,y,z],s:[.9,.3+.25*(i%3),.9],c:['#e7b7c0','#d0ad69','#86b958','#7fa3a0'][i%4]}));break;
  case 'lobby':{const [lx,lz]=centroid(poly);out.push({p:[lx,y,lz],s:[2,1,.8],c:'#f3eadb'},{p:[lx,y+1,lz],s:[2.1,.06,.9],c:'#c9a35a'});break;}
  case 'parking':
   for(let x=x0+1;x<x1-.6;x+=1.15)for(const z of [z0+1.4,z1-1.4,(z0+z1)/2-1.4,(z0+z1)/2+1.4])if(inside(x,z,.3)){out.push({p:[x,y,z],s:[.04,.01,2],c:'#f3efe4'});if(Math.round(x*3+z)%3!==0)out.push({p:[x+.57,y,z],s:[.8,.55,1.7],c:['#b7c2c7','#2f3a45','#e8e4da','#8c3b34'][Math.abs(Math.round(x+z))%4]},{p:[x+.57,y+.55,z],s:[.7,.35,.9],c:'#26323a'});}
   break;
  case 'service':grid(1.8,(x,z)=>out.push({p:[x,y,z],s:[1.2,2,.6],c:'#c9cfc6'}));break;
 }
 // Columns on the reference's 10 m grid that fall inside this unit.
 for(let px=10;px<80;px+=10)for(let py=10;py<60;py+=10){const [x,z]=toIn([px,py]);if(insidePoly(poly,[x,z])&&u.kind!=='market')out.push({p:[x,y,z],s:[.45,BASE[1]-BASE[0]-.3,.45],c:'#e6e1d8'});}
 return out;
}

function Floor({floor,y,labels,cutaway,night,picked,onPick}:{floor:number;y:number;labels:boolean;cutaway:boolean;night:boolean;picked?:string;onPick:(u:GalleriaUnit)=>void}){
 const plate=useMemo(()=>plateOf(floor).map(toIn),[floor]);
 const atrium=useMemo(()=>floor>=2?GALLERIA_ATRIUM_LINE.map(toIn):undefined,[floor]);
 const geo=useMemo(()=>{
  const slab=slabGeometry(plate,y-.25,.25,atrium);
  const glass=floor>=1?wallGeometry(glassOutline(floor-1).map(toIn),y,y+GALLERIA_IN.heights[floor]-.1):undefined;
  return {slab,glass};
 },[plate,atrium,y,floor]);
 useEffect(()=>()=>{geo.slab.dispose();geo.glass?.dispose();},[geo]);
 const units=useMemo(()=>GALLERIA_UNITS.filter(u=>u.floor===floor),[floor]);
 const floors=useMemo(()=>units.map(u=>({id:u.id,c:FINISH[u.kind],geo:slabGeometry(u.poly.map(toIn),y,.02)})),[units,y]);
 useEffect(()=>()=>{for(const f of floors)f.geo.dispose();},[floors]);
 const boxes=useMemo(()=>{
  const out:B[]=[];
  for(const u of units)out.push(...fitout(u,y,cutaway&&centroid(u.poly.map(toIn))[1]>2));
  // Glass balustrade with a warm rail round the atrium.
  if(atrium)atrium.forEach((a,i)=>{const b=atrium[(i+1)%atrium.length];out.push(seg(a,b,y,1,.04,'#cfe3e0'),seg(a,b,y+1,.05,.08,'#c9a35a'));});
  // Lift and stair core beside the north lobby (plan grid 6/F).
  const [lx,lz]=toIn([50,52]);out.push({p:[lx,y,lz],s:[1.8,GALLERIA_IN.heights[floor]-.2,1.6],c:'#b3beb8'});
  return out;
 },[units,y,cutaway,atrium,floor]);
 return <group>
  <mesh geometry={geo.slab} receiveShadow castShadow><meshStandardMaterial color={floor===0?'#8a8f8b':'#ece5d6'} roughness={.5}/></mesh>
  {floors.map(f=><mesh key={f.id} geometry={f.geo} receiveShadow><meshStandardMaterial color={f.c} roughness={.75}/></mesh>)}
  {geo.glass&&<mesh geometry={geo.glass}><meshStandardMaterial color="#cfe6e2" transparent opacity={.22} depthWrite={false} side={THREE.DoubleSide} emissive="#f0c27a" emissiveIntensity={night?.25:0}/></mesh>}
  <Boxes items={boxes}/>
  {[-1,1].map(s=><pointLight key={s} position={[s*7,y+2.8,0]} color="#ffe5b4" intensity={night?24:3} distance={22} decay={2}/>)}
  {labels&&units.map(u=>{const [x,z]=centroid(u.poly.map(toIn));return <Html key={u.id} position={[x,y+3.2,z]} center><button className="skyline-room-label" aria-pressed={picked===u.id} title={u.name} onClick={()=>onPick(u)}>{u.name}<span>{u.kind==='parking'?'Car park':u.kind==='service'?'Back of house':u.kind==='lobby'?'Entrance':'Planned · not selling'}</span></button></Html>;})}
 </group>;
}

type P3=[number,number,number];
/** One flight between floors: up and down escalators in a pair across the atrium, and a stair from the basement. */
export interface GalleriaRun {from:number;kind:'up'|'down'|'stair';foot:P3;top:P3}
/**
 * The flights that start on `floor` (KC, 2026-11-08): each shopping floor pair has an up and a down escalator side by
 * side, crossing the atrium at 30°, and the basement has a stair beside the lift core up to the ground floor.
 */
export function galleriaRuns(floor:number):GalleriaRun[]{
 const [x,z]=COLUMN_IN,y=BASE[floor];
 if(floor===0){const [lx]=toIn([50,52]),rise=GALLERIA_IN.heights[0],run=rise/Math.tan(Math.PI*.2);// Halfway between two rows of the 10 m column grid, so no column stands in the flight.
  const sz=toIn([0,45])[1];return [{from:0,kind:'stair',foot:[lx+1.2,y,sz],top:[lx+1.2+run,y+rise,sz]}];}
 if(floor>2)return [];
 const rise=GALLERIA_IN.heights[floor],run=rise/Math.tan(Math.PI/6),dir=floor%2?1:-1,side=floor%2?1:-1,ez=z+side*2.6,dz=ez-side*1.25;
 return [{from:floor,kind:'up',foot:[x-dir*run/2,y,ez],top:[x+dir*run/2,y+rise,ez]},{from:floor,kind:'down',foot:[x-dir*run/2,y,dz],top:[x+dir*run/2,y+rise,dz]}];
}
/** A flight as boxes: treads climbing from foot to top, glass sides and warm handrails on escalators, solid stringers on the stair. */
function runBoxes(r:GalleriaRun):B[]{
 const out:B[]=[],n=r.kind==='stair'?16:12,[fx,fy,fz]=r.foot,[tx,ty,tz]=r.top,run=Math.hypot(tx-fx,tz-fz),yaw=-Math.atan2(tz-fz,tx-fx);
 for(let i=0;i<n;i++){const t=(i+.5)/n,sx=fx+(tx-fx)*t,sz=fz+(tz-fz)*t,sy=fy+(ty-fy)*t;
  out.push({p:[sx,sy-.25,sz],s:[run/n+.02,.25,1],c:r.kind==='stair'?(i%2?'#cfc8b8':'#d9d3c4'):(i%2?'#4a4f4c':'#555b57'),r:yaw});
  for(const k of [-.55,.55]){const ox=Math.sin(yaw)*k,oz=Math.cos(yaw)*k;
   if(r.kind==='stair')out.push({p:[sx+ox,sy-.3,sz+oz],s:[run/n+.02,.4,.06],c:'#8e958f',r:yaw},{p:[sx+ox,sy+.85,sz+oz],s:[run/n+.02,.05,.05],c:'#3b4744',r:yaw});
   else out.push({p:[sx+ox,sy,sz+oz],s:[run/n+.02,.9,.04],c:'#cfe3e0',r:yaw},{p:[sx+ox,sy+.9,sz+oz],s:[run/n+.02,.06,.08],c:r.kind==='up'?'#c9a35a':'#8c6a52',r:yaw});}
 }
 return out;
}
function Runs({floor}:{floor:number}){const items=useMemo(()=>galleriaRuns(floor).flatMap(runBoxes),[floor]);return <Boxes items={items}/>;}

const SHIRTS=['#4f6b5d','#7a4b3a','#5d7a8c','#a1674a','#2f4a3a','#8c6a52','#3f5f86','#8c3b52'];
/** The atrium line pushed `k` plan metres outward: the gallery walk between the balustrade and the shopfronts. */
function gallery(k:number):Pt[]{
 const l=GALLERIA_ATRIUM_LINE,[cx,cy]=centroid(l);
 return l.map(([x,y])=>{const d=Math.hypot(x-cx,y-cy)||1;return toIn([x+(x-cx)/d*k,y+(y-cy)/d*k]);});
}
/**
 * Shoppers, staff and drivers on one floor (KC, 2026-11-08), as AgencyCrowd paths at the floor's
 * own height: strollers circle the gallery walk, shoppers step from it into a shop and back, one
 * member of staff stands in each unit, and in the basement drivers walk from the lift to the cars.
 */
export function galleriaCrowd(floor:number,y:number):CrowdPerson[]{
 const out:CrowdPerson[]=[],person=(id:string,path:[number,number,number][],dwell:number[],speed:number,phase:number,i:number):CrowdPerson=>({id,level:floor,color:SHIRTS[(i*5+floor)%SHIRTS.length],pose:path.length===1?'stand':'walk',path,dwell,speed,phase});
 const units=GALLERIA_UNITS.filter(u=>u.floor===floor);
 if(floor===0){
  const [lx,lz]=toIn([50,52]);
  units.filter(u=>u.kind==='parking').slice(0,2).forEach((u,i)=>{const [x,z]=centroid(u.poly.map(toIn));for(const k of [0,1])out.push(person(`b${i}${k}`,[[lx,y,lz+1.2],[x+k*2-1,y,z]],[3,4],1.1,i*5+k*9,i*2+k));});
  // Drivers who parked climb the stair to the ground floor and come back down to their cars.
  const [st]=galleriaRuns(0),top=st.top;
  units.filter(u=>u.kind==='parking').slice(0,2).forEach((u,i)=>{const [x,z]=centroid(u.poly.map(toIn));
   out.push(person(`st${i}`,[[x,y,z+1],[st.foot[0]-.6,y,st.foot[2]],st.foot,top,[top[0]+1.2,top[1],top[2]],top,st.foot,[st.foot[0]-.6,y,st.foot[2]]],[3,0,0,0,6,0,0,0],.9,i*11,i+5));});
  return out;
 }
 const walk=gallery(floor===1?2.5:3.5),ring:[number,number,number][]=walk.filter((_,i)=>i%2===0).map(([x,z])=>[x,y,z]);
 for(let i=0;i<6;i++)out.push(person(`s${i}`,ring,ring.map((_,k)=>k===i%ring.length?2.5:0),.9+.1*(i%3),i*6.5,i));
 // Riders leave the floor: up one escalator, a turn on the floor above, and back down the other (from Floor 2, the reverse).
 const pairs=[...galleriaRuns(floor).map(r=>({r,below:false})),...(floor>1?galleriaRuns(floor-1):[]).map(r=>({r,below:true}))];
 const up=pairs.find(p=>p.r.kind==='up'&&!p.below)??pairs.find(p=>p.r.kind==='up'),down=pairs.find(p=>p.r.kind==='down'&&p.below===up?.below);
 if(up&&down){
  const [a,b]=up.below?[down.r.top,down.r.foot]:[up.r.foot,up.r.top],[c,d]=up.below?[up.r.foot,up.r.top]:[down.r.top,down.r.foot];
  const away=(q:P3,k:number):P3=>[q[0]+Math.sign(q[0]-COLUMN_IN[0])*k,q[1],q[2]];
  for(let i=0;i<3;i++){const start=ring[(i*3+1)%ring.length];
   out.push(person(`e${i}`,[start,away(a,.8),a,b,away(b,1.4),c,d,away(d,.8)],[3,0,0,0,5,0,0,0],1,i*9,i+11));}
 }
 // On the ground floor some shoppers walk out through the main entrance and back in later.
 if(floor===1){const door=toIn([23,25]),outside=toIn([12,25.6]);
  for(let i=0;i<3;i++){const start=ring[(i*4)%ring.length];out.push(person(`x${i}`,[start,[door[0],y,door[1]],[outside[0]+i*.6,y,outside[1]+(i-1)*.8],[door[0],y,door[1]]],[2,0,9,0],1.1,i*7,i+15));}}
 units.filter(u=>u.kind!=='service').forEach((u,i)=>{
  const [x,z]=centroid(u.poly.map(toIn));
  out.push(person(`t${u.id}`,[[x+.6,y,z+.4]],[0],1,i,i+3));
  const [wx,wz]=walk.reduce((b,p)=>Math.hypot(p[0]-x,p[1]-z)<Math.hypot(b[0]-x,b[1]-z)?p:b,walk[0]);
  out.push(person(`v${u.id}`,[[wx,y,wz],[x-.5,y,z-.3]],[1.5,5+i%3*2],1,i*4.1,i+7));
 });
 return out;
}

/** The steel funnel rising through the atrium into the polycarbonate canopy, and the zig-zag escalators. */
/**
 * The funnel at full building height. On a single floor the building is drawn with that floor at y 0, so the funnel
 * drops by the floor's base and is cut at its ceiling: a slim stem low down, flaring only near the roof, as it really is.
 */
function Atrium({top,night,shift=0,ceiling}:{top:number;night:boolean;shift?:number;ceiling?:number}){
 const [x,z]=COLUMN_IN,R=GALLERIA.canopyR*GALLERIA_IN.k;
 const geo=useMemo(()=>new THREE.LatheGeometry(Array.from({length:16},(_,i)=>{const t=i/15;return new THREE.Vector2(.25+(R-.25)*t**2.6,t*top);}),28),[top,R]);
 useEffect(()=>()=>geo.dispose(),[geo]);
 const clip=useMemo(()=>ceiling===undefined?[]:[new THREE.Plane(new THREE.Vector3(0,-1,0),ceiling)],[ceiling]);
 return <group>
  <group position={[x,BASE[1]-shift,z]}>
   {/* A solid steel funnel (KC, 2026-11-08); the gridshell ribs sit just proud of its skin. */}
   <mesh geometry={geo} castShadow><meshStandardMaterial color="#f1f2ec" roughness={.4} metalness={.15} side={THREE.DoubleSide} clippingPlanes={clip}/></mesh>
   <mesh geometry={geo} scale={[1.012,1,1.012]}><meshBasicMaterial color="#b9c1b5" wireframe clippingPlanes={clip}/></mesh>
   {!clip.length&&<mesh position={[0,top,0]}><cylinderGeometry args={[R+.1,R+.1,.08,40]}/><meshStandardMaterial color="#dce2d5" transparent opacity={.55} emissive="#d0ad69" emissiveIntensity={night?.8:0} depthWrite={false}/></mesh>}
  </group>
 </group>;
}

/** White fins along the far side of each storey, so the cutaway still reads as the building outside. */
function Fins({floors,stacked}:{floors:number[];stacked:boolean}){
 const items=useMemo(()=>floors.filter(f=>f>=1).flatMap(f=>{
  const edge=slabOutline(f).map(toIn),y=stacked?BASE[f]:0,H=GALLERIA_IN.heights[f];
  return edge.flatMap((a,i)=>{const b=edge[(i+1)%edge.length];if((a[1]+b[1])/2>1)return [];const h=H*(.35+.5*(.5+.5*Math.sin(i*.35+f*1.9)));return [{p:[a[0],y+H-h+.3,a[1]] as [number,number,number],s:[.06,h,.32] as [number,number,number],c:'#f7f7f0',r:-Math.atan2(b[1]-a[1],b[0]-a[0])}];});
 }),[floors,stacked]);
 return <Boxes items={items}/>;
}

function FloorCrowd({floor,animate}:{floor:number;animate:boolean}){
 const people=useMemo(()=>galleriaCrowd(floor,BASE[floor]),[floor]);
 return <AgencyCrowd people={people} animate={animate}/>;
}

function GalleriaCamera({mode}:{mode:number}){
 const controls=useRef<OrbitControlsImpl>(null);const {camera,invalidate,size}=useThree();
 const far=size.width<size.height?1.8:1;
 useLayoutEffect(()=>{
  wake(1000);const all=mode===ALL;
  camera.position.set(...((all?[30,30,36]:[22,24,28]).map(v=>v*far)) as [number,number,number]);
  const t=controls.current?.target;if(t){t.set(0,all?3:0,0);camera.lookAt(t);controls.current?.update();}invalidate();
 },[mode,camera,invalidate,far]);
 useInteriorTrackpad(()=>controls.current,{x:17,z:13});
 return <OrbitControls ref={controls} makeDefault minDistance={8} maxDistance={80} maxPolarAngle={Math.PI/2.15}/>;
}

/** Atlas Galleria inside: the basement car park, the ground floor shops, and two floors above, round the funnel atrium. */
export default function GalleriaInterior({light}:{light:LightMode}){
 const reduced=useReducedMotion();
 const [mode,setMode]=useState(ALL);
 const [picked,setPicked]=useState<GalleriaUnit|null>(null);
 const power=usePowerProfile(),visible=usePageVisible(),isNight=light==='night';
 useEffect(()=>{cityNight.value=isNight?1:0;},[isNight]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();leaveBuilding(true);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[]);
 const floors=mode===ALL?[0,1,2,3]:[mode];
 const info=GALLERIA_FLOORS.find(f=>f.floor===mode);
 const title=mode===ALL?'All floors · Open cutaway':info!.title;
 const offset=(f:number)=>mode===ALL?BASE[f]:0;
 return <section className={`skyline-interior mall-interior galleria-interior ${isNight?'night':'day'}`} aria-label={`${shown()} interior`}>
  <Canvas style={{position:'absolute',inset:0,zIndex:0}} frameloop={visible?'demand':'never'} dpr={[1,power.maxDpr]} shadows camera={{position:[26,24,30],fov:42}} onCreated={({gl})=>{gl.localClippingEnabled=true;}}>
   <FramePacer profile={power} running={!reduced}/>
   <color attach="background" args={[isNight?'#101b2c':'#dbe2d8']}/>
   <hemisphereLight args={[isNight?'#91abd0':'#f4f7ee',isNight?'#1a2a22':'#8a9a82',isNight?.85:1.2]}/>
   <directionalLight position={[-14,30,18]} intensity={isNight?.5:1.6} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={22} shadow-camera-bottom={-22}/>
   <GalleriaCamera mode={mode}/>
   {/* The city on every floor: an upper floor is drawn at y 0, so the city drops by that floor's height to stay level with the street; the basement keeps the street at its own level, like the Marketplace. */}
   <CityOutside building={GALLERIA_NAME} span={34} clearSpan={44} scaleOverride={(s)=>s.galleria?GALLERIA_IN.k/s.galleria.s:undefined} anchorAt={s=>{if(!s.galleria)return;const [x,z]=s.galleria.toMap([40,30]);return {x,z};}} allFloors={mode===ALL} elevation={mode>=2&&mode!==ALL?BASE[mode]:0}/>
   {floors.map(f=><group key={f} position={[0,offset(f)-BASE[f],0]}>
    <Floor floor={f} y={BASE[f]} labels={mode!==ALL} cutaway night={isNight} picked={picked?.id} onPick={setPicked}/>
    <FloorCrowd floor={f} animate={!reduced}/>
    <Runs floor={f}/>
    {mode===ALL&&<Html position={[-18,BASE[f]+.3,0]} center><span className="skyline-room-label building-floor-label">{GALLERIA_FLOORS[f].label}</span></Html>}
   </group>)}
   {mode!==0&&<Atrium top={BASE[3]+GALLERIA_IN.heights[3]+.6} night={isNight} shift={mode===ALL?0:BASE[mode]} ceiling={mode===ALL?undefined:GALLERIA_IN.heights[mode]-.05}/>}
   <Fins floors={floors} stacked={mode===ALL}/>
  </Canvas>
  <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)} aria-label={`Exit ${shown()} and return to city`}>← Exit building</button><div><small>{shown().toUpperCase()} · SHOPPING MALL</small><h2>{title}</h2></div><span/></header>
  <nav className="skyline-floor-picker" aria-label={`Choose ${shown()} floor`}><strong>Floor navigation</strong>
   {[ALL,3,2,1,0].map(n=><button key={n} aria-pressed={mode===n} onClick={()=>{setMode(n);setPicked(null);}}>{n===ALL?'All floors':GALLERIA_FLOORS[n].label}</button>)}</nav>
  <aside className="skyline-interior-note">{picked?<>{picked.name}<span>{picked.note}</span></>:mode===ALL?<>Basement car park and three shopping floors round a funnel atrium · {lookHint()}<span>Planned building · Visual only · No shop is selling or connected.</span></>:<>{info!.summary}<span>Planned building · Select a unit to see what it is for.</span></>}</aside>
 </section>;
}
