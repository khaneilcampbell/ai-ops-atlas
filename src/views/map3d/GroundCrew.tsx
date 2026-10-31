import {useEffect,useMemo,useRef,type MutableRefObject} from 'react';
import * as THREE from 'three';
import {useFrame} from '@react-three/fiber';
import {AIRPORT_LAYOUT,AIRCRAFT_LAYOUT,type AirportPlan} from './airport';
import {SERVED_GATES,crewAt,crewLimit,planAirportCrew,planCrewTrains,trainAt} from './airportCrew';
import {Instanced,type Inst,type useGeometries,type useMaterials} from './models';
import {TERRACE_H} from './scene';
import {useQualityLevel} from '../../lib/governor';
import {usePowerProfile} from '../../lib/power';
type Geometry=ReturnType<typeof useGeometries>;
type Materials=ReturnType<typeof useMaterials>;

/** Apron surface height, the same level the parked aircraft stand on. */
const APRON=TERRACE_H+.06;
const VEST=['#f2a33a','#e8dc4a','#f2a33a','#e9e4d2'],SKIN=['#c6ad8f','#8d6a4f','#e0c4a4','#6f4f3a'],BAGS=['#35506b','#7a4f5a','#4e6f55','#8c7760','#3d3f45'];
/** Parts of one person, in their own frame facing -z: legs, vest, two arms (boxes); head (ball). */
const PERSON_BOXES=4;
/** People are drawn a little larger than true scale so they read at map zoom. */
const PERSON_SCALE=1.25;

/**
 * Ground crew outside the terminal. Service equipment is static and instanced; people and the
 * baggage trains are three instanced meshes moved from the airport's own clock, so they pause with
 * the aircraft (reduced motion, hidden window, Battery saver). No extra lights: wands and beacons
 * use the shared lamp material.
 */
