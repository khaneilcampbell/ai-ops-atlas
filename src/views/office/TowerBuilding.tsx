import {useMemo,useRef} from "react";
import {useFrame} from "@react-three/fiber";
import {Html} from "@react-three/drei";
import type * as THREE from "three";
import {Box,Person} from "./InteriorPrimitives";
import {ElevatorLanding,MovingLift} from "./BuildingCirculation";
import LobbyEntrance from "./LobbyEntrance";
import {CircaParts} from "./CircaUpperFloors";
import type {LiftFinish} from "./BuildingCirculation";
import {TOWER_FLOORS,towerDoorZ,towerRooms,roomPoint,type TowerSpec} from "./towerPlan";
import {towerFloorParts,towerLobbyParts} from "./towerParts";
import {towerDay,towerLift,type TowerDay} from "./towerNav";
import {walkerAt} from "./walkNav";
import {LAND_BOTTOM,LAND_TOP,type buildScene} from "../map3d/scene";
import type {useMaterials} from "../map3d/models";

/**
 * A Financial District building inside "Enter building" (see towerPlan): the lobby and four floors of rooms, glass all
 * round, furnished in the building's brand colours, and people who walk in, ride the lift and work their floors.
 */
const SLAB="#e7dfcf",NIGHT_LAMP=44;
const COLORS=["#806c9e","#496e84","#b58b49","#5a8067","#8a5a4a","#4f6f8f","#9a7b3c","#6b5a86"];
/** People per building: two for each floor. */
export const TOWER_PEOPLE=TOWER_FLOORS*2;

export type TowerPerson={id:string;name:string;color:string;day:TowerDay};
/** The agents seen in a building: a different run of the AI agents for each building, each with their own day. */
export function useTowerPeople(spec:TowerSpec|undefined,agents:{id:string;name:string}[]):TowerPerson[]{
  const key=spec?`${spec.key}|${agents.map(a=>`${a.id}\u0000${a.name}`).sort().join("\u0001")}`:"";
  return useMemo(()=>{
    if(!spec||!key)return [];
    const list=key.split("|")[1].split("\u0001").filter(Boolean).map(e=>{const [id,name]=e.split("\u0000");return {id,name};});
    if(!list.length)return [];
    const shift=[...spec.id].reduce((n,c)=>n+c.charCodeAt(0),0);
    return Array.from({length:Math.min(TOWER_PEOPLE,list.length)},(_,i)=>{const a=list[(shift+i*3)%list.length];return {id:`${a.id}-${i}`,name:a.name,color:COLORS[(shift+i)%COLORS.length],day:towerDay(spec,i,i*9.7)};});
  },[key,spec]);
}

/** The people on one level, walking on the lift's clock. With reduced motion each stands at their own room. */
function TowerWalkers({level,people,reduced,spec,onPick}:{level:number;people:TowerPerson[];reduced:boolean;spec:TowerSpec;onPick:(text:string)=>void}) {
  const refs=useRef<(THREE.Group|null)[]>([]);
  useFrame(state=>{
    if(reduced)return;
    people.forEach((p,i)=>{const g=refs.current[i];if(!g)return;const w=walkerAt(p.day,state.clock.elapsedTime);
      g.visible=w.level===level&&!w.hidden;if(g.visible){g.position.set(w.x,.03,w.z);g.rotation.y=w.heading;}});
  });
  return <group>{people.map((p,i)=>{
    const room=towerRooms(spec,p.day.floor).find(r=>r.id===p.day.room)!,[sx,sz]=roomPoint(room,(room.x1-room.x0)/2,1.6),still=reduced&&p.day.floor===level;
    return <group key={p.id} ref={el=>{refs.current[i]=el;}} visible={still} position={still?[sx,.03,sz]:[0,0,0]}
      onClick={e=>{e.stopPropagation();onPick(`${p.name} · ${p.day.roomName}, Floor ${p.day.floor}`);}}><Person x={0} z={0} color={p.color}/></group>;
  })}</group>;
}

