import {CIRCA_DOOR_Z,CIRCA_PLATE,CIRCA_PODIUM,circaLevelKind,circaUnits,mirrorX,onCircaPlate,onCircaPodium,towerToPodium,CIRCA_UPPER_LEVELS,type CircaLevel,type CircaTower} from "./circaFloors";
import {circaApartmentParts,circaLobbyParts,circaPoolDeckParts} from "./circaInteriorParts";
import {LIFT_STOP_SECONDS} from "./circulation";
import {DayBuilder,LIFT_CAR,LIFT_STOP,LIFT_WALLS,WALK,buildGrid,findPath,placeLiftWalls,rotate,stop,type Circle,type Day,type Grid,type Lift,type Path,type Rect,type Stop} from "./walkNav";

export {LIFT_CAR,LIFT_STOP,WALK,clearLine,pathLength,snap,walkerAt,type Grid,type Leg,type Path,type Stop} from "./walkNav";

/**
 * Walking routes inside Circa, on the shared walking engine (walkNav). The lobby and pool deck grids cover the
 * rectangular podium, in podium coordinates, with both towers' lifts at the middle. The apartment grid covers one oval
 * tower in tower-local coordinates; the east tower is the same plan drawn mirrored, so one grid serves both. Agents
 * walk between named stops: every room of every apartment, the lobby's desk, lounges, lockers and work table, and the
 * pool deck's amenities.
 */

/** Lobby furniture drawn in CircaLobby.tsx; keep in step with it. */
const LOBBY_RECTS:Rect[]=[
  {x:3.6,z:-2.5,w:3,d:1},                                      // reception desk
  {x:-5.75,z:3,w:1.05,d:.9},{x:-3.45,z:3,w:1.05,d:.9},{x:-4.6,z:3,w:.9,d:.6}, // west lounge chairs and glass table
  {x:4.4,z:4.25,w:2.4,d:1.2},{x:4.4,z:3.2,w:1.2,d:.6},          // east lounge sofa and table
  {x:3.75,z:2.12,w:.7,d:.8},{x:5.05,z:2.12,w:.7,d:.8},          // cognac chairs
  {x:-1.22,z:CIRCA_DOOR_Z,w:.12,d:.15},{x:1.22,z:CIRCA_DOOR_Z,w:.12,d:.15}, // street door posts
];
const LOBBY_CIRCLES:Circle[]=[
  {x:-3.6,z:-3.9,rad:.4},{x:3.6,z:-3.9,rad:.4},{x:-3,z:-2.3,rad:.75},{x:3.6,z:-3.2,rad:.2},
  {x:6.6,z:4.3,rad:.25},{x:-5.2,z:5.2,rad:.35},{x:5.2,z:5.2,rad:.35},
];
/** The two people who stay put on the pool deck (CircaUpperFloors). */
export const POOL_PEOPLE:[number,number][]=[[-8.5,3],[8.5,-3]];
const POOL_CIRCLES:Circle[]=POOL_PEOPLE.map(([x,z])=>({x,z,rad:.2}));
/** Both towers' lift landings, placed on the podium. */
const PODIUM_LIFT_WALLS:Rect[]=(["west","east"] as const).flatMap(t=>placeLiftWalls((x,z)=>towerToPodium(t,x,z)));

/** The same two lift points for a tower's lift, on the podium. */
export const podiumLift=(tower:CircaTower)=>{const [sx,sz]=towerToPodium(tower,LIFT_STOP.x,LIFT_STOP.z),[cx,cz]=towerToPodium(tower,LIFT_CAR.x,LIFT_CAR.z);return {stop:stop("lift",`${tower} lift`,sx,sz),car:stop("car",`${tower} lift car`,cx,cz)};};

/** Rooms of each apartment, in the order a resident walks them. Unit 03 mirrors 02 about the party wall. */
const ONE_BED=[stop("door","Front door",-1.72,1),stop("kitchen","Kitchen",-3.9,1.9),stop("bath","Bathroom",-6.8,2.05),stop("bedroom","Bedroom",-5.7,4),stop("living","Living room",-2.2,4),stop("dining","Dining",-1.9,3)];
const TWO_BED=[stop("door","Front door",.65,-1),stop("kitchen","Kitchen",-1.6,-1.89),stop("dining","Dining",-3.4,-3.4),stop("master","Main bedroom",-4.25,-3.5),stop("master-bath","Main bathroom",-6.9,-1.89),stop("living","Living room",.7,-3.7),stop("bedroom","Second bedroom",4,-4.4),stop("bath","Second bathroom",6,-1.88)];
export function unitStops(suffix:string):Stop[]{
  if(suffix==="01")return TWO_BED;
  if(suffix==="02")return ONE_BED;
  return ONE_BED.map(s=>({...s,x:mirrorX(s.x)}));
}
export const LOBBY_STOPS=[stop("desk","Front desk",3.6,-1.55),stop("lockers","Parcel lockers",-13,-6.7),stop("residents-lounge","Residents' lounge",-15.6,4.6),stop("lounge-west","West lounge",-4.6,1.95),stop("entrance","Main entrance",0,7.6),stop("lounge-east","East lounge",4.4,1.25),stop("reading","Reading corner",13,3),stop("work-table","Work table",13,-3.2)];
export const POOL_STOPS=[stop("poolside","Pool",0,2.1),stop("cabana","Cabanas",13,3.9),stop("spa","Spa",13,-2.9),stop("lap-pool","Lap pool",0,-4.3),stop("sun-lawn","Sun lawn",-13,-3),stop("fire-pit","Fire pit",-13,2.7)];

