import type {Pt} from './roads';
import {HQ,superellipse} from './atlasHqPlan';
import {HQ_PALETTE} from './atlasHqPalette';

/**
 * Atlas Command Center on the map, redesigned as its own building (Khaneil, 2026-11-17): the
 * double-height lobby and the four office floors you walk through inside, stacked as a cream stone
 * and green glass block with softly rounded corners, a stone entrance bay carrying the name, a
 * restrained brass canopy and door, and a planted roof.
 *
 * The storeys are the interior's own (3.3 lobby, 2.7 floors) at the interior's scale of 12 office
 * units per map unit, so the outside is exactly the building the floor navigation shows.
 *
 * Plain numbers only (no three.js), local to the parcel centre: x across the front, z toward the
 * viewer (+z is the entrance side), y up from the floor base. Everything scales with the
 * footprint `k = size / HQ.refSize`, and it all fits in the old square footprint, so the parcel,
 * plaza, roads and links around it stay where they are.
 */
export const CC={
 /** Interior storeys over the interior scale (atlasHqInteriorPlan: height 2.7, lobby 3.3, scale 12). */
 lobby:3.3/12,
 storey:2.7/12,
 floors:4,
 /** The block: a rounded rectangle, set back a little so the entrance has room in front. */
 cx:0,cz:-.1,a:.76,b:.5,roundness:5,ring:48,
 /** Stone pilasters stand on every `pierEvery`-th outline point. */
 pierEvery:4,pierDepth:.022,
 ledgeDepth:.03,ledgeHeight:.022,
 parapet:.07,coping:.025,
 /** The stone entrance bay, proud of the front, rising above the roof with the name on it. */
 bayHalf:.2,bayProud:.07,bayRise:.2,
 /** Glass texture: one tile is 4 bays by 4 storeys. */
 bay:HQ.bay,
} as const;

export const ccRoof=(k=1)=>(CC.lobby+CC.floors*CC.storey)*k;
/** The highest point: the entrance bay's top. */
export const ccTop=(k=1)=>ccRoof(k)+CC.bayRise*k;
/** Heights of the stone ledges: over the lobby, then over each office floor (the last is the roof). */
export const ccLedges=(k=1)=>Array.from({length:CC.floors+1},(_,i)=>(CC.lobby+i*CC.storey)*k);
export function ccOutline(k=1):Pt[]{return superellipse(CC.cx*k,CC.cz*k,CC.a*k,CC.b*k,CC.roundness,CC.ring);}
export const ccFront=(k=1)=>(CC.cz+CC.b)*k;
/** The entrance bay, as a box: centre x/z, width, depth, height. */
export function ccBay(k=1){
 const front=ccFront(k)+CC.bayProud*k,back=ccFront(k)-.12*k;
 return {x:0,z:(front+back)/2,w:2*CC.bayHalf*k,d:front-back,h:ccTop(k),front};
}

/**
 * The front door's dressing, under the stone bay: a stone landing out to the plaza, dark green
 * jambs under a brass header (the opening glass doors themselves are the map's shared
 * EntranceDoors, placed by ccDoor), a thin brass canopy, planters either side and two door
 * lamps that light at night. Boxes as [x, y, z, w, h, d, colour], y the bottom; lamps listed apart.
 */
export type CcBox=[number,number,number,number,number,number,string];
export function ccEntrance(k=1){
 const z=ccBay(k).front,dw=.22*k,dh=.2*k,brass=HQ_PALETTE.brass;
 const boxes:CcBox[]=[
  [0,0,z+.12*k,.5*k,.02*k,.24*k,'#e5dccb'],
  ...[-1,1].map(side=>[side*(dw/2+.01*k),.02*k,z+.012*k,.018*k,dh+.02*k,.024*k,'#2f5d4a'] as CcBox),
  [0,.02*k+dh,z+.012*k,dw+.05*k,.02*k,.026*k,brass],
  [0,.05*k+dh,z+.08*k,dw+.16*k,.01*k,.16*k,brass],
  ...[-1,1].map(side=>[side*.23*k,.02*k,z+.17*k,.06*k,.05*k,.06*k,'#3f6b4f'] as CcBox),
  ...[-1,1].map(side=>[side*.23*k,.07*k,z+.17*k,.05*k,.045*k,.05*k,'#6f9a62'] as CcBox),
 ];
 const lamps:CcBox[]=[-1,1].map(side=>[side*.15*k,.02*k,z+.05*k,.014*k,.045*k,.014*k,'#ffffff']);
 return {boxes,lamps};
}

/** Roof garden: a lawn inset from the parapet, low hedges along its edge and a few olive trees. */
export function ccRoofGarden(k=1){
 const y=ccRoof(k),hedges:CcBox[]=[];
 for(const side of [-1,1]){
  hedges.push([side*.52*k,y,CC.cz*k,.08*k,.05*k,.62*k,'#4f7a52']);
  hedges.push([side*.26*k,y,(CC.cz-.36)*k,.36*k,.05*k,.07*k,'#4f7a52']);
 }
 const trees:Pt[]=[[-.4*k,(CC.cz+.16)*k],[.4*k,(CC.cz+.16)*k],[0,(CC.cz-.2)*k]];
 return {y,hedges,trees};
}

/** Every point the building puts on the ground, for clearance checks. */
export function ccFootprint(k=1):Pt[]{
 const b=ccBay(k),door=ccEntrance(k).boxes.flatMap(([x,,z,w,,d])=>[[x-w/2,z+d/2],[x+w/2,z+d/2]] as Pt[]);
 return [...ccOutline(k),[-b.w/2,b.front],[b.w/2,b.front],...door];
}

/** Where the map's shared opening glass doors stand for this building: centred in the stone bay. */
export function ccDoor(t:{x:number;z:number;size:number},base:number){
 const k=t.size/HQ.refSize;
 return {p:[t.x,base,t.z+ccBay(k).front+.004*k] as [number,number,number],s:[.22*k,.2*k,.025] as [number,number,number]};
}
