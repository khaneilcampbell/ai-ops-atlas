import {useEffect,useLayoutEffect,useMemo,useReducer,useRef} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {Html} from '@react-three/drei';
import * as THREE from 'three';
import type {AirportPlan} from '../map3d/airport';
import {fleetPose} from '../map3d/flightSchedule';
import {GOLD_JET_SLOT,goldJetLive,goldJetState} from '../map3d/goldJetPlan';
import {goldJetRide} from '../map3d/goldJetIds';
import {SeatedPerson} from './InteriorPrimitives';
import {cabinToMap,rideView} from './goldJetOutsidePlan';
import {CABIN_FLOOR_DROP,JET_CABIN as C,JET_ROOMS,cabinHalfWidth,roomCentreX,seatedPassengers,type JetRoom} from './goldJetInteriorPlan';

/**
 * Riding the gold jet inside the map (Khaneil, 2026-11-13: "I want to see Atlas design clearly like im outside the map
 * but im in the plane. i want to see other planes when im inside the plane as well"). The cabin is drawn in the map's
 * own scene, carried by the jet's live pose, and the map camera rides with it: the real city, airport, sky and every
 * other plane go by outside. The map's own gold jet is hidden meanwhile, since this cabin stands in for it.
 */
type Item={p:[number,number,number];s:[number,number,number];c:string;r?:number};
const WOOD='#3a281c',WOOD_LIGHT='#5a3f2a',LEATHER='#4a382c',CREAM='#d8c8ac',GOLD='#c9a046',CARPET='#5a5148',SHELL='#2a211b',CLOTHES=['#2f3b45','#b8893b','#e8e2d4','#6b3f4a','#30594c','#8c96a3'];

function Boxes({items,glow=false,night=false}:{items:Item[];glow?:boolean;night?:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null),invalidate=useThree(s=>s.invalidate);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;invalidate();const o=new THREE.Object3D(),c=new THREE.Color();
  items.forEach((it,i)=>{o.position.set(...it.p);o.rotation.set(0,it.r??0,0);o.scale.set(...it.s);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,c.set(it.c));});
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
 },[items,invalidate]);
 if(!items.length)return null;
 return <instancedMesh key={items.length} ref={ref} args={[undefined,undefined,items.length]} ><boxGeometry/>{glow?<meshBasicMaterial toneMapped={false}/>:<meshStandardMaterial roughness={.55} emissive={night?'#3b2714':'#120c06'} emissiveIntensity={night?1:.5}/>}</instancedMesh>;
}

/** Furniture for one room. */
function furniture(r:JetRoom):Item[]{
 const cx=roomCentreX(r),w=r.x1-r.x0,out:Item[]=[],b=(x:number,h0:number,z:number,sx:number,h:number,sz:number,c:string)=>out.push({p:[x,h0+h/2,z],s:[sx,h,sz],c});
 const recliner=(x:number,z:number,face:1|-1)=>{b(x,0,z,1,.5,1,LEATHER);b(x-face*.42,.5,z,.2,.7,1,LEATHER);for(const s of [-1,1])b(x,.5,z+s*.45,.9,.18,.12,LEATHER);};
 switch(r.id){
  case 'flightdeck':b(r.x1-1.2,0,0,1.2,1,3.6,'#1c2024');b(r.x1-1.1,1,0,1,.06,3.3,'#2f5266');for(const s of [-1,1])b(r.x0+2,0,s*.9,.8,1.2,.8,CREAM);break;
  case 'office':b(cx+.6,0,-.2,1.2,.78,2.6,WOOD_LIGHT);b(cx+.6,.78,-.2,1.3,.05,2.7,GOLD);b(cx+1.6,0,-.2,.7,1.1,.7,LEATHER);b(r.x0+1,0,-1.6,1.6,.45,.9,CREAM);b(r.x1-.4,0,1.6,.5,2,1.2,WOOD);break;
  case 'lounge':for(const x of [9.2,5.4])for(const z of [-1.5,1.2])recliner(x,z,x>7?-1:1);for(const z of [-1.5,1.2])b(7.3,0,z,.9,.55,.9,WOOD);b(cx,0,-2.45,w-2,.5,.6,CREAM);break;
  case 'cinema':b(r.x1-.15,.6,0,.12,2.2,4,'#0c0e12');for(const x of [-1.6,-3.8])for(const z of [-1,1])recliner(x,z,1);b(r.x0+.6,0,-2.2,.8,1.4,.6,WOOD);break;
  case 'bar':b(cx+1,0,-2,4,1.1,.7,WOOD);b(cx+1,1.1,-2,4.1,.06,.8,GOLD);for(let k=0;k<4;k++)b(cx-.4+k*.95,0,-1.3,.4,.75,.4,LEATHER);b(cx-2.4,0,1.3,1,.45,2.6,CREAM);b(cx-2.9,.45,1.3,.2,.5,2.6,CREAM);b(cx,0,1.6,1,.4,1,WOOD);break;
  case 'dining':b(cx,0,0,4.6,.76,1.3,WOOD_LIGHT);b(cx,.76,0,4.7,.04,1.4,GOLD);for(let k=0;k<4;k++)for(const s of [-1,1])b(cx-1.75+k*1.17,0,s*1.1,.5,1,.5,LEATHER);b(r.x0+.5,0,-2.2,.8,1.6,.5,WOOD);break;
  case 'suite':b(cx,0,-.6,2.2,.6,2.2,'#efe6d5');b(cx-1.2,0,-.6,.2,1.3,2.4,WOOD);b(cx+.6,0,1.6,.9,.8,.5,WOOD);break;
 }
 return out;
}