const PODIUM_PLATE={hx:CIRCA_PODIUM.w/2,hz:CIRCA_PODIUM.d/2,inside:onCircaPodium};
const TOWER_PLATE={hx:CIRCA_PLATE.rx,hz:CIRCA_PLATE.rz,inside:onCircaPlate};
const grids=new Map<CircaLevel,Grid>();
export function circaGrid(kind:CircaLevel):Grid{
  let g=grids.get(kind);
  if(!g){g=kind==="lobby"?buildGrid(circaLobbyParts(),PODIUM_PLATE,[...PODIUM_LIFT_WALLS,...LOBBY_RECTS],LOBBY_CIRCLES):kind==="pool"?buildGrid(circaPoolDeckParts(),PODIUM_PLATE,PODIUM_LIFT_WALLS,POOL_CIRCLES):buildGrid(circaApartmentParts(2),TOWER_PLATE,LIFT_WALLS,[]);grids.set(kind,g);}
  return g;
}
const paths=new Map<string,Path|null>();
/** A smoothed walk from one point to another on a floor kind, as corner points; null when no way through. Memoized. */
export function circaPath(kind:CircaLevel,from:{x:number;z:number},to:{x:number;z:number}):Path|null{
  const key=`${kind}:${from.x},${from.z}>${to.x},${to.z}`;
  if(!paths.has(key))paths.set(key,findPath(circaGrid(kind),from,to));
  return paths.get(key)!;
}

/** Circa's two lifts run the shared timeline to the top floor; the east car runs half a cycle behind. */
export const CIRCA_LIFT_TOP=CIRCA_UPPER_LEVELS;
export const CIRCA_LIFT_OFFSET:Record<CircaTower,number>={west:0,east:CIRCA_UPPER_LEVELS*LIFT_STOP_SECONDS};
export const circaLift=(tower:CircaTower):Lift=>({top:CIRCA_LIFT_TOP,offset:CIRCA_LIFT_OFFSET[tower]});

/** A looping day plus the apartment it starts and ends in. Legs on apartment floors carry the tower as `frame`. */
export type Itinerary=Day&{home:{level:number;tower:CircaTower;unit:string;layout:"01"|"02"|"03"}};

/** The twenty-four apartments, Floors 3 to 6, west tower then east tower on each floor. */
export function circaApartments(){
  const out:{level:number;tower:CircaTower;unit:string;layout:"01"|"02"|"03"}[]=[];
  for(let level=2;level<=CIRCA_UPPER_LEVELS;level++)for(const tower of ["west","east"] as const)for(const u of circaUnits(level,tower))out.push({level,tower,unit:u.id,layout:u.layout});
  return out;
}

export const ENTRANCE_STOP=stop("entrance","Main entrance",0,CIRCA_DOOR_Z-.7);
/** How long an agent lingers: longer in the living room and bedroom, a short look elsewhere. */
const linger=(s:Stop)=>s.id==="living"||s.id==="bedroom"||s.id==="master"?7:s.id==="door"?.8:WALK.dwell+1;

/**
 * An agent's day inside Circa, timed to the real lifts:
 * 1. It comes in the front door, walks to its tower's lift and waits until the car opens at the lobby, steps in,
 *    rides (hidden) until the car opens at its floor, steps out and walks to its apartment.
 * 2. It moves between some of its rooms, then makes two outings by lift: one to the pool deck and one to the lobby
 *    (which comes first varies by agent), visiting a few amenities each time and coming home in between.
 * 3. It ends the day leaving through the front door, and is out of the building until its loop starts again.
 * Every room of its apartment is visited during the day. `start` spreads agents across the lift cycle.
 */
export function circaItinerary(homeIndex:number,start=0):Itinerary{
  const apts=circaApartments(),home=apts[((homeIndex%apts.length)+apts.length)%apts.length],seed=Math.abs(homeIndex);
  const apartments=(l:number)=>circaLevelKind(l)==="apartments";
  const day=new DayBuilder({
    path:(l,a,b)=>circaPath(circaLevelKind(l),a,b),
    lift:circaLift(home.tower),
    landing:l=>apartments(l)?{stop:LIFT_STOP,car:LIFT_CAR}:podiumLift(home.tower),
    frame:l=>apartments(l)?home.tower:undefined,
  },start,0,ENTRANCE_STOP);
  const plan=unitStops(home.layout),rooms=rotate(plan.filter(s=>s.id!=="door"&&s.id!=="living"),seed),door=plan[0];
  const living=plan.find(s=>s.id==="living")!,third=Math.ceil(rooms.length/3);
  const lobby=rotate(LOBBY_STOPS.filter(s=>s.id!=="entrance"),seed).slice(0,3),pool=rotate(POOL_STOPS,seed).slice(0,3);
  // Arrive and settle in.
  day.stay(1.2).ride(home.level).visit([door,...rooms.slice(0,third),living],linger);
  // Two outings by lift, in an order that varies by agent, with time at home in between.
  const outings:[number,Stop[]][]=seed%2?[[1,pool],[0,lobby]]:[[0,lobby],[1,pool]];
  outings.forEach(([to,stops],i)=>{day.ride(to).visit(stops,linger).ride(home.level).visit([door,...rooms.slice((i+1)*third,(i+2)*third),living],linger);});
  // Leave through the front door; out of the building until the loop comes round, on a whole lift cycle.
  day.ride(0).walk(ENTRANCE_STOP);
  return {...day.leave(),home};
}
