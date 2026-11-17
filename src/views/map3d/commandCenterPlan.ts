import type {Pt} from './roads';
import {HQ} from './atlasHqPlan';
import {HQ_PALETTE} from './atlasHqPalette';

/**
 * Atlas Command Center on the map, after Khaneil's concept (2026-11-17): the double-height lobby
 * and the four office floors you walk through inside. A glass wing on the right turns the front
 * corner in a wide curve, the left wing stands a step back, and the stone entrance bay covers the
 * joint, rising above the roof with the name. The building itself is a Blender model
 * (assets/command-center/build_command_center.py, exported to public/models/map/command-center.glb);
 * this plan holds the same numbers for everything the map places around it, and atlasHq.test.ts
 * checks the model against them.
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
 /** The block's extent: centre, half width, half depth (x -0.76..0.76, z -0.6..0.4). The interior reads its proportions. */
 cx:0,cz:-.1,a:.76,b:.5,roundness:9,
 /** The left wing's front stands this far behind the right wing's; the step is at x = joint. */
 leftStep:.08,joint:-.24,
 /** Corner radii: the right wing's wide curves and the left wing's softer ones. */
 rightRadius:.2,leftRadius:.12,
 /** Cream stone floor slabs stand this far proud of the glass. */
 slab:.04,
 /** The stone entrance bay, proud of the front, rising above the roof with the logo and name on it. */
 bayHalf:.24,bayProud:.09,bayRise:.14,
} as const;

export const ccRoof=(k=1)=>(CC.lobby+CC.floors*CC.storey)*k;
/** The highest point: the entrance bay's top. */
export const ccTop=(k=1)=>ccRoof(k)+CC.bayRise*k;
/** Heights of the stone ledges: over the lobby, then over each office floor (the last is the roof). */
export const ccLedges=(k=1)=>Array.from({length:CC.floors+1},(_,i)=>(CC.lobby+i*CC.storey)*k);
/** The glass line at ground level, as the Blender script draws it (8 points per corner arc). */
export function ccOutline(k=1):Pt[]{
 const x0=(CC.cx-CC.a)*k,x1=(CC.cx+CC.a)*k,z0=(CC.cz-CC.b)*k,zr=(CC.cz+CC.b)*k,zl=zr-CC.leftStep*k,j=CC.joint*k;
 const R=CC.rightRadius*k,r=CC.leftRadius*k,h=Math.PI/2;
 const arc=(cx:number,cz:number,rad:number,a0:number,a1:number):Pt[]=>Array.from({length:9},(_,i)=>[cx+rad*Math.cos(a0+(a1-a0)*i/8),cz+rad*Math.sin(a0+(a1-a0)*i/8)]);
 return [[j,zr],...arc(x1-R,zr-R,R,h,0),...arc(x1-R,z0+R,R,0,-h),...arc(x0+r,z0+r,r,-h,-2*h),...arc(x0+r,zl-r,r,Math.PI,h),[j,zl]];
}
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
  // Clipped hedges in stone planters along the front of each wing, either side of the entrance.
  ...[-1,1].map(side=>[side*.5*k,0,(side<0?f-CC.leftStep*k:f)+.07*k,.42*k,.035*k,.07*k,stone] as CcBox),
  ...[-1,1].map(side=>[side*.5*k,.035*k,(side<0?f-CC.leftStep*k:f)+.07*k,.4*k,.045*k,.055*k,'#4f7a52'] as CcBox),
 ];
 const lamps:CcBox[]=[-1,1].map(side=>[side*.15*k,.02*k,z+.05*k,.014*k,.045*k,.014*k,'#ffffff']);
 return {boxes,lamps};
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
