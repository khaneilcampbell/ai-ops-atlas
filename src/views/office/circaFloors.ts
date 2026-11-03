import {financialInteriorBrand} from "../map3d/financialBrands";

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

/**
 * Floors 3 to 6 are oval like the towers on the map: one elliptical plate with curved glass all the way round.
 * The ellipse is centred east of the plate's middle so the lift shaft at the east end (x ≈ 7.2..9.8) sits inside
 * the glass, while the west tip stays on the podium's edge (x -8). Floors 1 and 2 stay rectangular like the podium.
 */
export const CIRCA_PLATE={cx:1.1,rx:9.1,rz:6};
/** 0 at the centre, 1 on the glass line. */
export function circaPlateReach(x:number,z:number){const P=CIRCA_PLATE;return ((x-P.cx)/P.rx)**2+(z/P.rz)**2;}
/** Distance from the centre line to the glass at x: the glass runs along z = ±circaEdgeZ(x). */
export function circaEdgeZ(x:number){const P=CIRCA_PLATE,t=(x-P.cx)/P.rx;return P.rz*Math.sqrt(Math.max(0,1-t*t));}
/** Points round the glass line, counter-clockwise from the east tip. */
export function circaEllipse(steps:number):[number,number][]{const P=CIRCA_PLATE;return Array.from({length:steps},(_,i)=>{const a=i*Math.PI*2/steps;return [P.cx+P.rx*Math.cos(a),P.rz*Math.sin(a)];});}

export type CircaUnit={
  /** Apartment number, e.g. "301". */
  id:string;
  beds:1|2;
  /** Short honest description, no rent or availability. */
  label:string;
  /** Bounding box of the unit; the curved glass trims its outer side. */
  x0:number;x1:number;z0:number;z1:number;
  /** Door gap in the corridor wall, as an x range. */
  door:[number,number];
  /** Mirrored copy of the west 1 bed layout. */
  mirror:boolean;
};

/** Shared corridor from the stair at the west tip to the lift at the east tip (the lift walk runs along z 0). */
export const CIRCA_CORRIDOR={z0:-1,z1:1};
/** West end of the corridor: the fire stair fills the west tip beyond it. */
export const CIRCA_STAIR_EAST=-4.4;
/** West end of the corridor's north wall, where it meets the glass. */
export const CIRCA_NORTH_WEST=-7.3;
/** East edge of the units; the lift landing sits beyond it at x ≈ 7.2..9.8. */
export const CIRCA_UNITS_EAST=6.6;
/** Shared wall between the two 1 bed units, on the ellipse's centre line, so the mirrored copy fits the curve exactly. */
export const CIRCA_PARTY_WALL=CIRCA_PLATE.cx;

/** Mirror an x coordinate from the west 1 bed unit into the east one. */
export const mirrorX=(x:number)=>2*CIRCA_PARTY_WALL-x;

export function circaUnits(level:number):CircaUnit[]{
  if(circaLevelKind(level)!=="apartments")return [];
  const n=circaFloorNumber(level),C=CIRCA_CORRIDOR,P=CIRCA_PLATE,westDoor:[number,number]=[-1.3,-.5];
  return [
    {id:`${n}01`,beds:2,label:"2 bed · 2 bath · curved glass",x0:CIRCA_NORTH_WEST,x1:CIRCA_UNITS_EAST,z0:-P.rz,z1:C.z0,door:[1.5,2.3],mirror:false},
    {id:`${n}02`,beds:1,label:"1 bed · 1 bath · curved glass",x0:CIRCA_STAIR_EAST,x1:CIRCA_PARTY_WALL,z0:C.z1,z1:P.rz,door:westDoor,mirror:false},
    {id:`${n}03`,beds:1,label:"1 bed · 1 bath · curved glass",x0:CIRCA_PARTY_WALL,x1:CIRCA_UNITS_EAST,z0:C.z1,z1:P.rz,door:[mirrorX(westDoor[1]),mirrorX(westDoor[0])],mirror:true},
  ];
}
