import {Html} from "@react-three/drei";
import {Box} from "./InteriorPrimitives";
import {ElevatorLanding,MovingLift} from "./BuildingCirculation";
import LobbyEntrance from "./LobbyEntrance";
import CircaLobby from "./CircaLobby";
import {CircaApartments,CircaPoolDeck} from "./CircaUpperFloors";
import {CircaWalkers,type CircaResident} from "./CircaWalkers";
import {CIRCA_DOOR_Z,CIRCA_LIFT,CIRCA_PLATE,CIRCA_PODIUM,CIRCA_TOWERS,circaFloorNumber,circaLevelKind} from "./circaFloors";
import {CIRCA_LIFT_OFFSET,CIRCA_LIFT_TOP} from "./circaNav";
import {LAND_BOTTOM,LAND_TOP,type buildScene} from "../map3d/scene";
import type {useMaterials} from "../map3d/models";

/**
 * Circa inside "Enter building": twin oval towers on a rectangular podium, like the exterior.
 * Floors 1 and 2 (lobby and pool deck) span the podium; Floors 3 to 6 are the two towers, side by side. Each tower has
 * its own lift; the east tower is the west one mirrored, so the two lifts meet at the middle of the podium.
 */
const SLAB="#e7dfcf";
/** Lamp strength after dark: brighter than other interiors so the wide podium and both towers read as lit. */
const NIGHT_LAMP=48;
const TOWER_NAME={west:"West",east:"East"} as const;

/** A tower-local group: the west tower as drawn, the east tower mirrored about x. */
function Tower({x,mirror,children}:{x:number;mirror:boolean;children:React.ReactNode}) {
  return <group position={[x,0,0]} scale={[mirror?-1:1,1,1]}>{children}</group>;
}
function OvalSlab(){
  return <mesh position={[0,-0.15,0]} scale={[CIRCA_PLATE.rx,0.3,CIRCA_PLATE.rz]} receiveShadow castShadow><cylinderGeometry args={[1,1,1,72]}/><meshStandardMaterial color={SLAB} roughness={0.65}/></mesh>;
}

/** How far the interior is scaled up from the map (CityOutside: 4 interior units per map unit). */
const MAP_SCALE=4;
/**
 * Circa's own ground, drawn in the city outside (map units, at the building's spot): the interior podium is wider than
 * the parcel on the map, so a block of land runs under it with a paved forecourt around the building, and nothing
 * hangs over the water.
 */
export function CircaSite({scene,m}:{scene:ReturnType<typeof buildScene>;m:ReturnType<typeof useMaterials>}) {
  const b=scene.financial?.buildings.find(x=>x.id==="circa");if(!scene.financial||!b)return null;
  const x=scene.financial.x+b.x,z=scene.financial.z+b.z,w=(CIRCA_PODIUM.w+10)/MAP_SCALE,d=(CIRCA_PODIUM.d+10)/MAP_SCALE;
  return <group position={[x,LAND_TOP,z]}>
    <mesh position={[0,LAND_BOTTOM/2,0]} material={m.land} receiveShadow><boxGeometry args={[w,-LAND_BOTTOM,d]}/></mesh>
    <mesh position={[0,.006,0]} material={m.step} receiveShadow><boxGeometry args={[(CIRCA_PODIUM.w+3)/MAP_SCALE,.012,(CIRCA_PODIUM.d+3)/MAP_SCALE]}/></mesh>
  </group>;
}

/** A soft warm fill after dark, so the rooms between lamps don't fall into shadow. One light for the whole building. */
export function CircaNightFill({night}:{night:boolean}) {
  return night?<ambientLight color="#ffdcae" intensity={0.6}/>:null;
}

/** The two lift cars moving through the stack in the all-floors view. */
export function CircaLifts({reduced}:{reduced:boolean}) {
  return <group>{CIRCA_TOWERS.map(t=><Tower key={t.id} x={t.x} mirror={t.mirror}><MovingLift reduced={reduced} finish={CIRCA_LIFT} top={CIRCA_LIFT_TOP} offset={CIRCA_LIFT_OFFSET[t.id]}/></Tower>)}</group>;
}

/**
 * One Circa floor. `stack` is the all-floors view, where the podium floors keep a single real lamp and each tower floor
 * one per tower, and the emissive cove strips carry the rest of the night glow.
 */
export function CircaLevel({level,stack,labels,night,reduced,residents,onPick,sign}:{level:number;stack:boolean;labels:boolean;night:boolean;reduced:boolean;residents:CircaResident[];onPick:(text:string)=>void;sign:{title:string;subtitle:string}}) {
  const kind=circaLevelKind(level),podium=kind!=="apartments",n=circaFloorNumber(level);
  const lamp=(x:number,key:string|number,distance:number,boost=1)=><pointLight key={key} position={[x,2.9,0]} color="#ffe2a4" intensity={(night?NIGHT_LAMP:5)*boost} distance={distance} decay={2}/>;
  return <group>
    {/* All floors: one lamp across the podium, one per tower above it (10 in all); a single floor gets three or two. */}
    {podium?(stack?lamp(0,"stack",34,2.2):[-12,0,12].map(x=>lamp(x,x,21))):CIRCA_TOWERS.map(t=>lamp(t.x,t.id,21,stack?1.5:1))}
    {podium&&<Box p={[0,-0.15,0]} s={[CIRCA_PODIUM.w,0.3,CIRCA_PODIUM.d]} color={SLAB}/>}
    {CIRCA_TOWERS.map(t=><Tower key={t.id} x={t.x} mirror={t.mirror}>
      {!podium&&<OvalSlab/>}
      {/* The residents ride for real, so the stand-in lift visitor stays off. */}
      <ElevatorLanding level={level} reduced={reduced} labels={labels} visitor={false} runner="#9a9893" edge="#1b1b1d" finish={CIRCA_LIFT} top={CIRCA_LIFT_TOP} offset={CIRCA_LIFT_OFFSET[t.id]}
        name={podium?`${TOWER_NAME[t.id]} tower`:`${TOWER_NAME[t.id]} · Floor ${n}`}/>
      {!podium&&<CircaApartments level={level} tower={t.id} night={night} labels={labels} onPick={onPick}/>}
      {!podium&&<CircaWalkers level={level} tower={t.id} residents={residents} reduced={reduced} onPick={onPick}/>}
    </Tower>)}
    {kind==="lobby"&&<group>
      <CircaLobby night={night}/>
      <LobbyEntrance z={CIRCA_DOOR_Z} width={2.3}/>
      <Box p={[0,0.02,(.5+CIRCA_DOOR_Z)/2]} s={[3,0.03,CIRCA_DOOR_Z-.5]} color="#9a9893"/>
      {labels&&<Html position={[0,2.8,CIRCA_DOOR_Z-.05]} center><span className="skyline-room-label">Main entrance</span></Html>}
      {labels&&<Html position={[0,2.8,-CIRCA_PODIUM.d/2+.3]} center><div className="skyline-wall-sign financial-wall-sign">{sign.title}<span>{sign.subtitle}</span></div></Html>}
    </group>}
    {kind==="pool"&&<CircaPoolDeck night={night}/>}
    {podium&&<CircaWalkers level={level} residents={residents} reduced={reduced} onPick={onPick}/>}
  </group>;
}
