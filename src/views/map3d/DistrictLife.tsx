import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {usePowerProfile,useWindowFocused} from '../../lib/power';
import type {Scene3D} from './scene';
import {TERRACE_H} from './scene';
import type {useGeometries,useMaterials} from './models';
import {CLEAR_ARCHITECTURAL_GLASS} from './architecturalGlass';
import {doorOpenness} from './doorTraffic';
import {planDistrictLife,visitorAt,visitorDoorOccupied} from './districtLifePlan';

/** Bounded, instanced visual visitors. No registry entries, model calls or React frame updates. */
export function DistrictLife({scene,g,m,moving}:{scene:Scene3D;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;moving:boolean}){
 const plan=useMemo(()=>planDistrictLife(scene),[scene]),power=usePowerProfile(),focused=useWindowFocused();
 const enabled=moving&&focused&&power.idleFps>15,elapsed=useRef(0),bodies=useRef<THREE.InstancedMesh>(null),heads=useRef<THREE.InstancedMesh>(null),clubs=useRef<THREE.InstancedMesh>(null),doors=useRef<THREE.InstancedMesh>(null),handles=useRef<THREE.InstancedMesh>(null),openings=useRef<number[]>([]);
 const glass=useMemo(()=>new THREE.MeshPhysicalMaterial(CLEAR_ARCHITECTURAL_GLASS),[]),object=useMemo(()=>new THREE.Object3D(),[]);
 useEffect(()=>()=>glass.dispose(),[glass]);
 const place=(seconds:number,dt:number,snap=false)=>{
  plan.visitors.forEach((v,i)=>{
   const p=visitorAt(v,seconds),floor=TERRACE_H+p.y;
   object.position.set(p.x,floor,p.z);object.rotation.set(0,p.yaw,0);object.scale.set(.07,.16,.06);object.updateMatrix();bodies.current?.setMatrixAt(i,object.matrix);
   object.position.y=floor+.21;object.scale.setScalar(.035);object.updateMatrix();heads.current?.setMatrixAt(i,object.matrix);
   object.position.set(p.x+.045,floor+.015,p.z+.025);object.scale.set(v.golf?.012:0,v.golf?.18:0,v.golf?.016:0);object.updateMatrix();clubs.current?.setMatrixAt(i,object.matrix);
  });
  plan.doors.forEach((d,i)=>{
   const occupied=visitorDoorOccupied(d,plan,seconds),open=snap?(occupied?1:0):doorOpenness(openings.current[i]??0,occupied,dt);openings.current[i]=open;
   for(const side of [-1,1]){
    object.position.set(d.x+side*d.width*(.25+open*.5),TERRACE_H+.17,d.z+.012);object.rotation.set(0,0,0);object.scale.set(d.width*.48,d.height,.014);object.updateMatrix();doors.current?.setMatrixAt(i*2+(side===1?1:0),object.matrix);
    object.position.x-=side*d.width*.16;object.position.y+=d.height*.3;object.position.z+=.018;object.scale.set(.012,d.height*.3,.012);object.updateMatrix();handles.current?.setMatrixAt(i*2+(side===1?1:0),object.matrix);
   }
  });
  for(const ref of [bodies,heads,clubs,doors,handles])if(ref.current)ref.current.instanceMatrix.needsUpdate=true;
 };
 useLayoutEffect(()=>{
  const color=new THREE.Color();plan.visitors.forEach((v,i)=>{bodies.current?.setColorAt(i,color.set(['#346583','#a18455','#6d875e','#846798','#ab6355'][i%5]));heads.current?.setColorAt(i,color.set(i%3?'#dfb996':'#9b6d50'));clubs.current?.setColorAt(i,color.set(v.golf?'#aeb9bc':'#294237'));});
  for(const ref of [bodies,heads,clubs])if(ref.current?.instanceColor)ref.current.instanceColor.needsUpdate=true;
  for(let i=0;i<plan.doors.length*2;i++)handles.current?.setColorAt(i,color.set('#b6a172'));if(handles.current?.instanceColor)handles.current.instanceColor.needsUpdate=true;
  place(elapsed.current,0,true);
  // Geometry is written once in paused mode; subsequent frames do no work.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[plan,enabled]);
 useFrame((_,dt)=>{if(!enabled||document.visibilityState==='hidden')return;elapsed.current+=Math.min(dt,.1);place(elapsed.current,dt);});
 return <group name="district-life-simulation">
  <instancedMesh name="district-visitors" ref={bodies} args={[g.cyl,m.plain,plan.visitors.length]} castShadow frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={heads} args={[g.ball,m.plain,plan.visitors.length]} frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={clubs} args={[g.box,m.plain,plan.visitors.length]} frustumCulled={false} raycast={()=>null}/>
  <instancedMesh name="visitor-entrance-doors" ref={doors} args={[g.box,glass,plan.doors.length*2]} frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={handles} args={[g.box,m.metal,plan.doors.length*2]} frustumCulled={false} raycast={()=>null}/>
 </group>;
}
