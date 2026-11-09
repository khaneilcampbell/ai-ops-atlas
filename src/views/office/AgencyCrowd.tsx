import {useLayoutEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {poseAt,type CrowdPerson} from './agencyCrowdPlan';

const SKIN=['#c79875','#a8744f','#e0b48e','#8a5a3c','#d9a27c'];
/**
 * One floor's people as two instanced meshes (bodies and heads), posed from agencyCrowdPlan's
 * scripted paths. It draws on the frames the interior's FramePacer already paces, so it adds no
 * render loop of its own; with `animate` off (reduced motion) everyone holds a still pose.
 */
export default function AgencyCrowd({people,animate}:{people:CrowdPerson[];animate:boolean}){
 const body=useRef<THREE.InstancedMesh>(null),head=useRef<THREE.InstancedMesh>(null);
 const tmp=useMemo(()=>({o:new THREE.Object3D(),c:new THREE.Color()}),[]);
 const place=(t:number)=>{
  const b=body.current,h=head.current;if(!b||!h)return;const {o}=tmp;
  people.forEach((p,i)=>{
   const q=poseAt(p,t),sit=p.pose==='sit',step=q.moving?Math.abs(Math.sin((t+p.phase)*7))*.05:0;
   const sway=q.moving?0:Math.sin(t*.9+p.phase)*(p.pose==='present'?.12:.04);
   o.position.set(q.x,q.y+(sit?.5:.63)+step,q.z);o.rotation.set(0,q.yaw+sway,p.pose==='present'?Math.sin(t*1.7+p.phase)*.05:0);o.scale.set(1,sit?.72:1,1);o.updateMatrix();b.setMatrixAt(i,o.matrix);
   o.position.set(q.x,q.y+(sit?.88:1.09)+step,q.z);o.scale.set(1,1,1);o.updateMatrix();h.setMatrixAt(i,o.matrix);
  });
  b.instanceMatrix.needsUpdate=true;h.instanceMatrix.needsUpdate=true;
 };
 useLayoutEffect(()=>{
  const b=body.current,h=head.current;if(!b||!h)return;
  people.forEach((p,i)=>{b.setColorAt(i,tmp.c.set(p.color));h.setColorAt(i,tmp.c.set(SKIN[i%SKIN.length]));});
  if(b.instanceColor)b.instanceColor.needsUpdate=true;if(h.instanceColor)h.instanceColor.needsUpdate=true;
  place(0);b.computeBoundingSphere();h.computeBoundingSphere();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[people]);
 useFrame(state=>{if(animate)place(state.clock.elapsedTime);});
 if(!people.length)return null;
 return <group>
  <instancedMesh ref={body} args={[undefined,undefined,people.length]} castShadow frustumCulled={false}><cylinderGeometry args={[.16,.19,.65,10]}/><meshStandardMaterial roughness={.7}/></instancedMesh>
  <instancedMesh ref={head} args={[undefined,undefined,people.length]} castShadow frustumCulled={false}><sphereGeometry args={[.18,12,9]}/><meshStandardMaterial roughness={.6}/></instancedMesh>
 </group>;
}
