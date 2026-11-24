import {useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import * as THREE from "three";
import {Html} from "@react-three/drei";
import {figureParts,partMatrix,poseBones,RIG} from "../map3d/agentFigures";
import type {CircaTower} from "./circaFloors";
import {bedroomOf,circaResidents,homeStateAt,livingOf,type CircaResident,type HomeState} from "./circaHomes";
import {useRoutines} from "../../routine/useRoutineOps";
import {useTimeZone} from "../../lib/timezone";
import type {AgentJob} from "../../catalog/agentJobs";
import {catalog} from "../../catalog";
import {cityFigureFor,type CityFigure} from "../../registry/cityFigures";
import {identityFor,type ResolvedIdentity} from "../../registry/identity";
import {AgentAvatar} from "../../components/AgentIdentity";

/** A resident as drawn: who, in its own city look, portrait and persona name, and whether its day has it home now. */
export type CircaResidentNow=CircaResident&{figure:CityFigure|null;identity:ResolvedIdentity;state:HomeState};

/**
 * The agents who live in Team Residence Towers, each in the apartment its home card names, home or out by the same
 * day the city map draws (circaHomes.ts homeStateAt), so each one is in one place at a time. Re-checked every 20 s,
 * so one who comes home appears without leaving the building.
 */
export function useCircaResidents(jobs:readonly AgentJob[]):CircaResidentNow[]{
  const routines=useRoutines(),tz=useTimeZone();
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),20_000);return()=>window.clearInterval(id);},[]);
  const residents=useMemo(()=>circaResidents(jobs,id=>!!cityFigureFor(id)).map(r=>({...r,figure:cityFigureFor(r.id),identity:identityFor(r.id,catalog.agents,r.name)})),[jobs]);
  return useMemo(()=>residents.map(r=>({...r,state:homeStateAt(r.id,routines.get(r.id),now,tz)})),[residents,routines,now,tz]);
}

/** The residence draws the city rig at furniture scale: the same height the residents stood at before, about 1.5. */
const RESIDENT_HEIGHT=1.5;
/** Only if a resident somehow has no city look: residents are chosen from agents that have one (useCircaResidents). */
const FALLBACK_FIGURE:CityFigure={skin:"#c79875",hair:{style:"short",color:"#2b211b"},top:"#5a8067",trousers:"#294237",shoes:"#2a2522",build:{height:1,shoulders:1}};
const SHARED={box:new THREE.BoxGeometry(1,1,1),ball:new THREE.SphereGeometry(1,12,8),mat:new THREE.MeshStandardMaterial({roughness:.78,metalness:0})};

/**
 * A standing figure in the agent's own city look, built from the very same parts as its character on the city map
 * (agentFigures.ts: hair style, glasses, beard, jacket, collar), so it looks the same inside as outside (Khaneil,
 * 2026-11-19: "agents should look like same like they did on the outside of the map"). Two draw calls per resident.
 */
function ResidentFigure({figure}:{figure:CityFigure|null}){
  const f=figure??FALLBACK_FIGURE;
  const parts=useMemo(()=>figureParts(f),[f]);
  const boxes=useMemo(()=>parts.filter(p=>p.shape==="box"),[parts]),balls=useMemo(()=>parts.filter(p=>p.shape==="ball"),[parts]);
  const boxRef=useRef<THREE.InstancedMesh>(null),ballRef=useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(()=>{
    const scale=RESIDENT_HEIGHT/RIG.top*f.build.height;
    const bones=poseBones({x:0,y:0,z:0,yaw:0,swing:0,look:0,sway:0,scale},f.build.shoulders,[]);
    const m=new THREE.Matrix4(),c=new THREE.Color();
    for(const [ref,list] of [[boxRef,boxes],[ballRef,balls]] as const){
      const mesh=ref.current;if(!mesh)continue;
      list.forEach((p,k)=>{mesh.setMatrixAt(k,partMatrix(bones,p,m));mesh.setColorAt(k,c.set(p.c));});
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
      mesh.computeBoundingSphere();
    }
  },[f,boxes,balls]);
  return <group>
    <instancedMesh ref={boxRef} args={[SHARED.box,SHARED.mat,boxes.length]} castShadow/>
    <instancedMesh ref={ballRef} args={[SHARED.ball,SHARED.mat,balls.length]} castShadow/>
  </group>;
}

/** Residents who live on this level, in this tower. The podium (lobby, pool deck) has none: nobody lives there. */
export function residentsOn(residents:readonly CircaResidentNow[],level:number,tower?:CircaTower){
  return residents.filter(r=>r.home.level===level&&r.home.tower===tower);
}

/** Residents drawn inside on this level: only those home now. The rest are out on the city map. */
export function residentsHomeOn(residents:readonly CircaResidentNow[],level:number,tower?:CircaTower){
  return residentsOn(residents,level,tower).filter(r=>r.state.home);
}

/**
 * The residents home now on one tower floor, each standing in its own living room (its bedroom at night), with its portrait and
 * persona name overhead in the all-floors view (the same portraits as the Agents tab); on a single floor the
 * apartment label carries the portrait instead, so the two don't overlap. Selecting one says who it is and where.
 */
export function CircaWalkers({level,tower,residents,chips=true,onPick,onSuite}:{level:number;tower?:CircaTower;residents:CircaResidentNow[];chips?:boolean;onPick?:(text:string)=>void;onSuite?:(unit:string)=>void}) {
  const here=residentsHomeOn(residents,level,tower);
  return <group>{here.map(r=>{
    const spot=r.state.home&&r.state.night?bedroomOf(r.home):livingOf(r.home),who=`${r.identity.name} · ${r.identity.role} · Apartment ${r.home.unit} · ${r.state.note}`;
    return <group key={r.id} position={[spot.x,0.03,spot.z]} onClick={e=>{e.stopPropagation();onPick?.(who);onSuite?.(r.home.unit);}}>
      <ResidentFigure figure={r.figure}/>
      {chips&&<Html position={[0,2.05,0]} center zIndexRange={[40,30]}>
        <button className="circa-resident-chip" onClick={()=>{onPick?.(who);onSuite?.(r.home.unit);}} aria-label={`${r.identity.name}, ${r.identity.role}, AI agent, apartment ${r.home.unit}`}>
          <AgentAvatar identity={r.identity} size={26}/><b>{r.identity.name.split(" ")[0]}</b>
        </button>
      </Html>}
    </group>;
  })}</group>;
}
