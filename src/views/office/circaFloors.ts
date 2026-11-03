import {financialInteriorBrand} from "../map3d/financialBrands";
import type {LiftFinish} from "./BuildingCirculation";

/**
 * Circa's floors inside "Enter building", numbered like a real building:
 * Floor 1 is the lobby, Floor 2 the outdoor pool deck on the podium roof, Floors 3 to 6 apartments.
 * `level` is the 0-based stack index used by SkylineInterior (0 = lobby).
 */
export type CircaLevel="lobby"|"pool"|"apartments";
/** Levels above the lobby: the pool deck plus four apartment floors (six floors in total). */
export const CIRCA_UPPER_LEVELS=5;

export function isCirca(building:string){return financialInteriorBrand(building)?.id==="circa";}

/** How many levels sit above the lobby when a building is entered. Everything except Circa keeps its old value. */
export function interiorFloors(projectId:string){
  if(projectId==="skyline-business:Atlas Hills")return 1;
  if(projectId.startsWith("skyline-business:")&&isCirca(projectId.slice(17)))return CIRCA_UPPER_LEVELS;
  return 4;
}

export function circaLevelKind(level:number):CircaLevel{return level<=0?"lobby":level===1?"pool":"apartments";}
export function circaFloorNumber(level:number){return level+1;}
export function circaFloorName(level:number){
  const kind=circaLevelKind(level),n=circaFloorNumber(level);
  return kind==="lobby"?`Floor ${n} · Lobby`:kind==="pool"?`Floor ${n} · Pool deck`:`Floor ${n} · Residences`;
}

/** Shorter names for the floor picker, so it fits beside the header on a phone. */
export function circaPickerName(level:number){const kind=circaLevelKind(level),n=circaFloorNumber(level);return kind==='lobby'?`Floor ${n} · Lobby`:kind==='pool'?`Floor ${n} · Pool`:`Floor ${n}`;}

export type CircaUnit={
  /** Apartment number, e.g. "301". */
  id:string;
  beds:1|2;
  /** Short honest description, no rent or availability. */
  label:string;
  /** Unit footprint on the shared 16 × 12 grid (x -8..8, z -6..6); the outer edge is the plate's curved glass. */
  x0:number;x1:number;z0:number;z1:number;
  /** Door gap in the corridor wall, as an x range. */
  door:[number,number];
  /** Mirrored copy of the west 1 bed layout. */
  mirror:boolean;
};

/** Shared corridor from the units to the lift at the east end (the lift walk runs along z 0). */
export const CIRCA_CORRIDOR={z0:-1,z1:1};
/** East edge of the units; the lift landing sits beyond it at x ≈ 7.2..9.8. */
export const CIRCA_UNITS_EAST=6.5;
/** Shared wall between the two 1 bed units; the east unit mirrors the west one about it. */
export const CIRCA_PARTY_WALL=-.75;

/** Mirror an x coordinate from the west 1 bed unit into the east one. */
export const mirrorX=(x:number)=>2*CIRCA_PARTY_WALL-x;

export function circaUnits(level:number):CircaUnit[]{
  if(circaLevelKind(level)!=="apartments")return [];
  const n=circaFloorNumber(level),C=CIRCA_CORRIDOR,westDoor:[number,number]=[-2.1,-1.35];
  return [
    {id:`${n}01`,beds:2,label:"2 bed · 2 bath · curved glass",x0:-8,x1:CIRCA_UNITS_EAST,z0:-6,z1:C.z0,door:[.2,1.1],mirror:false},
    {id:`${n}02`,beds:1,label:"1 bed · 1 bath",x0:-8,x1:CIRCA_PARTY_WALL,z0:C.z1,z1:6,door:westDoor,mirror:false},
    {id:`${n}03`,beds:1,label:"1 bed · 1 bath",x0:CIRCA_PARTY_WALL,x1:CIRCA_UNITS_EAST,z0:C.z1,z1:6,door:[mirrorX(westDoor[1]),mirrorX(westDoor[0])],mirror:true},
  ];
}

/**
 * Every Circa floor is an oval, like the elliptical towers outside: x radius `rx`, z radius `rz`, centred on the origin.
 * It holds the shared 16 × 12 layout plus the lift landing at x ≈ 7.2..9.8; the street door sits on the rim at +z.
 */
export const CIRCA_PLATE={rx:10.2,rz:7.4};
/** Half-width of the oval at depth z, and half-depth at x (0 beyond the rim). */
export const circaEdgeX=(z:number)=>CIRCA_PLATE.rx*Math.sqrt(Math.max(0,1-(z/CIRCA_PLATE.rz)**2));
export const circaEdgeZ=(x:number)=>CIRCA_PLATE.rz*Math.sqrt(Math.max(0,1-(x/CIRCA_PLATE.rx)**2));
/** True when (x, z) lies on the plate, at least `margin` inside the rim. */
export const onCircaPlate=(x:number,z:number,margin=0)=>(x/(CIRCA_PLATE.rx-margin))**2+(z/(CIRCA_PLATE.rz-margin))**2<=1;
/** Where the lobby's street door meets the rim. */
export const CIRCA_DOOR_Z=CIRCA_PLATE.rz-.1;

export type RimSegment={x:number;z:number;xa:number;za:number;len:number;r:number};
/** The rim as `n` straight segments, `inset` inside the edge. `r` turns a box whose length runs along x onto the segment. */
export function circaRim(n:number,inset=0):RimSegment[]{
  const rx=CIRCA_PLATE.rx-inset,rz=CIRCA_PLATE.rz-inset,out:RimSegment[]=[];
  for(let i=0;i<n;i++){
    const t0=i/n*Math.PI*2,t1=(i+1)/n*Math.PI*2,xa=rx*Math.cos(t0),za=rz*Math.sin(t0),xb=rx*Math.cos(t1),zb=rz*Math.sin(t1);
    out.push({x:(xa+xb)/2,z:(za+zb)/2,xa,za,len:Math.hypot(xb-xa,zb-za),r:-Math.atan2(zb-za,xb-xa)});
  }
  return out;
}

/** The 2 bed's floor-to-ceiling glass is the plate's own curved rim on the north side. */
export function circaFacadeZ(x:number){return -circaEdgeZ(x)+.08;}

/** Circa's lift in its lobby palette: walnut walls, black frames, dark bronze doors, a marble car floor. */
export const CIRCA_LIFT:LiftFinish={pad:"#a6a49f",back:"#5b3a26",sides:"#76503a",trim:"#1b1b1d",doors:"#3d3b38",button:"#fff1d6",car:"#f3efe8",carWall:"#5b3a26"};
