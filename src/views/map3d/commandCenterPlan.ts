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
 /** The block: a near-square rounded rectangle, set back a little so the entrance has room in front. */
 cx:0,cz:-.1,a:.76,b:.5,roundness:9,ring:48,
 /** Stone pilasters stand on every `pierEvery`-th outline point. */
 pierEvery:4,pierDepth:.022,
 /** Thick cream stone floor slabs, the horizontal half of the stone grid. */
 ledgeDepth:.045,ledgeHeight:.034,
 parapet:.08,coping:.025,
 /** The stone entrance bay, proud of the front, rising above the roof with the logo and name on it. */
 bayHalf:.24,bayProud:.09,bayRise:.14,
 /** One window column of the stone facade (map units at k = 1); the texture tile is 4 of them. */
 bay:.19,
} as const;

export const ccRoof=(k=1)=>(CC.lobby+CC.floors*CC.storey)*k;
/** The highest point: the entrance bay's top. */
export const ccTop=(k=1)=>ccRoof(k)+CC.bayRise*k;
/** Heights of the stone ledges: over the lobby, then over each office floor (the last is the roof). */
export const ccLedges=(k=1)=>Array.from({length:CC.floors+1},(_,i)=>(CC.lobby+i*CC.storey)*k);
export function ccOutline(k=1):Pt[]{return superellipse(CC.cx*k,CC.cz*k,CC.a*k,CC.b*k,CC.roundness,CC.ring);}
export const ccFront=(k=1)=>(CC.cz+CC.b)*k;
/**
 * The entrance bay, as a box: centre x/z, width, depth, height. Its stone starts over the lobby
 * (`y`), carried on two stone posts, so the gold-lit lobby glass runs on underneath it.
 */
export function ccBay(k=1){
 const front=ccFront(k)+CC.bayProud*k,back=ccFront(k)-.12*k;
 return {x:0,z:(front+back)/2,w:2*CC.bayHalf*k,d:front-back,y:CC.lobby*k,h:ccTop(k),front};
}

/**
 * The front door's dressing, under the stone bay: two steps out to the plaza, dark green
 * jambs under a brass header (the opening glass doors themselves are the map's shared
 * EntranceDoors, placed by ccDoor), a wide brass canopy, planters along the front and two door
 * lamps that light at night. Boxes as [x, y, z, w, h, d, colour], y the bottom; lamps listed apart.
 */
export type CcBox=[number,number,number,number,number,number,string];
export function ccEntrance(k=1){
 const bay=ccBay(k),z=bay.front,dw=.22*k,dh=.2*k,brass=HQ_PALETTE.brass,stone=HQ_PALETTE.stone,f=ccFront(k);
 const boxes:CcBox[]=[
  // Two broad steps down to the plaza.
  [0,0,z+.1*k,.62*k,.012*k,.2*k,'#e5dccb'],
  [0,0,z+.035*k,.54*k,.022*k,.07*k,'#ede4d2'],
  // The stone posts that carry the bay down to the ground.
  ...[-1,1].map(side=>[side*(bay.w/2-.025*k),0,bay.z,.05*k,bay.y,bay.d,stone] as CcBox),
  ...[-1,1].map(side=>[side*(dw/2+.01*k),.02*k,z+.012*k,.018*k,dh+.02*k,.024*k,'#2f5d4a'] as CcBox),
  [0,.02*k+dh,z+.012*k,dw+.05*k,.02*k,.026*k,brass],
  // The canopy: wider than the bay, a gold slab over the steps.
  [0,.05*k+dh,z+.08*k,bay.w+.1*k,.018*k,.2*k,brass],
  // Clipped hedges in stone planters along the front, either side of the entrance.
  ...[-1,1].map(side=>[side*.5*k,0,f+.045*k,.42*k,.035*k,.07*k,stone] as CcBox),
  ...[-1,1].map(side=>[side*.5*k,.035*k,f+.045*k,.4*k,.045*k,.055*k,'#4f7a52'] as CcBox),
 ];
 const lamps:CcBox[]=[-1,1].map(side=>[side*.15*k,.02*k,z+.05*k,.014*k,.045*k,.014*k,'#ffffff']);
 return {boxes,lamps};
}

/**
 * Roof garden: a lawn inset from the parapet, planters full of shrubs right round its edge (so
 * they show over the parapet, as in the concept) and a few olive trees.
 */
export function ccRoofGarden(k=1){
 const y=ccRoof(k),hedges:CcBox[]=[],g='#4f7a52',ix=(CC.a-.1)*k,iz=(CC.b-.1)*k,cz=CC.cz*k;
 for(const side of [-1,1]){
  hedges.push([side*ix,y,cz,.07*k,.07*k,2*iz,g]);
  hedges.push([0,y,cz+side*iz,2*ix,.07*k,.07*k,g]);
 }
 const shrubs:Pt[]=[];
 for(let i=0;i<7;i++){const x=(-.6+i*.2)*k;shrubs.push([x,cz+iz],[x,cz-iz]);}
 for(const side of [-1,1])for(const t of [-.2,.2])shrubs.push([side*ix,cz+t*k]);
 const trees:Pt[]=[[-.4*k,(CC.cz+.12)*k],[.4*k,(CC.cz+.12)*k],[0,(CC.cz-.18)*k]];
 return {y,hedges,shrubs,trees};
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
