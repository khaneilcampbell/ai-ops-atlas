import {DayBuilder,LIFT_CAR,LIFT_STOP,LIFT_WALLS,buildGrid,findPath,rectPlate,rotate,type Day,type Grid,type Lift,type Path,type Stop} from "./walkNav";
import {TOWER_FLOORS,lobbyStops,roomStops,towerDoorZ,towerRooms,type TowerSpec} from "./towerPlan";
import {towerFloorParts,towerLobbyParts} from "./towerParts";

/**
 * Walking inside the Financial District interiors, on the shared walking engine. One walk grid per building and floor
 * (rooms differ by floor), built from the floor's own part lists plus the lift landing and the street door posts.
 * The building's single lift runs the shared timeline from the lobby to the top floor.
 */
export const towerLift=(spec:TowerSpec):Lift=>({top:TOWER_FLOORS,offset:(spec.id.length*7)%16});

const grids=new Map<string,Grid>();
export function towerGrid(spec:TowerSpec,level:number):Grid{
  const key=`${spec.key}:${level}`;let g=grids.get(key);
  if(!g){
    const door=towerDoorZ(spec);
    g=level===0?buildGrid(towerLobbyParts(spec),rectPlate(spec.w,spec.d),[...LIFT_WALLS,{x:-1.22,z:door,w:.12,d:.15},{x:1.22,z:door,w:.12,d:.15}],[])
      :buildGrid(towerFloorParts(spec,level),rectPlate(spec.w,spec.d),LIFT_WALLS,[]);
    grids.set(key,g);
  }
  return g;
}
const paths=new Map<string,Path|null>();
export function towerPath(spec:TowerSpec,level:number,from:{x:number;z:number},to:{x:number;z:number}):Path|null{
  const key=`${spec.key}:${level}:${from.x},${from.z}>${to.x},${to.z}`;
  if(!paths.has(key))paths.set(key,findPath(towerGrid(spec,level),from,to));
  return paths.get(key)!;
}

/** Every stop on a floor: the rooms' stops on upper floors, the lobby's on the ground floor. */
export const floorStops=(spec:TowerSpec,level:number):Stop[]=>level===0?lobbyStops(spec):towerRooms(spec,level).flatMap(roomStops);

/** Someone who works (or, at the hotel, stays) in the building: their floor and room. */
export type TowerDay=Day&{floor:number;room:string;roomName:string};

/**
 * A working day timed to the building's lift: in through the street door, wait for the lift, ride to their floor and
 * settle at their own room; drop into another room on the floor (a meeting, a colleague); a break in the lobby; back to
 * their room; a visit to a room on another floor; back again; then home through the front door. Guests at the hotel
 * do the same with their suite. `index` picks the floor and room, `start` staggers arrivals.
 */
export function towerDay(spec:TowerSpec,index:number,start=0):TowerDay{
  const floor=1+index%TOWER_FLOORS,rooms=towerRooms(spec,floor),mine=rooms[Math.floor(index/TOWER_FLOORS)%rooms.length];
  const other=rooms[(rooms.indexOf(mine)+1+index%3)%rooms.length],elsewhere=1+(floor+index%(TOWER_FLOORS-1))%TOWER_FLOORS;
  const away=towerRooms(spec,elsewhere)[index%4];
  const entrance=lobbyStops(spec).find(s=>s.id==="entrance")!,lobby=rotate(lobbyStops(spec).filter(s=>s.id!=="entrance"),index).slice(0,2);
  const day=new DayBuilder({path:(l,a,b)=>towerPath(spec,l,a,b),lift:towerLift(spec),landing:()=>({stop:LIFT_STOP,car:LIFT_CAR})},start,0,entrance);
  const home=roomStops(mine),settle=(s:Stop)=>s.id==="inside"?.6:9;
  day.stay(1.2).ride(floor).visit(home,settle)
    .visit(roomStops(other).slice(0,2),s=>s.id==="inside"?.6:6).visit(home.slice(0,2),settle)
    .ride(0).visit(lobby,()=>5).ride(floor).visit(home.slice(0,2),settle)
    .ride(elsewhere).visit(roomStops(away).slice(0,2),s=>s.id==="inside"?.6:6).ride(floor).visit(home.slice(0,2),settle)
    .ride(0).walk(entrance);
  return {...day.leave(),floor,room:mine.id,roomName:mine.name};
}
