import {useMemo,useRef} from "react";
import {useFrame} from "@react-three/fiber";
import type * as THREE from "three";
import {Person} from "./InteriorPrimitives";
import {circaItinerary,unitStops,walkerAt,type Itinerary} from "./circaNav";

/** The AI agents who live in Circa, each with a looping day inside the building. */
export type CircaResident={id:string;name:string;color:string;itinerary:Itinerary;offset:number};

const COLORS=["#806c9e","#496e84","#b58b49","#5a8067","#8a5a4a","#4f6f8f","#9a7b3c","#6b5a86"];

/** Agents sorted by id take the twelve apartments in turn; their days start spread around the loop. */
export function useCircaResidents(agents:{id:string;name:string}[]):CircaResident[]{
  // Keyed on ids and names, so a fresh agents array with the same people keeps the same residents.
  const key=agents.map(a=>`${a.id}\u0000${a.name}`).sort().join("\u0001");
  return useMemo(()=>key?key.split("\u0001").map((entry,i)=>{
    const [id,name]=entry.split("\u0000"),itinerary=circaItinerary(i);
    return {id,name,color:COLORS[i%COLORS.length],itinerary,offset:(i*.618034%1)*itinerary.period};
  }):[],[key]);
}

/**
 * The residents on one level. Each walks its route while its day is on this level, hides while it rides the lift
 * and appears on the next floor. With reduced motion everyone stays home in their living room.
 */
export function CircaWalkers({level,residents,reduced,onPick}:{level:number;residents:CircaResident[];reduced:boolean;onPick?:(text:string)=>void}) {
  const refs=useRef<(THREE.Group|null)[]>([]);
  useFrame(state=>{
    if(reduced)return;
    const t=state.clock.elapsedTime;
    residents.forEach((r,i)=>{
      const g=refs.current[i];if(!g)return;
      const w=walkerAt(r.itinerary,t+r.offset);
      g.visible=w.level===level&&!w.riding;
      if(g.visible){g.position.set(w.x,0.03,w.z);g.rotation.y=w.heading;}
    });
  });
  return <group>{residents.map((r,i)=>{
    const home=r.itinerary.home,living=unitStops(home.unit.slice(-2)).find(s=>s.id==="living")!;
    const still=reduced&&home.level===level;
    return <group key={r.id} ref={el=>{refs.current[i]=el;}} visible={still} position={still?[living.x,0.03,living.z]:[0,0,0]}
      onClick={e=>{e.stopPropagation();onPick?.(`${r.name} · Apartment ${home.unit}`);}}>
      <Person x={0} z={0} color={r.color}/>
    </group>;
  })}</group>;
}
