import {useLayoutEffect,useMemo,useRef} from "react";
import * as THREE from "three";
import {Html} from "@react-three/drei";
import {circaApartmentParts,circaPoolDeckParts,type Part,type Parts} from "./circaInteriorParts";
import {circaUnits,type CircaTower} from "./circaFloors";
import type {CircaResidentNow} from "./CircaWalkers";
import {AgentAvatar} from "../../components/AgentIdentity";

/**
 * Circa's Floor 2 pool deck on the podium and Floors 3 to 6 apartments in each tower inside "Enter building".
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
    <Instances parts={parts.glow} geometry={box} shadows={false}><meshStandardMaterial color="#fff6e6" emissive="#ffe2b0" emissiveIntensity={night?2.6:0.5}/></Instances>
    <Instances parts={parts.glass} geometry={box} shadows={false}><meshPhysicalMaterial color="#d4e9e6" transparent opacity={0.16} roughness={0.08} metalness={0.1} depthWrite={false}/></Instances>
    <Instances parts={parts.waterRound} geometry={cyl} shadows={false}><meshStandardMaterial color={night?"#2a7fa6":"#3a9cc6"} roughness={0.08} metalness={0.1} transparent opacity={0.92}/></Instances>
    <Instances parts={parts.waterBox} geometry={box} shadows={false}><meshStandardMaterial color={night?"#2a7fa6":"#3a9cc6"} roughness={0.08} metalness={0.1} transparent opacity={0.92}/></Instances>
  </group>;
}

export function CircaPoolDeck({night}:{night:boolean}) {
  const parts=useMemo(()=>circaPoolDeckParts(),[]);
  return <group>
    <CircaParts parts={parts} night={night}/>
  </group>;
}

/** One tower's apartment floor, tower-local; the east tower is drawn mirrored by its parent group. */
export function CircaApartments({level,tower="west",night,labels,onPick,residents=[]}:{level:number;tower?:CircaTower;night:boolean;labels:boolean;onPick:(text:string)=>void;residents?:CircaResidentNow[]}) {
  const parts=useMemo(()=>circaApartmentParts(level),[level]);
  const units=circaUnits(level,tower);
  return <group>
    <CircaParts parts={parts} night={night}/>
    {/* Residents are the AI agents whose home card names the apartment; CircaWalkers shows them in it while they're
        home. While one is out (and on the city map instead), the label says where it is. */}
    {units.map(u=>{
      const here=residents.filter(r=>r.home.unit===u.id),who=here.map(r=>r.identity.name).join(" · ");
      const role=here.map(r=>r.state.home?r.identity.role:`Out · ${r.state.note}`).join(" · ");
      return <group key={u.id}>
        {labels&&<Html position={[(u.x0+u.x1)/2,1.9,(u.z0+u.z1)/2]} center><button className="skyline-room-label" onClick={()=>onPick(here.length?`Apartment ${u.id} · ${here.map(r=>`${r.identity.name} · ${r.identity.role} · ${r.state.home?r.state.note:`Out · ${r.state.note}`}`).join(" · ")}`:`Apartment ${u.id} · ${u.label}`)} data-resident={here.length?"":undefined} data-out={here.length&&here.every(r=>!r.state.home)?"":undefined}>{here.map(r=><AgentAvatar key={r.id} identity={r.identity} size={30}/>)}<em>{`Apartment ${u.id}`}<span>{here.length?`${who} · ${role}`:u.beds===2?"2 bed · Available":"1 bed · Available"}</span></em></button></Html>}
      </group>;
    })}
  </group>;
}
