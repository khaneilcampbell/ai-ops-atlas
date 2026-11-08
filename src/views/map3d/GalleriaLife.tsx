import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {usePowerProfile,useWindowFocused} from '../../lib/power';
import type {Scene3D} from './scene';
import {Instanced,type Inst,type useGeometries,type useMaterials} from './models';
import {GALLERIA_LIFE,driverAt,planGalleriaLife,walkerAt} from './galleriaLifePlan';

const COATS=['#346583','#a18455','#6d875e','#846798','#ab6355','#2f3a45'];
/**
 * Atlas Galleria's grounds: the entrance walk, its lamp posts, and the people and cars that come
 * and go. Static parts are instanced once; the moving ones are four instanced meshes posed on the
 * map's own frames (no render loop of their own), and hold still when motion is off.
 */
export function GalleriaLife({scene,g,m,night,moving}:{scene:Scene3D;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;night:boolean;moving:boolean}){
 const life=useMemo(()=>planGalleriaLife(scene),[scene]),power=usePowerProfile(),focused=useWindowFocused();
 const y=scene.galleria?.y0??0,L=GALLERIA_LIFE;
 const glow=useMemo(()=>new THREE.MeshBasicMaterial({color:'#ffd18a',transparent:true,opacity:.14,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),[]);
 useEffect(()=>()=>glow.dispose(),[glow]);
 const fixed=useMemo(()=>{
  const paths:Inst[]=[],kerbs:Inst[]=[],poles:Inst[]=[],heads:Inst[]=[],pools:Inst[]=[],court:Inst[]=[];if(!life)return {paths,kerbs,poles,heads,pools,court};
  for(let i=1;i<life.walk.length;i++){
   const [ax,az]=life.walk[i-1],[bx,bz]=life.walk[i],len=Math.hypot(bx-ax,bz-az),yaw=Math.atan2(bx-ax,bz-az);
   paths.push({p:[(ax+bx)/2,y,(az+bz)/2],s:[L.walkWidth,.02,len+L.walkWidth],r:yaw,c:'#e3dac4'});
   for(const s of [-1,1])kerbs.push({p:[(ax+bx)/2+Math.cos(yaw)*s*L.walkWidth/2,y,(az+bz)/2-Math.sin(yaw)*s*L.walkWidth/2],s:[.04,.035,len+L.walkWidth],r:yaw,c:'#c9bfa6'});
  }
  for(const l of life.lamps){
   poles.push({p:[l.x,y,l.z],s:[.04,L.lampHeight,.04],c:'#294237'},{p:[l.x,y,l.z],s:[.09,.07,.09],c:'#b4ac8e'},{p:[l.x+Math.sin(l.yaw)*.1,y+L.lampHeight,l.z+Math.cos(l.yaw)*.1],s:[.035,.035,.22],r:l.yaw,c:'#294237'});
   heads.push({p:[l.x+Math.sin(l.yaw)*.19,y+L.lampHeight-.02,l.z+Math.cos(l.yaw)*.19],s:[.1,.04,.14],r:l.yaw,c:'#f6dfac'});
   pools.push({p:[l.x+Math.sin(l.yaw)*.19,y+.025,l.z+Math.cos(l.yaw)*.19],s:[1.1,.003,1.1],c:'#ffffff'});
  }
  // The street court: asphalt, bay lines, and the parked cars nobody is about to drive.
  if(life.court){
   for(const p of life.court.pad)court.push({p:[p.x+p.w/2,y,p.z+p.d/2],s:[p.w,.012,p.d],c:'#5d6360'});
   for(const [x,z] of life.court.stripes)court.push({p:[x,y+.012,z],s:[.38,.004,.025],c:'#f3efe4'});
   for(const c of life.court.cars)court.push({p:[c.x,y+.012,c.z],s:[.38,.1,.2],c:c.c},{p:[c.x,y+.112,c.z],s:[.2,.07,.17],c:'#26323a'});
  }
  return {paths,kerbs,poles,heads,pools,court};
 },[life,y,L]);

 const enabled=moving&&focused&&power.idleFps>15,elapsed=useRef(0);
 const bodies=useRef<THREE.InstancedMesh>(null),faces=useRef<THREE.InstancedMesh>(null),cars=useRef<THREE.InstancedMesh>(null),cabins=useRef<THREE.InstancedMesh>(null);
 const people=(life?.walkers.length??0)+(life?.drivers.length??0),fleet=life?.drivers.length??0;
 const o=useMemo(()=>new THREE.Object3D(),[]);
 const place=(t:number)=>{
  if(!life)return;let i=0;
  const person=(p:ReturnType<typeof walkerAt>,step:number)=>{
   if(p.visible){o.position.set(p.x,y+.02+step,p.z);o.rotation.set(0,p.yaw,0);o.scale.set(.07,.16,.06);}else o.scale.setScalar(0);
   o.updateMatrix();bodies.current?.setMatrixAt(i,o.matrix);
   if(p.visible){o.position.y=y+.23+step;o.scale.setScalar(.035);}o.updateMatrix();faces.current?.setMatrixAt(i,o.matrix);i++;
  };
  life.walkers.forEach((w,k)=>person(walkerAt(w,t),Math.abs(Math.sin(t*6+k))*.008));
  life.drivers.forEach((d,k)=>{
   const {person:p,car}=driverAt(d,t);person(p,Math.abs(Math.sin(t*6+k))*.008);
   if(car.visible){o.position.set(car.x,y+.012,car.z);o.rotation.set(0,car.yaw,0);o.scale.set(.2,.1,.38);}else o.scale.setScalar(0);
   o.updateMatrix();cars.current?.setMatrixAt(k,o.matrix);
   if(car.visible){o.position.y=y+.112;o.scale.set(.17,.07,.2);}o.updateMatrix();cabins.current?.setMatrixAt(k,o.matrix);
  });
  for(const r of [bodies,faces,cars,cabins])if(r.current)r.current.instanceMatrix.needsUpdate=true;
 };
 useLayoutEffect(()=>{
  if(!life)return;const c=new THREE.Color();
  for(let i=0;i<people;i++){bodies.current?.setColorAt(i,c.set(COATS[i%COATS.length]));faces.current?.setColorAt(i,c.set(i%3?'#dfb996':'#9b6d50'));}
  life.drivers.forEach((d,k)=>{cars.current?.setColorAt(k,c.set(d.car.c));cabins.current?.setColorAt(k,c.set('#26323a'));});
  for(const r of [bodies,faces,cars,cabins])if(r.current?.instanceColor)r.current.instanceColor.needsUpdate=true;
  place(elapsed.current);
  // Posed once when paused; frames then do the work only while moving.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[life,enabled]);
 useFrame((_,dt)=>{if(!enabled||document.visibilityState==='hidden')return;elapsed.current+=Math.min(dt,.1);place(elapsed.current);});
 if(!life)return null;
 return <group name="galleria-life">
  <Instanced items={fixed.paths} geometry={g.box} material={m.plain} shadow={false}/>
  <Instanced items={fixed.kerbs} geometry={g.box} material={m.plain} shadow={false}/>
  <Instanced items={fixed.court} geometry={g.box} material={m.plain} shadow={false}/>
  <Instanced items={fixed.poles} geometry={g.box} material={m.plain}/>
  <Instanced items={fixed.heads} geometry={g.box} material={night?m.lamp:m.plain} shadow={false}/>
  {night&&<Instanced items={fixed.pools} geometry={g.cyl} material={glow} shadow={false}/>}
  <instancedMesh name="galleria-shoppers" ref={bodies} args={[g.cyl,m.plain,people]} castShadow frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={faces} args={[g.ball,m.plain,people]} frustumCulled={false} raycast={()=>null}/>
  {fleet>0&&<instancedMesh name="galleria-cars" ref={cars} args={[g.box,m.plain,fleet]} castShadow frustumCulled={false} raycast={()=>null}/>}
  {fleet>0&&<instancedMesh ref={cabins} args={[g.box,m.plain,fleet]} frustumCulled={false} raycast={()=>null}/>}
 </group>;
}
