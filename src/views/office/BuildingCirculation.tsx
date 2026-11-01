import "../../styles/skyline.css";
import {useRef} from "react";
import {useFrame} from "@react-three/fiber";
import {Html} from "@react-three/drei";
import * as THREE from "three";
import {elevatorAt} from "./circulation";
import {Box,Person} from "./InteriorPrimitives";
export function ElevatorLanding({level,reduced,labels,lobbyWalk=true,runner="#315c49",edge="#c5a35c"}:{level:number;reduced:boolean;labels:boolean;lobbyWalk?:boolean;runner?:string;edge?:string}) {
  const doors=useRef<THREE.Group>(null),visitor=useRef<THREE.Group>(null);
  useFrame((state)=>{
    const lift=elevatorAt(reduced?0:state.clock.elapsedTime);
    const phase=lift.phase;
    const f=phase<2?phase/2:phase<3?1:Math.max(0,1-(phase-3)/2);
    if(visitor.current){
      if(level===0&&lobbyWalk){const approach=Math.min(1,f/0.42);visitor.current.position.set(f<0.42?0:(f-0.42)/0.58*8.3,0,5.6*(1-approach));}
      else visitor.current.position.set(-4+f*12.3,0,0);
      visitor.current.rotation.y=level===0&&lobbyWalk&&f<0.42?(phase<3?Math.PI:0):(phase<3?Math.PI/2:-Math.PI/2);
      visitor.current.visible=!reduced&&lift.landing===level&&(phase<2||phase>3);
    }
    const open=!reduced&&lift.landing===level;
    if(doors.current) doors.current.children.forEach((panel,i)=>{panel.position.z=(i?1:-1)*(open?0.85:0.3);});
  });
  return <group>
    <Box p={[8.5,-0.12,0]} s={[2.7,0.24,2.5]} color="#d4c7aa"/>
    <Box p={[9.6,1.4,0]} s={[0.13,2.8,2.4]} color="#294c3e" opacity={labels?1:0.18}/>
    {[-1,1].map(side=><Box key={side} p={[8.5,1.4,side*1.15]} s={[2.3,2.8,0.1]} color="#d4cbb8" opacity={labels?1:0.18}/>)}
    <Box p={[7.5,2.65,0]} s={[0.18,0.3,2.4]} color="#b69b60"/>
    <group ref={doors}>{[-1,1].map(side=><Box key={side} p={[7.5,1.2,side*0.3]} s={[0.08,2.4,0.58]} color="#7f9289"/>)}</group>
    {labels&&<Html position={[7.4,2.9,0]} center><span className="skyline-room-label">{level===0?"G · Lobby":`Floor ${level}`} · Lift</span></Html>}
    <Box p={[7.36,1.15,0.95]} s={[0.08,0.3,0.14]} color="#c5a35c"/>
    <group ref={visitor}><Person x={0} z={0} color="#866c49"/></group>
    <Box p={[0,0.055,0]} s={[15.5,0.04,1.9]} color={runner}/>
    {[-1,1].map(side=><Box key={side} p={[0,0.09,side*0.92]} s={[15.5,0.025,0.035]} color={edge}/>)}
  </group>;
}
export function MovingLift({reduced}:{reduced:boolean}) {
  const car=useRef<THREE.Group>(null);
  useFrame((state)=>{
    if(car.current)car.current.position.y=elevatorAt(reduced?0:state.clock.elapsedTime).height;
  });
  return <group ref={car}><Box p={[8.6,0.1,0]} s={[1.8,0.2,1.8]} color="#bba36f"/><Box p={[9.4,1.3,0]} s={[0.1,2.4,1.8]} color="#4f6b5d"/><Person x={8.6} z={0.25} color="#506b85"/></group>;
}
