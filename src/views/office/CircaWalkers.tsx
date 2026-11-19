import {useEffect,useMemo,useRef,useState} from "react";
import {useFrame} from "@react-three/fiber";
import type * as THREE from "three";
import {Box} from "./InteriorPrimitives";
import {walkerAt} from "./circaNav";
import type {CircaTower} from "./circaFloors";
import {circaResidents,homeLoop,homeStateAt,nightLoop,bedroomOf,livingOf,type CircaResident,type HomeState} from "./circaHomes";
import type {Day} from "./walkNav";
import type {AgentJob} from "../../catalog/agentJobs";
import {cityFigureFor,type CityFigure} from "../../registry/cityFigures";
import {useRoutines} from "../../routine/useRoutineOps";
import {useTimeZone} from "../../lib/timezone";

/** A resident as drawn now: who, in what look, home or out (from its own day), and its loop while home. */
export type CircaResidentNow=CircaResident&{figure:CityFigure|null;state:HomeState;day:Day|null};

/**
 * The agents who live in Ellipse Residences, each in its own apartment, home or out by the same day the city draws
 * (circaHomes.ts). Re-checked every 20 s, so one who comes home appears without leaving the building.
 */
export function useCircaResidents(jobs:readonly AgentJob[]):CircaResidentNow[]{
  const routines=useRoutines(),tz=useTimeZone();
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),20_000);return()=>window.clearInterval(id);},[]);
  const residents=useMemo(()=>circaResidents(jobs,id=>!!cityFigureFor(id)),[jobs]);
  // Loops depend only on the apartment, so they're built once per resident; each starts a few seconds apart.
  const loops=useMemo(()=>new Map(residents.map((r,i)=>[r.id,{home:homeLoop(r,i*7.3),night:nightLoop(r)}])),[residents]);
  return useMemo(()=>residents.map(r=>{
    const state=homeStateAt(r.id,routines.get(r.id),now,tz),loop=loops.get(r.id)!;
    return {...r,figure:cityFigureFor(r.id),state,day:state.home?(state.night?loop.night:loop.home):null};
  }),[residents,loops,routines,now,tz]);
}

/** A standing figure in the agent's own city look (cityFigures.ts), at the scale of the residence's furniture. */
function ResidentFigure({figure}:{figure:CityFigure|null}){
  const f=figure,top=f?(f.jacket??f.top):"#5a8067",h=f?.build.height??1,w=f?.build.shoulders??1;
  // A little larger than the stand-ins it replaces, with a gold marker overhead so it's found in the open cutaway.
  return <group scale={[1.2*w,1.2*h,1.2*w]}>
    <mesh position={[0,1.75,0]} rotation={[0,Math.PI/4,0]} scale={[.2,.28,.2]}><octahedronGeometry args={[1,0]}/><meshBasicMaterial color="#e4be62" toneMapped={false}/></mesh>
    {[-1,1].map(k=><Box key={k} p={[k*.075,.2,0]} s={[.11,.4,.12]} color={f?.trousers??"#294237"}/>)}
    {[-1,1].map(k=><Box key={k} p={[k*.075,.03,.03]} s={[.12,.06,.18]} color={f?.shoes??"#2a2522"}/>)}
    <mesh position={[0,.63,0]} castShadow><cylinderGeometry args={[.16,.17,.5,12]}/><meshStandardMaterial color={top}/></mesh>
    {f?.jacket&&<Box p={[0,.66,.155]} s={[.1,.4,.02]} color={f.top}/>}
    {[-1,1].map(k=><Box key={k} p={[k*.2,.62,0]} s={[.07,.42,.08]} color={top}/>)}
    <mesh position={[0,1.07,0]} castShadow><sphereGeometry args={[.17,16,12]}/><meshStandardMaterial color={f?.skin??"#c79875"}/></mesh>
    {f&&f.hair.style!=="bald"&&<mesh position={[0,1.12,-.02]} scale={[1.04,.8,1.04]}><sphereGeometry args={[.17,16,12]}/><meshStandardMaterial color={f.hair.color}/></mesh>}
    {f?.glasses&&<Box p={[0,1.08,.16]} s={[.2,.045,.02]} color={f.glasses}/>}
  </group>;
}

/**
 * The residents on one level: the podium (no `tower`) or one tower's floor. Each one home walks its own loop: its
 * rooms, and one ride to the pool deck or the lobby on the lifts' clock, hidden while it rides. At night it stays in
 * its bedroom. With reduced motion it stands still in its living room (its bedroom at night). Residents who are out
 * aren't drawn; their apartment label says where they are.
 */
export function CircaWalkers({level,tower,residents,reduced,onPick}:{level:number;tower?:CircaTower;residents:CircaResidentNow[];reduced:boolean;onPick?:(text:string)=>void}) {
  const refs=useRef<(THREE.Group|null)[]>([]);
  useFrame(state=>{
    if(reduced)return;
    const t=state.clock.elapsedTime;
    residents.forEach((r,i)=>{
      const g=refs.current[i];if(!g)return;
      if(!r.day){g.visible=false;return;}
      const w=walkerAt(r.day,t);
      g.visible=w.level===level&&w.frame===tower&&!w.hidden;
      if(g.visible){g.position.set(w.x,0.03,w.z);g.rotation.y=w.heading;}
    });
  });
  return <group>{residents.map((r,i)=>{
    const spot=r.state.home&&r.state.night?bedroomOf(r.home):livingOf(r.home);
    const still=reduced&&r.state.home&&r.home.level===level&&r.home.tower===tower;
    return <group key={r.id} ref={el=>{refs.current[i]=el;}} visible={still} position={still?[spot.x,0.03,spot.z]:[0,0,0]}
      onClick={e=>{e.stopPropagation();onPick?.(`${r.name} · Apartment ${r.home.unit} · ${r.state.note}`);}}>
      <ResidentFigure figure={r.figure}/>
    </group>;
  })}</group>;
}
