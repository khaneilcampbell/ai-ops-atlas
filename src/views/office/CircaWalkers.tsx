import {useMemo,useRef} from "react";
import {useFrame} from "@react-three/fiber";
import type * as THREE from "three";
import {Person} from "./InteriorPrimitives";
import {circaItinerary,unitStops,walkerAt,type Itinerary} from "./circaNav";
import type {CircaTower} from "./circaFloors";

/** The AI agents who live in Circa, each with a looping day inside the building. */
export type CircaResident={id:string;name:string;color:string;itinerary:Itinerary};

const COLORS=["#806c9e","#496e84","#b58b49","#5a8067","#8a5a4a","#4f6f8f","#9a7b3c","#6b5a86"];

/** Agents sorted by id take the twenty-four apartments in turn; their days start a few seconds apart. */
export function useCircaResidents(agents:{id:string;name:string}[]):CircaResident[]{
  // Keyed on ids and names, so a fresh agents array with the same people keeps the same residents.
  const key=agents.map(a=>`${a.id}\u0000${a.name}`).sort().join("\u0001");
  return useMemo(()=>key?key.split("\u0001").map((entry,i)=>{
    const [id,name]=entry.split("\u0000");
    return {id,name,color:COLORS[i%COLORS.length],itinerary:circaItinerary(i,i*11.3)};
  }):[],[key]);
}

/**
 * The residents on one level: the podium (no `tower`) or one tower's floor. Each walks its route while its day is
 * there, waits at the lift, hides while it rides and steps out when the car opens on its floor. The clock is the same
 * one the lifts run on, so riders board and leave with the doors. With reduced motion everyone stays home in their
 * living room.
 */
export function CircaWalkers({level,tower,residents,reduced,onPick}:{level:number;tower?:CircaTower;residents:CircaResident[];reduced:boolean;onPick?:(text:string)=>void}) {
  const refs=useRef<(THREE.Group|null)[]>([]);
  useFrame(state=>{
    if(reduced)return;
    const t=state.clock.elapsedTime;
    residents.forEach((r,i)=>{
      const g=refs.current[i];if(!g)return;
      const w=walkerAt(r.itinerary,t);
      g.visible=w.level===level&&w.frame===tower&&!w.hidden;
      if(g.visible){g.position.set(w.x,0.03,w.z);g.rotation.y=w.heading;}
    });
  });
  return <group>{residents.map((r,i)=>{
    const home=r.itinerary.home,living=unitStops(home.layout).find(s=>s.id==="living")!;
    const still=reduced&&home.level===level&&home.tower===tower;
    return <group key={r.id} ref={el=>{refs.current[i]=el;}} visible={still} position={still?[living.x,0.03,living.z]:[0,0,0]}
      onClick={e=>{e.stopPropagation();onPick?.(`${r.name} · Apartment ${home.unit}`);}}>
      <Person x={0} z={0} color={r.color}/>
    </group>;
  })}</group>;
}
