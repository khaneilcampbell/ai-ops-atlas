import {financialInteriorBrand} from '../map3d/financialBrands';
import {buildingDisplayName,currentBuildingName} from "../../modules/names";
import {FINANCIAL_BUILDINGS} from "../map3d/financialPlan";
import {WorkplaceInspector} from './WorkplaceInspector';
import {workplaceAgent} from "../../catalog/workplaces";
import {BUILDING_INTERIORS as BUSINESS} from "../../catalog/buildings";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePageVisible, usePowerProfile } from "../../lib/power";
import { FramePacer } from "../map3d/pacer";
import { Canvas, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Html, OrbitControls } from "@react-three/drei";
import {Box,Person,SeatedPerson,Sofa} from "./InteriorPrimitives";
import {ElevatorLanding,MovingLift} from "./BuildingCirculation";
import { useReducedMotion } from "../../lib/motion";
import FloorLabel from "./FloorLabel";
import LobbyEntrance from "./LobbyEntrance";
import {CircaLevel,CircaLifts,CircaNightFill,CircaSite} from "./CircaBuilding";
import {TowerLevel,TowerLift,TowerSite,useTowerPeople} from "./TowerBuilding";
import {towerRooms,towerSpec} from "./towerPlan";
import {useCircaResidents} from "./CircaWalkers";
import {CIRCA_PODIUM,circaFloorName,circaPickerName} from "./circaFloors";
import {allFloorsPose} from "./interiorPose";
import {toolBrand} from "../map3d/toolBrand";
import CityOutside from "./CityOutside";
import CutawayWall from "./CutawayWall";
import { lookHint, useInteriorTrackpad } from "./useInteriorTrackpad";
import { night as cityNight } from "../map3d/materials";
import { type LightMode } from "../map3d/living";


import {isAiAgent} from "../../catalog/roles";
import { useAtlas } from "../../state";
import { leaveBuilding } from "./store";
import "../../styles/skyline.css";

function ResidenceDetails({x,z}:{x:number;z:number}) {
  return <group>
    {/* Atlas-style cutaway room: full rear wall, low front sill, framed windows. */}
    <Box p={[x,0.44,z-2.25]} s={[7.4,0.88,0.14]} color="#ece5d2"/>
    <Box p={[x,2.57,z-2.25]} s={[7.4,0.26,0.14]} color="#ece5d2"/>
    {[-3.55,-1.15,1.15,3.55].map(dx=><Box key={dx} p={[x+dx,1.65,z-2.25]} s={[0.55,1.6,0.14]} color="#ece5d2"/>)}
    {[-1,1].map(side=><Box key={side} p={[x+side*2.1,0.16,z+2.25]} s={[3.1,0.32,0.12]} color="#ece5d2"/>)}
    <Box p={[x,0.12,z-2.15]} s={[7.4,0.1,0.06]} color="#b99957"/>
    {[-2.3,0,2.3].map(offset=><group key={offset}>
      {[-1,1].map(side=><group key={side}><Box p={[x+offset+side*0.8,1.65,z-2.16]} s={[0.06,1.6,0.08]} color="#1c342b"/><Box p={[x+offset,1.65+side*0.77,z-2.16]} s={[1.65,0.06,0.08]} color="#1c342b"/></group>)}
      <mesh position={[x+offset,1.65,z-2.18]}><boxGeometry args={[1.52,1.48,0.025]}/><meshPhysicalMaterial color="#d4e9e6" transparent opacity={0.12} roughness={0.12} metalness={0.1} depthWrite={false}/></mesh>
      <Box p={[x+offset,1.72,z-2.07]} s={[0.035,1.2,0.03]} color="#35564b"/>
    </group>)}
    <Box p={[x-1.4,0.06,z+0.6]} s={[2.7,0.035,1.8]} color="#294d3d"/>
    <Box p={[x-1.4,0.28,z+1.2]} s={[1.1,0.4,0.55]} color="#b99a60"/>
    {/* Timber workstation with chair, keyboard, monitor stand and task lamp. */}
    {[-1,1].map(side=><Box key={side} p={[x-1.7+side*0.65,0.36,z-1.3]} s={[0.07,0.72,0.5]} color="#3d4e40"/>)}
    <Box p={[x-1.7,0.89,z-1.48]} s={[0.07,0.25,0.07]} color="#233b30"/>
    <Box p={[x-1.7,0.83,z-1.15]} s={[0.52,0.025,0.16]} color="#eee9d8"/>
    <Box p={[x-1.7,1.09,z-1.44]} s={[0.59,0.29,0.025]} color="#9abfa8"/>
    <Box p={[x-1.7,0.38,z-0.6]} s={[0.55,0.15,0.55]} color="#263b2e"/>
    <Box p={[x-1.7,0.78,z-0.33]} s={[0.55,0.7,0.1]} color="#263b2e"/>
    <Box p={[x-2.3,1.02,z-1.35]} s={[0.025,0.38,0.025]} color="#c5a35c"/>
    <Box p={[x-2.3,1.24,z-1.35]} s={[0.24,0.09,0.18]} color="#e8d5a0"/>
    <Box p={[x+3,0.3,z+1.5]} s={[0.5,0.6,0.5]} color="#bfa36c"/>
    <mesh position={[x+3,0.95,z+1.5]}><sphereGeometry args={[0.42,12,12]}/><meshStandardMaterial color="#4b6b3d"/></mesh>
  </group>;
}

