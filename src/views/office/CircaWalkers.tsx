import {useMemo} from "react";
import {Html} from "@react-three/drei";
import {Box} from "./InteriorPrimitives";
import type {CircaTower} from "./circaFloors";
import {circaResidents,livingOf,type CircaResident} from "./circaHomes";
import type {AgentJob} from "../../catalog/agentJobs";
import {catalog} from "../../catalog";
import {cityFigureFor,type CityFigure} from "../../registry/cityFigures";
import {identityFor,type ResolvedIdentity} from "../../registry/identity";
import {AgentAvatar} from "../../components/AgentIdentity";

/** A resident as drawn: who, in its own city look and its own portrait and persona name. */
export type CircaResidentNow=CircaResident&{figure:CityFigure|null;identity:ResolvedIdentity};

/**
 * The agents who live in Team Residence Towers, each in the apartment its home card names (Khaneil, 2026-11-19:
 * "agents are not showing when i go inside building ... no loop just have them show"). Their day already runs on the
 * city map, so inside they don't walk a second loop: each one is simply shown in its own living room.
 */
export function useCircaResidents(jobs:readonly AgentJob[]):CircaResidentNow[]{
  return useMemo(()=>circaResidents(jobs,id=>!!cityFigureFor(id)).map(r=>({...r,figure:cityFigureFor(r.id),identity:identityFor(r.id,catalog.agents,r.name)})),[jobs]);
}

/** A standing figure in the agent's own city look (cityFigures.ts), at the scale of the residence's furniture. */
function ResidentFigure({figure}:{figure:CityFigure|null}){
  const f=figure,top=f?(f.jacket??f.top):"#5a8067",h=f?.build.height??1,w=f?.build.shoulders??1;
  return <group scale={[1.2*w,1.2*h,1.2*w]}>
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

/** Residents who live on this level, in this tower. The podium (lobby, pool deck) has none: nobody lives there. */
export function residentsOn(residents:readonly CircaResidentNow[],level:number,tower?:CircaTower){
  return residents.filter(r=>r.home.level===level&&r.home.tower===tower);
}

/**
 * The residents on one tower floor, each standing in its own living room facing the open side, with its portrait and
 * persona name overhead in the all-floors view (the same portraits as the Agents tab); on a single floor the
 * apartment label carries the portrait instead, so the two don't overlap. Selecting one says who it is and where.
 */
export function CircaWalkers({level,tower,residents,chips=true,onPick}:{level:number;tower?:CircaTower;residents:CircaResidentNow[];chips?:boolean;onPick?:(text:string)=>void}) {
  const here=residentsOn(residents,level,tower);
  return <group>{here.map(r=>{
    const spot=livingOf(r.home),who=`${r.identity.name} · ${r.identity.role} · Apartment ${r.home.unit}`;
    return <group key={r.id} position={[spot.x,0.03,spot.z]} onClick={e=>{e.stopPropagation();onPick?.(who);}}>
      <ResidentFigure figure={r.figure}/>
      {chips&&<Html position={[0,2.05,0]} center zIndexRange={[40,30]}>
        <button className="circa-resident-chip" onClick={()=>onPick?.(who)} aria-label={`${r.identity.name}, ${r.identity.role}, AI agent, apartment ${r.home.unit}`}>
          <AgentAvatar identity={r.identity} size={26}/><b>{r.identity.name.split(" ")[0]}</b>
        </button>
      </Html>}
    </group>;
  })}</group>;
}
