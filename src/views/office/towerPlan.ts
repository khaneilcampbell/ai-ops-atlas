import {financialInteriorBrand} from "../map3d/financialBrands";
import {financialDimensions} from "../map3d/financialArchitecture";
import {stop,type Stop} from "./walkNav";

/**
 * The Financial District's other buildings inside "Enter building", in Circa's style: square floor plates in the
 * proportions of each exterior, floor-to-ceiling glass all round, walnut, marble, oak and black furniture, and agents
 * who walk the building on the real lift. BMW and Circa keep their own interiors.
 *
 * Plan (the same frame on every floor): x across the building, z from the back (-) to the street (+). The lift landing
 * is at the east end (x ≈ 7.2..9.8, z 0). Upper floors have a corridor along z 0 to the lift with four rooms off it,
 * two each side; the lobby is one open room with the street door at +z.
 */
export type TowerProgram="office"|"hotel";
export type TowerSpec={key:string;id:string;name:string;w:number;d:number;program:TowerProgram;accent:string;subtitle:string;rooms:string[]};
/** Plate width on every building; depth follows the exterior's footprint. */
export const TOWER_W=22;
/** Upper floors, above the lobby. */
export const TOWER_FLOORS=4;
export const TOWER_CORRIDOR=1,TOWER_SPLIT=-2,TOWER_ROOMS_EAST=6.5,TOWER_DOOR=.55;

/** The interior plan for a Financial District building, or undefined for Circa and anything outside the district. */
export function towerSpec(building:string):TowerSpec|undefined{
  const brand=financialInteriorBrand(building);
  if(!brand||brand.id==="circa")return undefined;
  const dims=financialDimensions(brand.id);
  return {key:building,id:brand.id,name:brand.name,w:TOWER_W,d:Math.round(TOWER_W*dims.depth/dims.width),
    program:brand.architecture==="hotel"?"hotel":"office",accent:brand.accent??"#84b8bf",subtitle:brand.subtitle,rooms:[...brand.rooms]};
}

export type RoomKind="reception"|"workspace"|"meeting"|"private"|"suite";
/** What a room's name says it is used for. */
export function roomKind(name:string):RoomKind{
  if(/reception|welcome/i.test(name))return "reception";
  if(/private|advisory|consultation|executive/i.test(name))return "private";
  if(/planning|meeting|lounge|scenario/i.test(name))return "meeting";
  return "workspace";
}

/** A room off the corridor: `side` -1 is the back (z < 0), +1 the street side. Room-local u runs along x from x0, v away from the corridor. */
export type TowerRoom={id:string;name:string;kind:RoomKind;x0:number;x1:number;side:-1|1;depth:number;door:[number,number]};

export function towerRooms(spec:TowerSpec,level:number):TowerRoom[]{
  if(level<1)return [];
  const depth=spec.d/2-TOWER_CORRIDOR,spans:[number,number][]=[[-spec.w/2,TOWER_SPLIT],[TOWER_SPLIT,TOWER_ROOMS_EAST]];
  return ([-1,1] as const).flatMap((side,si)=>spans.map(([x0,x1],xi)=>{
    const i=si*2+xi,id=`${level}0${i+1}`,cx=(x0+x1)/2;
    const name=spec.program==="hotel"?`Suite ${id}`:spec.rooms[(level-1+i)%spec.rooms.length];
    return {id,name,kind:spec.program==="hotel"?"suite":roomKind(name),x0,x1,side,depth,door:[cx-TOWER_DOOR,cx+TOWER_DOOR] as [number,number]};
  }));
}
/** A room-local point (u along x from the room's west wall, v away from the corridor) in the floor's frame. */
export const roomPoint=(r:TowerRoom,u:number,v:number):[number,number]=>[r.x0+u,r.side*(TOWER_CORRIDOR+v)];

/** Where someone stands in a room, in the order they're visited. The first is just inside the door. */
export function roomStops(r:TowerRoom):Stop[]{
  const W=r.x1-r.x0,D=r.depth,at=(id:string,label:string,u:number,v:number)=>{const [x,z]=roomPoint(r,u,v);return stop(id,`${label} · ${r.name}`,x,z);};
  const inside=at("inside","Door",W/2,.55);
  switch(r.kind){
    case "reception":return [inside,at("desk","Front desk",W/2,D*.62-1.05),at("waiting","Waiting chairs",W*.18+.5,D*.3+.85)];
    case "workspace":return [inside,at("workstation","Workstation",W*.35,3.25),at("window","Window desks",W*.65,D-.7)];
    case "meeting":return [inside,at("table","Meeting table",W/2,D/2-1.45)];
    case "private":return [inside,at("desk","Desk",W*.6,D*.62-1.45),at("sofa","Sofa",W-1.6,D*.35)];
    case "suite":return [inside,at("bath","Bathroom",1.2,1.2),at("bed","Bed",W*.4+1.1,D-2.1),at("lounge","Sofa",W-1.8,D*.45),at("desk","Desk",W*.78,1.3)];
  }
}

/** The lobby's stops, by plate depth. */
export function lobbyStops(spec:TowerSpec):Stop[]{
  const d=spec.d;
  return [stop("desk","Front desk",-1.5,-d/2+3.7),stop("lounge-west","Lounge",-6.4,.1),stop("lounge-east","Seating",3,2.2),stop("entrance","Main entrance",0,d/2-.8)];
}
export const towerDoorZ=(spec:TowerSpec)=>spec.d/2-.1;