function BusinessSuite({x,z,name,accent,bank,labels,hospitality,fashion,residential=false}:{x:number;z:number;name:string;accent:string;bank:boolean;labels:boolean;hospitality:boolean;fashion:boolean;residential?:boolean}) {
  return <group>
    <ResidenceDetails x={x} z={z}/>
    {residential?<group><Box p={[x+1.8,.4,z-.7]} s={[1.7,.6,2]} color="#657c70"/><Box p={[x+1.8,.74,z-1.4]} s={[1.5,.12,.5]} color="#f8f1e2"/><Box p={[x+1.8,.74,z-.35]} s={[1.5,.06,1.15]} color={accent}/></group>:<group>
    <Box p={[x+1.6,0.72,z]} s={[2.3,0.14,1.3]} color={bank?"#ac8854":"#d9c39c"}/>
    {[-1,1].map(side=><group key={side}>
      <Box p={[x+1.6+side*0.75,0.35,z]} s={[0.08,0.7,1]} color="#3b5044"/>
      <Box p={[x+1.6,0.45,z+side*0.95]} s={[0.65,0.16,0.6]} color={accent}/>
      <Box p={[x+1.6,0.8,z+side*1.2]} s={[0.65,0.75,0.1]} color={accent}/>
    </group>)}
    </group>}
    {residential?<group><Box p={[x+3,.25,z-1.5]} s={[.5,.5,.5]} color="#bfa36c"/><mesh position={[x+3,.95,z-1.5]}><sphereGeometry args={[.35,10,8]}/><meshStandardMaterial color="#4b6b3d"/></mesh></group>:hospitality?<group><Box p={[x+2.8,0.48,z-1.5]} s={[1.4,0.95,0.7]} color={accent}/><Box p={[x+2.8,0.98,z-1.5]} s={[1.5,0.08,0.8]} color="#d9d6cc"/></group>:fashion?<group><Box p={[x+2.9,1.1,z-1.5]} s={[1.4,0.06,0.08]} color="#ac935b"/>{[-1,0,1].map(i=><Box key={i} p={[x+2.9+i*0.4,0.8,z-1.5]} s={[0.3,0.6,0.07]} color={["#d9ccaf","#31483c","#a68474"][i+1]}/>)}</group>:bank?<group><Box p={[x+3,0.85,z-1.5]} s={[0.7,1.7,0.6]} color="#5d6966"/><Box p={[x+3,0.9,z-1.16]} s={[0.45,1.2,0.08]} color="#9aa39c"/></group>:<group><Box p={[x+3,1,z-1.5]} s={[0.6,2,0.65]} color="#20372d"/>{[0,1,2,3,4].map(i=><Box key={i} p={[x+3,0.35+i*0.32,z-1.15]} s={[0.4,0.15,0.025]} color={i%2?accent:"#759b89"}/>)}</group>}
    {labels&&<Html position={[x,2.5,z-2]} center><span className="skyline-room-label">{name}</span></Html>}
  </group>;
}
/** Keep the renderer alive when changing floor views; reset only the camera pose. */
/**
 * Where the camera starts. `spread` is how much wider the building is than the standard 16 × 12 floor: Circa's twin
 * towers on their podium (1.75) and the other Financial District buildings (1.25) stand further back.
 */