/** Cabin floor, the dark wood bulkheads between rooms (with a doorway), the low cutaway sill on the camera side and the
 * gold cove lines along the top of the far wall. */
function cabinItems():{solid:Item[];glow:Item[]}{
 const solid:Item[]=[],glow:Item[]=[],half=cabinHalfWidth(),len=C.noseX-C.tailX,mid=(C.noseX+C.tailX)/2;
 solid.push({p:[mid,-.15,0],s:[len,.3,half*2],c:CARPET});
 for(const r of JET_ROOMS){
  solid.push({p:[roomCentreX(r),.01,0],s:[r.x1-r.x0-.2,.02,half*2-.4],c:r.id==='bar'||r.id==='dining'?'#3d322a':'#4f463d'});
  if(r.id!=='flightdeck'){solid.push({p:[r.x1,1.2,-half/2-.45],s:[.12,2.4,half-.9],c:WOOD});glow.push({p:[r.x1,2.42,-half/2-.45],s:[.14,.04,half-.9],c:'#f2c879'});}
  solid.push(...furniture(r));
 }
 // Camera-side sill: the fuselage cut low so the cabin shows, white outside like the tail end of the livery.
 solid.push({p:[mid,.35,half+.05],s:[len,.7,.12],c:'#efe9dc'});
 // Gold cove lines along the far wall and a warm floor wash on both sides.
 glow.push({p:[mid,2.55,-half+.35],s:[len-1,.05,.05],c:'#f6cf86'},{p:[mid,.04,-half+.25],s:[len-1,.03,.05],c:'#e8b35f'},{p:[mid,.04,half-.2],s:[len-1,.03,.05],c:'#e8b35f'});
 // The cinema screen: a night Earth from orbit, as in the reference, drawn as a dark blue panel with a lit limb.
 glow.push({p:[2.78,1.8,0],s:[.02,1.6,3.4],c:'#18304e'},{p:[2.77,1.2,0],s:[.02,.08,3.2],c:'#7fb2e0'});
 // World map in the office: a dark panel with a gold frame.
 solid.push({p:[15,1.7,-half+.3],s:[3,1.4,.06],c:GOLD});glow.push({p:[15,1.7,-half+.34],s:[2.8,1.2,.02],c:'#1f3b55'});
 return {solid,glow};
}

