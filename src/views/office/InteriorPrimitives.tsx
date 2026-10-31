export function Box({p,s,color,opacity=1}:{p:[number,number,number];s:[number,number,number];color:string;opacity?:number}) {
  return <mesh position={p} castShadow={opacity===1} receiveShadow><boxGeometry args={s}/><meshStandardMaterial color={color} transparent={opacity<1} opacity={opacity} depthWrite={opacity===1} roughness={0.65}/></mesh>;
}
export function Person({x,z,color}:{x:number;z:number;color:string}) {
  return <group position={[x,0,z]}><mesh position={[0,0.63,0]} castShadow><cylinderGeometry args={[0.16,0.19,0.65,12]}/><meshStandardMaterial color={color}/></mesh><mesh position={[0,1.09,0]} castShadow><sphereGeometry args={[0.18,16,12]}/><meshStandardMaterial color="#c79875"/></mesh></group>;
}
export function Sofa({x,z}:{x:number;z:number}) {
  return <group><Box p={[x,0.32,z]} s={[1.8,0.45,0.72]} color="#bcb19b"/><Box p={[x,0.67,z-0.32]} s={[1.8,0.65,0.14]} color="#d6cab3"/>{[-1,1].map(side=><Box key={side} p={[x+side*0.85,0.53,z]} s={[0.14,0.5,0.85]} color="#d6cab3"/>)}</group>;
}