function cameraPose(allFloors:boolean,maxFloor:number,spread:number){
  const pose=allFloorsPose(maxFloor);
  return {position:(allFloors?pose.position:[14,14,18]).map(v=>v*spread) as [number,number,number],target:allFloors?pose.target:0};
}
function SkylineCamera({allFloors,floor,maxFloor,spread=1}:{allFloors:boolean;floor:number;maxFloor:number;spread?:number}) {
  const controls=useRef<OrbitControlsImpl>(null);
  const {camera,invalidate}=useThree();
  // Refresh once after the new floor commits, including when Battery saver stops the frame loop.
  useEffect(()=>{const frame=requestAnimationFrame(()=>invalidate());return()=>cancelAnimationFrame(frame);},[floor,invalidate]);
  useLayoutEffect(()=>{
    const pose=cameraPose(allFloors,maxFloor,spread);
    camera.position.set(...pose.position);
    const target=controls.current?.target;
    if(target){target.set(0,pose.target,0);camera.lookAt(target);controls.current?.update();}
    invalidate();
  },[allFloors,camera,invalidate,maxFloor,spread]);
  useInteriorTrackpad(()=>controls.current,spread>1?{x:8*spread*1.6,z:6*spread}:{x:8,z:6});
  return <OrbitControls ref={controls} makeDefault minDistance={10} maxDistance={60*spread} maxPolarAngle={Math.PI/2.3}/>;
}
export default function SkylineInterior({building,light,maxFloor=4}:{building:string;light:LightMode;maxFloor?:number}) {
  const identity=financialInteriorBrand(building),displayName=identity?.name??building,shownName=identity?buildingDisplayName(`service:financial:${identity.id}`,displayName):currentBuildingName(displayName),circa=identity?.id==="circa",homes=circa,residential=homes||identity?.id==="harbor-residence";
  const [floor,setFloor]=useState(-1);
  // The Financial District interiors (Circa and the others) have walking residents and staff, so they animate.
  const tower=towerSpec(building),spread=circa?1.75:tower?1.25:1;
  const reduced=useReducedMotion()||building==="Atlas Hills"||(!circa&&!tower&&(!!identity||FINANCIAL_BUILDINGS.some(b=>b.name===building)));
  const power=usePowerProfile(),visible=usePageVisible();
  const business:{accent:string;subtitle:string;rooms:string[]}|undefined=BUSINESS[building]??{accent:toolBrand(building).primary,subtitle:"SERVICE & PLATFORM OPERATIONS",rooms:["Operations studio","Integration workspace","Quality review","Planning & coordination"]};
  const brandedFinancial=!!identity;
  const isNight=light==="night";
  const circaStack=circa&&floor===-1;
  useEffect(()=>{cityNight.value=isNight?1:0;},[isNight]);
  const [picked,setPicked]=useState<string|null>(null);
  const [pickedAgent,setPickedAgent]=useState<string|null>(null);
  const {catalog}=useAtlas();
  const agents=catalog.agents.filter(a=>isAiAgent(a)&&!a.workplace);
  const assigned=catalog.agents.filter(a=>a.workplace?.building===building);
  const residents=useCircaResidents(circa?catalog.agents.filter(isAiAgent):[]);
  const people=useTowerPeople(tower,catalog.agents.filter(isAiAgent));
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.stopPropagation();leaveBuilding(true);}};window.addEventListener("keydown",close,true);return()=>window.removeEventListener("keydown",close,true);},[]);
  return <section className={`skyline-interior ${isNight?"night":"day"}`} aria-label={`${shownName} interior`}>
    <Canvas style={{position:"absolute",inset:0,zIndex:0}} frameloop={visible ? "demand" : "never"} dpr={[1,power.maxDpr]} shadows camera={{position:cameraPose(floor===-1,maxFloor,spread).position,fov:42}}><FramePacer profile={power} running={!reduced}/><color attach="background" args={[isNight?"#101b2c":"#dbe2d8"]}/><ambientLight color={isNight?"#c1cfed":"#ffffff"} intensity={isNight?0.3:0.8}/><hemisphereLight args={[isNight?"#91abdc":"#eef6ff",isNight?"#303e35":"#8c7e64",isNight?0.45:1.3]}/><directionalLight color={isNight?"#99b8ed":"#fff4da"} position={[5,14,8]} intensity={isNight?0.35:2} castShadow shadow-mapSize={[2048,2048]}/><SkylineCamera allFloors={floor===-1} floor={floor} maxFloor={maxFloor} spread={spread}/>
      <CityOutside allFloors={floor===-1} building={building} elevation={floor>0?floor*4:0} {...(circa?{clearSpan:CIRCA_PODIUM.w,extras:c=><CircaSite {...c}/>}:tower?{clearSpan:tower.w,extras:c=><TowerSite spec={tower} {...c}/>}:{})}/>
      {floor===-1&&(circa?<CircaLifts reduced={reduced}/>:tower?<TowerLift spec={tower} reduced={reduced}/>:<MovingLift reduced={reduced}/>)}
      {(circa||tower)&&<CircaNightFill night={isNight}/>}
      {circa||tower?null:<group><Box p={[0,-0.15,0]} s={[16,0.3,12]} color="#e7dfcf"/><CutawayWall side="left"><Box p={[-8,1.7,0]} s={[0.16,3.4,12]} color="#d0c5ad"/></CutawayWall>
      {[...Array(9)].map((_,i)=><Box key={i} p={[-8+i*2,0.015,0]} s={[0.014,0.015,12]} color="#c9b992"/>)}</group>}
      {(floor===-1?Array.from({length:maxFloor+1},(_,i)=>i):[floor]).map(level=><group key={level} position={[0,floor===-1?level*4:0,0]}>
      {circa?<group>
        <FloorLabel level={level} width={CIRCA_PODIUM.w} depth={CIRCA_PODIUM.d} name={circaFloorName(level)}/>
        <CircaLevel level={level} stack={circaStack} labels={floor!==-1} night={isNight} reduced={reduced} residents={residents} onPick={setPicked} sign={{title:displayName.toUpperCase(),subtitle:business?.subtitle??"PRIVATE RESIDENCES"}}/>
      </group>:tower?<group>
        <FloorLabel level={level} width={tower.w} depth={tower.d}/>
        <TowerLevel spec={tower} level={level} stack={floor===-1} labels={floor!==-1} night={isNight} reduced={reduced} people={people} onPick={setPicked}/>
      </group>:<group>
      {floor===-1&&level>0&&<group><Box p={[0,-0.15,0]} s={[16,0.3,12]} color="#e7dfcf"/></group>}
      <FloorLabel level={level} width={16} depth={12}/>
      <group>
        <pointLight position={[0,2.9,0]} color="#ffe2a4" intensity={isNight?28:5} distance={15} decay={2}/>
        {[-4,4].map(x=><group key={x}><pointLight position={[x,2.7,-2]} color="#ffebc4" intensity={isNight?18:3} distance={10} decay={2}/><mesh position={[x,2.85,-2]}><boxGeometry args={[1.4,0.06,0.55]}/><meshStandardMaterial color="#eee4cb" emissive="#ffe0a0" emissiveIntensity={isNight?2:0.2}/></mesh></group>)}
      </group>
      <ElevatorLanding level={level} reduced={reduced} labels={floor!==-1}/>
      {level===0 ? <group>
        {business&&!brandedFinancial&&<group>{building==="Halden Branch"?<group>
          {[-1.5,0,1.5].map(x=><group key={x}><Box p={[x,1.46,-3]} s={[0.65,0.38,0.08]} color="#344a41"/><Box p={[x+0.6,1.65,-3]} s={[0.04,0.8,0.65]} color="#b99957"/></group>)}
          <Box p={[-6.5,1,-4]} s={[1,2,0.7]} color="#a71d30"/><Box p={[-6.5,1.25,-3.62]} s={[0.65,0.5,0.05]} color="#a9c8c3"/>
        </group>:<group><Box p={[-5.8,1.5,-5.6]} s={[3,1.7,0.15]} color="#223d32"/><Html position={[-5.8,1.6,-5.45]} center><span className="skyline-room-label">{business.subtitle}</span></Html></group>}</group>}
        <group><Box p={[0,0.6,-3]} s={[5,1.2,1.1]} color={business?.accent??"#234b3c"}/><Box p={[0,1.23,-3]} s={[5.2,0.1,1.25]} color="#c9a35a"/><Box p={[0,1.5,-3.3]} s={[0.7,0.4,0.06]} color="#172a25"/><Person x={0} z={-4.1} color="#344c41"/></group>
        {floor!==-1&&<Html position={[0,2.8,-5.8]} center><div className={`skyline-wall-sign${brandedFinancial?" financial-wall-sign":""}`}>{displayName.toUpperCase()}<span>{business?.subtitle??"PRIVATE RESIDENCES"}</span></div></Html>}
        {identity?.id==="residence"&&[-6,6].map(x=><group key={x}><Box p={[x,.3,-1.5]} s={[.8,.6,.8]} color="#e9dfca"/><mesh position={[x,1.2,-1.5]}><sphereGeometry args={[.5,10,8]}/><meshStandardMaterial color="#4b6b3d"/></mesh></group>)}
        {<group><Sofa x={-4.5} z={1}/><Sofa x={4.5} z={1}/>{[-4.5,4.5].map(x=><group key={x}><Box p={[x,0.35,2.6]} s={[1.4,0.6,0.8]} color="#b89859"/><Person x={x+0.3} z={0.5} color="#5e796a"/></group>)}</group>}
        <LobbyEntrance z={5.85} width={2.3}/>{floor!==-1&&<Html position={[0,2.8,5.8]} center><span className="skyline-room-label">Main entrance</span></Html>}
        <Box p={[0,0.02,3]} s={[3,0.03,5]} color="#315c49"/>
      </group> : <group>
        <Box p={[0,0.02,0]} s={[16,0.035,2]} color="#315c49"/>
        {[-1,1].flatMap(side=>[-1,1].map((row,index)=>{
          const slot=(level-1)*4+(side===-1?0:2)+index;
          const suite=business?.rooms[((level-1)+index+(side===1?2:0))%4];
          const x=side*4,z=row*3.5, room=`${level}0${(side===-1?0:2)+index+1}`;
          const agent=workplaceAgent(assigned,building,level,room)??(business?undefined:agents[slot]);
          return <group key={room} onClick={event=>{if(agent?.workplace){event.stopPropagation();setPickedAgent(agent.id);}}}>
            {business?<BusinessSuite x={x} z={z} name={suite!} accent={business.accent} residential={residential} bank={["Halden Branch","Halden Trust","Bayvale Bank","Merrow Credit Union"].includes(displayName)} hospitality={["Starbucks","Smashburger","Chipotle"].includes(building)} fashion={building==="Zara"} labels={false}/>:<ResidenceDetails x={x} z={z}/>}
            <Box p={[x,0.06,row*1.1]} s={[0.85,0.04,0.6]} color="#bca371"/>
            <Box p={[x,0.025,z]} s={[7.4,0.04,4.6]} color={row===-1?"#eee4d0":"#ded9cc"}/><Box p={[side*0.15,0.65,z]} s={[0.12,1.3,4.7]} color="#c9bea5"/>
            {!business&&<group><Box p={[x+1.8,0.4,z-0.7]} s={[1.7,0.6,2]} color="#657c70"/><Box p={[x+1.8,0.74,z-1.4]} s={[1.5,0.12,0.5]} color="#f8f1e2"/></group>}
            <Sofa x={x-1.4} z={z+0.5}/><Box p={[x-1.7,0.75,z-1.3]} s={[1.7,0.12,0.7]} color="#b89760"/><Box p={[x-1.7,1.08,z-1.48]} s={[0.7,0.42,0.06]} color="#203c32"/>{agent?.workplace?<group><Box p={[x-1.7,.45,z-.6]} s={[.5,.12,.5]} color="#294237"/><Box p={[x-1.7,.76,z-.35]} s={[.5,.65,.08]} color="#294237"/><SeatedPerson x={x-1.7} z={z-.6} color={["#806c9e","#496e84","#b58b49","#5a8067"][slot%4]}/></group>:!business&&<Person x={x-1.7} z={z-.6} color="#5a8067"/>}
            {(floor!==-1||agent?.workplace)&&<Html position={[x,1.85,z]} center><button className="skyline-room-label" onClick={()=>{setPicked(`${room} · ${agent?.name??suite??"Available residence"}`);setPickedAgent(agent?.workplace?agent.id:null);}}>{`${residential&&homes?"Apartment":business?"Suite":"Apartment"} ${room}`}<span>{agent?.name??suite??"Available residence"}</span></button></Html>}
          </group>;
        }))}
      </group>}
      </group>}
      </group>)}
      {!circa&&[-7,7].map(x=><group key={x}><Box p={[x,0.35,-5]} s={[0.6,0.7,0.6]} color="#b49a67"/><mesh position={[x,1.2,-5]}><sphereGeometry args={[0.55,12,12]}/><meshStandardMaterial color="#426844"/></mesh></group>)}
    </Canvas>
    <header className="skyline-interior-head"><button onClick={()=>leaveBuilding(true)}aria-label={`Exit ${shownName} and return to city`}>← Exit building</button><div><small>{shownName.toUpperCase()} · {business?.subtitle??"PRIVATE RESIDENCES"}</small><h2>{floor===-1?"All floors · Open cutaway":circa?circaFloorName(floor):floor===0?"Grand lobby":`Floor ${floor} · ${residential?(homes?"Residences":"Guest suites"):business?"Workspaces":"Agent residences"}`}</h2></div></header>
    <nav className="skyline-floor-picker" aria-label={`Choose ${shownName} floor`}><strong>Floor navigation</strong>{[-1,...Array.from({length:maxFloor},(_,i)=>maxFloor-i),0].map(n=><button key={n} aria-pressed={floor===n} onClick={()=>{setFloor(n);setPicked(null);setPickedAgent(null);}}>{n===-1?"All floors":circa?circaPickerName(n):n===0?"Lobby":`Floor ${n}`}</button>)}</nav>
    {assigned.find(a=>a.id===pickedAgent)&&<WorkplaceInspector agent={assigned.find(a=>a.id===pickedAgent)!} onClose={()=>setPickedAgent(null)}/>}
    <aside className="skyline-interior-note">{picked??(tower?(floor===-1?`Lobby + ${maxFloor} floors · ${lookHint()}`:floor===0?"Front desk · Lounge · Seating · Lift":towerRooms(tower,floor).map(r=>r.name).join(" · ")):circa&&floor===0?"Front desk · Lounges · Parcel lockers · Work table · Both towers' lifts":circa?(floor===-1?`Twin towers on a podium · Lobby, pool deck + ${maxFloor-1} residential floors · ${lookHint()}`:floor===1?"Round pool · Lap pool · Cabanas · Spa · Fire pit · Sun lawn":"Two towers · 2 two-bedroom + 4 one-bedroom apartments · Select a residence"):floor===-1?`Lobby + ${maxFloor} ${residential?"residential":business?"workspace":"apartment"} ${maxFloor===1?"floor":"floors"} · ${lookHint()}`:floor===0?"Front desk · Lounge · Elevators":business?(assigned.length?`${assigned.length} assigned worker · Select a suite to see its role`:"Prepared workspaces · No agents assigned yet"):"4 furnished apartments · Select a residence")}<span>{tower?`${tower.program==="hotel"?"Hotel":"Workplace"} visualization · Agent placement does not indicate live activity`:business&&!circa?(assigned.length?"Automatic reports are model-free · Codex reviews run only on request":"Workspace preview · No workers assigned"):"Residential visualization · Agent placement does not indicate live activity"}</span></aside>
  </section>;
}
