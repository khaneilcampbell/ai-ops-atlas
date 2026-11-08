import {useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import type {Group} from 'three';
import {Box,Person,SeatedPerson} from './InteriorPrimitives';
import {officeWalkAt,type OfficeWalk} from './officeWalk';
/** Bounded visual routine only. No React updates, timers, requests or execution-state changes per frame. */
export function OfficeWander({route,active,color='#5a8067'}:{route:OfficeWalk;active:boolean;color?:string}){
 const root=useRef<Group>(null),seated=useRef<Group>(null),standing=useRef<Group>(null),left=useRef<Group>(null),right=useRef<Group>(null),elapsed=useRef(0);
 useFrame((_,delta)=>{
  if(active)elapsed.current+=Math.min(delta,.1);
  const s=officeWalkAt(route,elapsed.current);
  if(root.current){root.current.position.set(s.x,0,s.z);root.current.rotation.y=s.yaw;}
  if(seated.current)seated.current.visible=s.phase==='seated';
  if(standing.current)standing.current.visible=s.phase!=='seated';
  const gait=s.phase==='walking'?Math.sin(elapsed.current*7)*.3:0;
  if(left.current)left.current.rotation.x=gait;if(right.current)right.current.rotation.x=-gait;
 });
 return <group ref={root} position={[route.points[0][0],0,route.points[0][1]]} rotation={[0,route.seatYaw,0]}>
  <group ref={seated}><SeatedPerson x={0} z={0} color={color}/></group>
  <group ref={standing} visible={false}><Person x={0} z={0} color={color}/>
   {[left,right].map((ref,i)=><group key={i} ref={ref} position={[i?.09:-.09,.48,0]}><Box p={[0,-.2,0]} s={[.13,.4,.13]} color="#294237"/></group>)}
  </group>
 </group>;
}