/** The far half of the fuselage tube: a curved shell from the floor up over the top, open toward the camera. */
/** Tube centre height: the cabin floor sits CABIN_FLOOR_DROP below the fuselage's centre line. */
const CY=CABIN_FLOOR_DROP;
/** A point on the inside of the tube at angle a (pi/2 = top, pi = far side, at the centre line's height). */
const onShell=(a:number,r=C.radius-.04):[number,number]=>[CY+Math.sin(a)*r,Math.cos(a)*r];
/** The far half of the fuselage tube: a curved shell from the floor up over the top, open toward the camera. */
function Shell({night}:{night:boolean}){
 const res=useMemo(()=>{
  const len=C.noseX-C.tailX,floorA=Math.PI+Math.asin(CABIN_FLOOR_DROP/C.radius),topA=Math.PI/2-.15;
  const geo=new THREE.CylinderGeometry(C.radius,C.radius,len,40,1,true,topA,floorA-topA);
  geo.rotateZ(Math.PI/2);geo.translate((C.noseX+C.tailX)/2,CY,0);
  const mat=new THREE.MeshStandardMaterial({color:SHELL,roughness:.6,side:THREE.DoubleSide});
  // Stars on the ceiling over the lounge and cinema: tiny lit points on the shell's inner face.
  const stars:Item[]=[];let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  for(let i=0;i<220;i++){const [y,z]=onShell(Math.PI*(.5+rnd()*.32));stars.push({p:[-5.5+rnd()*17,y,z],s:[.08,.08,.08],c:rnd()>.3?'#fff4d8':'#ffe1a0'});}
  return {geo,mat,stars};
 },[]);
 useEffect(()=>{res.mat.color.set(night?'#1f1813':SHELL);},[res,night]);
 useEffect(()=>()=>{res.geo.dispose();res.mat.dispose();},[res]);
 return <><mesh geometry={res.geo} material={res.mat}/><Boxes items={res.stars} glow/></>;
}

/** Windows along the far wall: small lit panels on the shell, sky blue by day, dark at night. */
function windowItems(night:boolean):Item[]{
 const out:Item[]=[],[y,z]=onShell(Math.PI-.09,C.radius-.06);
 for(let x=C.tailX+2.5;x<C.noseX-5;x+=1.6)out.push({p:[x,y,z],s:[.45,.6,.04],c:night?'#24344c':'#bfe0f2'});
 return out;
}

/** Nose and tail outside the cutaway: a gold nose and white tail cone, so the room reads as the inside of the jet. */
function Ends(){
 const res=useMemo(()=>{
  const nose=new THREE.SphereGeometry(C.radius,32,16,0,Math.PI*2,0,Math.PI/2);nose.rotateZ(-Math.PI/2);nose.scale(1.9,1,1);
  const tail=new THREE.ConeGeometry(C.radius,9,32,1,true);tail.rotateZ(Math.PI/2);
  const gold=new THREE.MeshStandardMaterial({color:GOLD,metalness:.6,roughness:.3});
  const white=new THREE.MeshStandardMaterial({color:'#f2eee4',roughness:.4,side:THREE.DoubleSide});
  // Swept low wings either side (drawn in x/y, laid flat into x/z), gold engines under them, and a tall white fin.
  const wingShape=new THREE.Shape([[7,0],[-3,0],[-13,19],[-9.5,19]].map(([x,y])=>new THREE.Vector2(x,y)));
  const wing=new THREE.ExtrudeGeometry(wingShape,{depth:.35,bevelEnabled:false});wing.rotateX(Math.PI/2);
  const finShape=new THREE.Shape([[-17,0],[-26,0],[-30,9],[-25.5,9]].map(([x,y])=>new THREE.Vector2(x,y)));
  const fin=new THREE.ExtrudeGeometry(finShape,{depth:.4,bevelEnabled:false});fin.translate(0,0,-.2);
  const engine=new THREE.CylinderGeometry(1.25,1.05,5.5,24);engine.rotateZ(Math.PI/2);
  return {nose,tail,gold,white,wing,fin,engine};
 },[]);
 useEffect(()=>()=>{for(const v of Object.values(res))v.dispose();},[res]);
 const wingY=CY-C.radius+.9,halfW=cabinHalfWidth();
 return <>
  <mesh geometry={res.nose} material={res.gold} position={[C.noseX,CY,0]}/><mesh geometry={res.tail} material={res.white} position={[C.tailX-4.5,CY,0]}/>
  {[1,-1].map(side=><group key={side} position={[0,wingY,side*(halfW-.3)]} scale={[1,1,side]}>
   <mesh geometry={res.wing} material={res.white} position={[0,.35,0]}/>
   <mesh geometry={res.engine} material={res.gold} position={[1.5,-1.3,8.5]}/>
  </group>)}
  <mesh geometry={res.fin} material={res.white} position={[0,CY+C.radius-.6,0]}/>
 </>;
}


