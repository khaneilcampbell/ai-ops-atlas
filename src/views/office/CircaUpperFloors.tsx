import {useLayoutEffect,useMemo,useRef} from "react";
import * as THREE from "three";
import {Html} from "@react-three/drei";
import {Person} from "./InteriorPrimitives";
import {circaApartmentParts,circaPoolDeckParts,type Part,type Parts} from "./circaInteriorParts";
import {circaUnits} from "./circaFloors";

/**
 * Circa's Floor 2 pool deck and Floors 3 to 6 apartments inside "Enter building".
 * Each floor draws as six instanced meshes (opaque boxes, cylinders, glow, glass and two water lists),
 * so the furniture count doesn't add draw calls. No lights: night glow is emissive only.
 */
const box=new THREE.BoxGeometry(1,1,1),cyl=new THREE.CylinderGeometry(.5,.5,1,24);

function Instances({parts,geometry,children,shadows=true}:{parts:Part[];geometry:THREE.BufferGeometry;children:React.ReactNode;shadows?:boolean}) {
  const ref=useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(()=>{
    const mesh=ref.current;if(!mesh)return;
    const o=new THREE.Object3D(),color=new THREE.Color();o.rotation.order="YXZ";
    parts.forEach((part,i)=>{o.position.set(...part.p);o.scale.set(...part.s);o.rotation.set(part.rx??0,part.r??0,0);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,color.set(part.c));});
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.computeBoundingSphere();
  },[parts]);
  if(!parts.length)return null;
  return <instancedMesh ref={ref} args={[geometry,undefined,parts.length]} castShadow={shadows} receiveShadow>{children}</instancedMesh>;
}

export function CircaParts({parts,night}:{parts:Parts;night:boolean}) {
  return <group>
    <Instances parts={parts.box} geometry={box}><meshStandardMaterial roughness={0.6}/></Instances>
    <Instances parts={parts.round} geometry={cyl}><meshStandardMaterial roughness={0.5}/></Instances>
    <Instances parts={parts.glow} geometry={box} shadows={false}><meshStandardMaterial color="#fff6e6" emissive="#ffe2b0" emissiveIntensity={night?1.6:0.5}/></Instances>
    <Instances parts={parts.glass} geometry={box} shadows={false}><meshPhysicalMaterial color="#d4e9e6" transparent opacity={0.16} roughness={0.08} metalness={0.1} depthWrite={false}/></Instances>
    <Instances parts={parts.waterRound} geometry={cyl} shadows={false}><meshStandardMaterial color={night?"#2a7fa6":"#3a9cc6"} roughness={0.08} metalness={0.1} transparent opacity={0.92}/></Instances>
    <Instances parts={parts.waterBox} geometry={box} shadows={false}><meshStandardMaterial color={night?"#2a7fa6":"#3a9cc6"} roughness={0.08} metalness={0.1} transparent opacity={0.92}/></Instances>
  </group>;
}

export function CircaPoolDeck({night}:{night:boolean}) {
  const parts=useMemo(()=>circaPoolDeckParts(),[]);
  return <group>
    <CircaParts parts={parts} night={night}/>
    <Person x={-3.2} z={4.2} color="#4c6a86"/>
    <Person x={3.3} z={-1.6} color="#b58b49"/>
  </group>;
}

export function CircaApartments({level,night,labels,onPick}:{level:number;night:boolean;labels:boolean;onPick:(text:string)=>void}) {
  const parts=useMemo(()=>circaApartmentParts(level),[level]);
  const units=circaUnits(level);
  return <group>
    <CircaParts parts={parts} night={night}/>
    {/* Residents are the AI agents who live here; CircaWalkers moves them through their rooms. */}
    {units.map(u=><group key={u.id}>
      {labels&&<Html position={[(u.x0+u.x1)/2,1.9,(u.z0+u.z1)/2]} center><button className="skyline-room-label" onClick={()=>onPick(`Apartment ${u.id} · ${u.label}`)}>{`Apartment ${u.id}`}<span>{u.beds===2?"2 bed":"1 bed"}</span></button></Html>}
    </group>)}
  </group>;
}