/** The lift in the building's brand colours: brand walls, deep frames and doors, a glowing call button. */
const liftFinish=(spec:TowerSpec):LiftFinish=>({pad:"#a6a49f",back:spec.theme.primary,sides:spec.theme.deep,trim:spec.theme.deep,doors:spec.theme.deep,button:spec.theme.highlight,car:"#f3efe8",carWall:spec.theme.primary});

/** The lift car moving through the stack in the all-floors view. */
export function TowerLift({spec,reduced}:{spec:TowerSpec;reduced:boolean}) {
  const l=towerLift(spec);return <MovingLift reduced={reduced} finish={liftFinish(spec)} top={l.top} offset={l.offset}/>;
}

/**
 * One floor. In the all-floors view (`stack`) each floor keeps a single lamp; a single floor gets two. Emissive cove
 * strips under the glass and a warm fill carry the rest of the night glow.
 */
export function TowerLevel({spec,level,stack,labels,night,reduced,people,onPick}:{spec:TowerSpec;level:number;stack:boolean;labels:boolean;night:boolean;reduced:boolean;people:TowerPerson[];onPick:(text:string)=>void}) {
  const parts=useMemo(()=>level?towerFloorParts(spec,level):towerLobbyParts(spec),[spec,level]),l=towerLift(spec);
  const lamp=(x:number,k:string|number,boost=1)=><pointLight key={k} position={[x,2.9,0]} color="#ffe2a4" intensity={(night?NIGHT_LAMP:5)*boost} distance={20} decay={2}/>;
  return <group>
    {stack?lamp(0,"stack",1.6):[-5,4].map(x=>lamp(x,x))}
    <Box p={[0,-0.15,0]} s={[spec.w,0.3,spec.d]} color={SLAB}/>
    <CircaParts parts={parts} night={night}/>
    <ElevatorLanding level={level} reduced={reduced} labels={labels} visitor={false} runner="#9a9893" edge="#1b1b1d" finish={liftFinish(spec)} top={l.top} offset={l.offset} name={level===0?"Lobby":`Floor ${level}`}/>
    {level===0&&<group>
      <LobbyEntrance z={towerDoorZ(spec)} width={2.3}/>
      {labels&&<Html position={[0,2.8,towerDoorZ(spec)-.05]} center><span className="skyline-room-label">Main entrance</span></Html>}
      {labels&&<Html position={[-1.5,2.8,-spec.d/2+.3]} center><div className="skyline-wall-sign financial-wall-sign">{spec.name.toUpperCase()}<span>{spec.subtitle}</span></div></Html>}
    </group>}
    {labels&&level>0&&towerRooms(spec,level).map(r=>{const [x,z]=roomPoint(r,(r.x1-r.x0)/2,r.depth/2);return <Html key={r.id} position={[x,1.9,z]} center>
      <button className="skyline-room-label" onClick={()=>onPick(`${spec.program==="hotel"?r.name:`Suite ${r.id} · ${r.name}`}`)}>{spec.program==="hotel"?r.name:`Suite ${r.id}`}<span>{spec.program==="hotel"?"Guest suite":r.name}</span></button></Html>;})}
    <TowerWalkers level={level} people={people} reduced={reduced} spec={spec} onPick={onPick}/>
  </group>;
}

/** The ground around the building in the city outside (map units): land under the whole plate and a paved forecourt, on the map's ground plane (LAND_TOP). */
export function TowerSite({spec,scene,m}:{spec:TowerSpec;scene:ReturnType<typeof buildScene>;m:ReturnType<typeof useMaterials>}) {
  const b=scene.financial?.buildings.find(x=>x.id===spec.id);if(!scene.financial||!b)return null;
  const S=4,x=scene.financial.x+b.x,z=scene.financial.z+b.z;
  return <group position={[x,LAND_TOP,z]}>
    <mesh position={[0,LAND_BOTTOM/2,0]} material={m.land} receiveShadow><boxGeometry args={[(spec.w+8)/S,-LAND_BOTTOM,(spec.d+8)/S]}/></mesh>
    <mesh position={[0,.006,0]} material={m.step} receiveShadow><boxGeometry args={[(spec.w+3)/S,.012,(spec.d+3)/S]}/></mesh>
  </group>;
}
