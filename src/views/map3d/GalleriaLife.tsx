import {useLayoutEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {usePowerProfile,useWindowFocused} from '../../lib/power';
import type {GalleriaPlan} from './galleriaPlan';
import {driverAt,planGalleriaLife,walkerAt,type LifePose} from './galleriaLifePlan';
import type {useGeometries,useMaterials} from './models';

const SHIRTS=['#346583','#a18455','#6d875e','#846798','#ab6355','#c9a35a','#3f5f6b'],SKIN=['#dfb996','#9b6d50','#c79875','#6f4f3a'];
const CARS=['#2f3a45','#e8e4da','#8c3b34','#b7c2c7'];

/**
 * Shoppers and drivers round the Atlas Galleria, as three instanced meshes (bodies, heads, car
 * parts) posed from galleriaLife's scripted loops. Paused with the rest of the map's motion
 * (reduced motion, hidden window, Battery saver); no lights, timers or React updates per frame.
 */
export function GalleriaLife({plan,g,m,moving}:{plan?:GalleriaPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;moving:boolean}){
 const life=useMemo(()=>plan?planGalleriaLife(plan):undefined,[plan]),power=usePowerProfile(),focused=useWindowFocused();
 const enabled=moving&&focused&&power.idleFps>15,elapsed=useRef(0);
 const bodies=useRef<THREE.InstancedMesh>(null),heads=useRef<THREE.InstancedMesh>(null),cars=useRef<THREE.InstancedMesh>(null);
 const o=useMemo(()=>new THREE.Object3D(),[]);
 const people=life?life.walkers.length+life.drivers.length:0,carParts=life?life.drivers.length*2:0;
 const place=(t:number)=>{
  if(!life||!plan)return;const y0=plan.y0,b=bodies.current,h=heads.current,c=cars.current;if(!b||!h||!c)return;
  const person=(i:number,p:LifePose)=>{
   if(!p.visible){o.scale.set(0,0,0);o.updateMatrix();b.setMatrixAt(i,o.matrix);h.setMatrixAt(i,o.matrix);return;}
   const bob=p.moving?Math.abs(Math.sin((t+i)*7))*.008:0;
   o.position.set(p.x,y0+bob,p.z);o.rotation.set(0,p.yaw,0);o.scale.set(.07,.16,.06);o.updateMatrix();b.setMatrixAt(i,o.matrix);
   o.position.y=y0+bob+.21;o.scale.setScalar(.035);o.updateMatrix();h.setMatrixAt(i,o.matrix);
  };
  life.walkers.forEach((w,i)=>person(i,walkerAt(w,t)));
  life.drivers.forEach((d,j)=>{
   const at=driverAt(d,t);person(life.walkers.length+j,at.person);
   const k=j*2;
   if(!at.car.visible){o.scale.set(0,0,0);o.updateMatrix();c.setMatrixAt(k,o.matrix);c.setMatrixAt(k+1,o.matrix);return;}
   o.position.set(at.car.x,y0+.012,at.car.z);o.rotation.set(0,at.car.yaw,0);o.scale.set(.2,.1,.38);o.updateMatrix();c.setMatrixAt(k,o.matrix);
   o.position.y=y0+.11;o.scale.set(.17,.07,.2);o.updateMatrix();c.setMatrixAt(k+1,o.matrix);
  });
  for(const mesh of [b,h,c])mesh.instanceMatrix.needsUpdate=true;
 };
 useLayoutEffect(()=>{
  if(!life)return;const col=new THREE.Color();
  for(let i=0;i<people;i++){bodies.current?.setColorAt(i,col.set(SHIRTS[(i*3)%SHIRTS.length]));heads.current?.setColorAt(i,col.set(SKIN[i%SKIN.length]));}
  life.drivers.forEach((_,j)=>{cars.current?.setColorAt(j*2,col.set(CARS[j%CARS.length]));cars.current?.setColorAt(j*2+1,col.set('#26323a'));});
  for(const r of [bodies,heads,cars])if(r.current?.instanceColor)r.current.instanceColor.needsUpdate=true;
  place(elapsed.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[life,enabled]);
 useFrame((_,dt)=>{if(!enabled||document.visibilityState==='hidden')return;elapsed.current+=Math.min(dt,.1);place(elapsed.current);});
 if(!life||!people)return null;
 return <group name="atlas-galleria-life">
  <instancedMesh name="galleria-shoppers" ref={bodies} args={[g.cyl,m.plain,people]} castShadow frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={heads} args={[g.ball,m.plain,people]} frustumCulled={false} raycast={()=>null}/>
  {carParts>0&&<instancedMesh name="galleria-driver-cars" ref={cars} args={[g.box,m.plain,carParts]} castShadow frustumCulled={false} raycast={()=>null}/>}
 </group>;
}
