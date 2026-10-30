import {elevatorAt} from "./circulation";
import {useRef} from "react";
import {useFrame} from "@react-three/fiber";
import * as THREE from "three";
import {useReducedMotion} from "../../lib/motion";
import {leaveBuilding} from "./store";
/** A visible entrance on the open edge of an interior, with two sliding glass leaves. */
export default function LobbyEntrance({z,width=2,height=2.4}:{z:number;width?:number;height?:number}) {
  const doors=useRef<THREE.Group>(null),opening=useRef(0);
  const reduced=useReducedMotion();
  useFrame((state,dt)=>{
    if(!reduced)state.invalidate();
    const lift=elevatorAt(reduced?0:state.clock.elapsedTime);
    const target=!reduced&&lift.landing===0&&(lift.phase<1||lift.phase>4)?1:0;
    opening.current+=(target-opening.current)*(1-Math.exp(-Math.min(dt,0.1)*10));
    doors.current?.children.forEach((panel,i)=>{panel.position.x=(i?1:-1)*width*(0.25+opening.current*0.48);});
  });
  return <group position={[0,0,z]} onClick={e=>{e.stopPropagation();leaveBuilding(true);}}>
    {[-1,1].map(side=><mesh key={side} position={[side*(width/2+0.07),height/2,0]} castShadow><boxGeometry args={[0.1,height,0.13]}/><meshStandardMaterial color="#b99a59" metalness={0.55} roughness={0.3}/></mesh>)}
    <mesh position={[0,height+0.03,0]}><boxGeometry args={[width+0.25,0.13,0.18]}/><meshStandardMaterial color="#b99a59"/></mesh>
    <mesh position={[0,0.04,0]} receiveShadow><boxGeometry args={[width+0.2,0.08,0.45]}/><meshStandardMaterial color="#c9b98d"/></mesh>
    <group ref={doors}>{[-1,1].map(side=><group key={side} position={[side*width/4,0,0]}>
      <mesh position={[0,height/2,0]}><boxGeometry args={[width*0.48,height-0.1,0.055]}/><meshPhysicalMaterial color="#abcfc6" transparent opacity={0.32} roughness={0.12} metalness={0.15} depthWrite={false}/></mesh>
      <mesh position={[-side*width*0.17,height*0.45,-0.05]}><boxGeometry args={[0.035,0.35,0.035]}/><meshStandardMaterial color="#d6ba79" metalness={0.6}/></mesh>
      <mesh position={[0,height*0.4,0]}><boxGeometry args={[width*0.48,0.04,0.065]}/><meshStandardMaterial color="#c7ad70"/></mesh>
    </group>)}</group>
    <mesh position={[0,0.012,-0.7]}><boxGeometry args={[width*1.2,0.025,0.8]}/><meshStandardMaterial color="#234937"/></mesh>
    <mesh position={[0,height+0.23,0]}><boxGeometry args={[0.55,0.2,0.07]}/><meshStandardMaterial color="#26714e" emissive="#2c8759" emissiveIntensity={0.3}/></mesh>
  </group>;
}