export function GroundCrew({a,g,m,clock}:{a:AirportPlan;g:Geometry;m:Materials;clock:MutableRefObject<number>}){
 const crew=useMemo(()=>planAirportCrew(),[]),trains=useMemo(()=>planCrewTrains(),[]);
 const qualityLevel=useQualityLevel(),power=usePowerProfile();
 const limit=crewLimit(crew.length,{qualityLevel,saver:power.pauseInBackground});
 const boxes=useRef<THREE.InstancedMesh>(null),heads=useRef<THREE.InstancedMesh>(null),lamps=useRef<THREE.InstancedMesh>(null);
 const trainBoxes=trains.reduce((n,t)=>n+2+t.carts*2,0);
 const boxCount=crew.length*PERSON_BOXES+trainBoxes,lampCount=crew.filter(c=>c.role==='marshaller').length*2+trains.length;

 const equipment=useMemo(()=>{
  const solid:Inst[]=[],cones:Inst[]=[],lights:Inst[]=[];
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string,extra:Partial<Inst>={}):Inst=>({p:[a.x+x,APRON+y,a.z+z],s:[w,h,d],c,...extra});
  const gx=AIRPORT_LAYOUT.gateX,half=AIRCRAFT_LAYOUT.halfSpan;
  /** A thin hose or cable from one apron point to another (a box along its own z axis). */
  const link=(from:[number,number,number],to:[number,number,number],c:string):Inst=>{
   const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2],flat=Math.hypot(dx,dz);
   return box(from[0],from[1],from[2],.018,.018,Math.hypot(flat,dy),c,{r:Math.atan2(dx,dz),rx:-Math.atan2(dy,flat)});
  };
  for(const gz of SERVED_GATES){
   // Fuel truck parked ahead of the right wing, hose up to the wing.
   const fx=gx+1.5,fz=gz-.95;
   solid.push(box(fx,.02,fz,.17,.05,.66,'#3b4247'),box(fx,.07,fz-.24,.17,.12,.17,'#e9e4d2'),box(fx,.07,fz+.1,.15,.12,.42,'#d7dbd6'),box(fx,.07,fz+.1,.155,.025,.43,'#c9a35a'));
   solid.push(link([fx-.06,.19,fz+.15],[gx+1.05,.29,gz-.12],'#2a2f33'));
   lights.push(box(fx,.19,fz-.24,.04,.025,.04,'#ffb347'));
   // Belt loader from the apron up to the rear hold door.
   solid.push(box(gx+.45,.02,gz+.55,.4,.06,.12,'#e2c04c'),box(gx+.15,.27,gz+.55,.09,.02,.6,'#2f3437',{r:Math.PI/2,rx:.41}));
   // Pushback tug and tow bar at the nose, ground power unit on the left.
   solid.push(box(gx,.02,gz-1.88,.17,.08,.26,'#e2c04c'),box(gx,.1,gz-1.95,.12,.06,.1,'#2b3a44'),box(gx,.05,gz-1.75,.025,.02,.82,'#3b4247'));
   lights.push(box(gx,.16,gz-1.95,.035,.02,.035,'#ffb347'));
   solid.push(box(gx-.55,.02,gz-1.25,.13,.1,.18,'#e9e4d2'),box(gx-.55,.12,gz-1.25,.135,.02,.185,'#294237'),box(gx-.36,.05,gz-1.12,.3,.012,.012,'#2a2f33',{r:-.5}));
   // Safety cones at the nose, wing tips and tail.
   for(const [cx,cz] of [[gx,gz-2.2],[gx-half-.08,gz+.05],[gx+half+.08,gz+.05],[gx,gz+1.72]])cones.push(box(cx,0,cz,.045,.08,.045,'#ef7d2c'));
  }
  // Containers waiting at the cargo shed dock.
  for(const [i,dz] of [-.25,.25].entries())solid.push(box(AIRPORT_LAYOUT.terminalX+.5+1.3,0,AIRPORT_LAYOUT.cargoZ+dz,.16,.14,.2,i?'#c9ced0':'#b8bfc2'));
  return {solid,cones,lights};
 },[a]);

 // One-off colours: vests, skin tones, bag loads.
 useEffect(()=>{
  const c=new THREE.Color(),b=boxes.current,h=heads.current;if(!b||!h)return;
  crew.forEach((member,i)=>{
   const vest=member.role==='marshaller'?'#f2a33a':VEST[i%VEST.length];
   [ '#2c3440',vest,vest,vest].forEach((col,k)=>b.setColorAt(i*PERSON_BOXES+k,c.set(col)));
   h.setColorAt(i,c.set(SKIN[(i*3)%SKIN.length]));
  });
  let k=crew.length*PERSON_BOXES;
  for(const t of trains){
   b.setColorAt(k++,c.set(t.id==='cargo'?'#d7dbd6':'#e2c04c'));b.setColorAt(k++,c.set('#2b3a44'));
   for(let j=0;j<t.carts;j++){b.setColorAt(k++,c.set('#596266'));b.setColorAt(k++,c.set(t.id==='cargo'?'#c3c9cb':BAGS[(j+t.id.length)%BAGS.length]));}
  }
  for(const mesh of [b,h])if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
 },[crew,trains]);

 const scratch=useMemo(()=>({root:new THREE.Matrix4(),part:new THREE.Matrix4(),out:new THREE.Matrix4(),q:new THREE.Quaternion(),e:new THREE.Euler(),v:new THREE.Vector3(),s:new THREE.Vector3(),hidden:new THREE.Matrix4().makeScale(0,0,0)}),[]);
 const last=useRef<number|null>(null),lastLimit=useRef(-1);
 const place=(seconds:number)=>{
  const b=boxes.current,h=heads.current,l=lamps.current;if(!b||!h||!l)return;
  const {root,part,out,q,e,v,s,hidden}=scratch;
  const set=(mesh:THREE.InstancedMesh,i:number,x:number,y:number,z:number,rx:number,w:number,hh:number,d:number)=>{
   q.setFromEuler(e.set(rx,0,0));part.compose(v.set(x,y,z),q,s.set(w,hh,d));out.multiplyMatrices(root,part);mesh.setMatrixAt(i,out);
  };
  let lamp=0;
  crew.forEach((member,i)=>{
   const pose=crewAt(member,seconds),base=i*PERSON_BOXES;
   if(i>=limit||!pose.visible){for(let k=0;k<PERSON_BOXES;k++)b.setMatrixAt(base+k,hidden);h.setMatrixAt(i,hidden);if(member.role==='marshaller'){l.setMatrixAt(lamp++,hidden);l.setMatrixAt(lamp++,hidden);}return;}
   const walking=member.path.length>1&&pose.swing!==0&&member.role!=='loader';
   const bob=walking?Math.abs(pose.swing)*.006:0;
   root.compose(v.set(a.x+pose.x,APRON+bob,a.z+pose.z),q.setFromEuler(e.set(0,pose.yaw,0)),s.set(PERSON_SCALE,PERSON_SCALE,PERSON_SCALE));
   set(b,base,0,0,0,0,.05,.068,.034);
   set(b,base+1,0,.068,0,0,.064,.068,.04);
   // Arms hang from the shoulders (a box flipped by pi points down) and swing, lift or wave.
   let left=Math.PI,right=Math.PI;
   if(member.role==='marshaller'){left=right=-.35-.95*(pose.swing+1)/2;}
   else if(member.role==='loader'||member.role==='cargo'){left=right=Math.PI+.9+.6*pose.swing;}
   else if(member.role==='fueler'){right=Math.PI+1.2+pose.swing;}
   else if(walking){left=Math.PI+.45*pose.swing;right=Math.PI-.45*pose.swing;}
   set(b,base+2,-.041,.13,0,left,.016,.062,.016);
   set(b,base+3,.041,.13,0,right,.016,.062,.016);
   set(h,i,0,.163,0,0,.027,.03,.027);
   if(member.role==='marshaller')for(const [side,angle] of [[-.041,left],[.041,right]] as const){
    // Lit wands carry on from each raised arm.
    set(l,lamp++,side,.13+Math.cos(angle)*.062,Math.sin(angle)*.062,angle,.012,.07,.012);
   }
  });
  let k=crew.length*PERSON_BOXES;
  for(const t of trains){
   const at=trainAt(t,seconds);
   at.forEach((p,j)=>{
    root.compose(v.set(a.x+p.x,APRON,a.z+p.z),q.setFromEuler(e.set(0,p.yaw,0)),s.set(1,1,1));
    if(j===0){set(b,k++,0,.015,0,0,.13,.07,.2);set(b,k++,0,.085,.04,0,.1,.06,.08);set(l,lamp++,0,.145,.04,0,.03,.02,.03);}
    else{set(b,k++,0,.015,0,0,.12,.035,.2);set(b,k++,0,.05,0,0,.11,t.id==='cargo'?.12:.06,.17);}
   });
  }
  for(const mesh of [b,h,l])mesh.instanceMatrix.needsUpdate=true;
 };
 useEffect(()=>{place(clock.current);last.current=clock.current;lastLimit.current=limit;});
 useFrame(()=>{if(last.current===clock.current&&lastLimit.current===limit)return;last.current=clock.current;lastLimit.current=limit;place(clock.current);});

 return <>
  <Instanced items={equipment.solid} geometry={g.box} material={m.plain}/>
  <Instanced items={equipment.cones} geometry={g.cone} material={m.plain} shadow={false}/>
  <Instanced items={equipment.lights} geometry={g.box} material={m.lamp} shadow={false}/>
  <instancedMesh name="airport-ground-crew" ref={boxes} args={[g.box,m.plain,boxCount]} castShadow frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={heads} args={[g.ball,m.plain,crew.length]} frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={lamps} args={[g.box,m.lamp,lampCount]} frustumCulled={false} raycast={()=>null}/>
 </>;
}