/** drei Html scale: the tags are sized for the cutaway's usual distance and shrink as you pull back. Map units, since
 * the cabin is drawn at map scale. */
const DISTANCE=1.6;
/** The cabin, its outside and its passengers, in cabin metres. */
function Cabin({night}:{night:boolean}){
 const cabin=useMemo(cabinItems,[]),windows=useMemo(()=>windowItems(night),[night]);
 const seats=seatedPassengers(goldJetState(goldJetLive.clock,goldJetLive.circuit).aboard);
 return <>
  <Shell night={night}/><Ends/>
  <Boxes items={cabin.solid} night={night}/><Boxes items={cabin.glow} glow/><Boxes items={windows} glow/>
  {seats.map((p,i)=><group key={i} position={[p.x,.05,p.z]} rotation={[0,p.yaw,0]} scale={1.15}><SeatedPerson x={0} z={0} color={CLOTHES[i%CLOTHES.length]}/></group>)}
  {/* Room names: small quiet tags low on the far wall that scale with distance, so they read without covering the cabin. */}
  {JET_ROOMS.map(r=><Html key={r.id} position={[roomCentreX(r),2.9,-cabinHalfWidth()+.6]} center distanceFactor={DISTANCE} zIndexRange={[6,0]} style={{pointerEvents:'none'}}><span className="gold-jet-room-tag">{r.name}</span></Html>)}
 </>;
}

interface RideControls {target:THREE.Vector3;enabled:boolean}
/**
 * Mounted in the map's scene while you are inside the gold jet: carries the cabin with the jet and puts the map camera
 * in it. The map skips its own camera controls meanwhile and gets them back, with the view you left, on the way out.
 */
export default function GoldJetRide({plan,night,controls}:{plan:AirportPlan;night:boolean;controls:RideControls}){
 const group=useRef<THREE.Group>(null);
 const {camera,size,invalidate}=useThree();
 const portrait=size.width<size.height;
 useLayoutEffect(()=>{
  const cam=camera as THREE.PerspectiveCamera,near=cam.near;
  goldJetRide.active=true;controls.enabled=false;cam.near=.05;cam.updateProjectionMatrix();invalidate();
  return ()=>{goldJetRide.active=false;controls.enabled=true;cam.near=near;cam.up.set(0,1,0);cam.updateProjectionMatrix();};
 },[camera,controls,invalidate]);
 const eye=useMemo(()=>new THREE.Vector3(),[]),target=useMemo(()=>new THREE.Vector3(),[]),up=useMemo(()=>new THREE.Vector3(),[]);
 // Seats fill and empty at the gate: re-render the passengers now and then, not every frame.
 const [,tick]=useReducer((n:number)=>n+1,0);
 useEffect(()=>{const id=window.setInterval(tick,700);return()=>window.clearInterval(id);},[tick]);
 useFrame(()=>{
  const g=group.current;if(!g)return;
  const m=cabinToMap(fleetPose(goldJetLive.clock,GOLD_JET_SLOT,goldJetLive.circuit),plan);
  g.matrix.copy(m);g.matrixWorldNeedsUpdate=true;
  const v=rideView(goldJetRide.view,portrait,goldJetRide.yaw,goldJetRide.pitch,goldJetRide.zoom);
  eye.copy(v.eye).applyMatrix4(m);target.copy(v.target).applyMatrix4(m);up.set(0,1,0).transformDirection(m);
  camera.up.copy(up);camera.position.copy(eye);controls.target.copy(target);camera.lookAt(target);
 });
 return <group ref={group} matrixAutoUpdate={false}><Cabin night={night}/></group>;
}
