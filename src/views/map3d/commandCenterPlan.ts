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
 /**
  * The interior's storeys (atlasHqInteriorPlan: lobby 3.3, floors 2.7) at 10 interior units per
  * map unit of plan (Khaneil, 2026-11-17: the concept's size, with the Growth & Marketing Studio
  * and the Vendor & Supplier Hub). On the campus (k about 2.35) the roof stands about 3.3 map
  * units up, inside the Studio's 3.1 to 3.8, and the lobby keeps the interior's proportions.
  */
 lobby:3.3/10,
 storey:2.7/10,
 floors:4,
 /** The block's extent: centre, half width, half depth (x -0.82..0.82, z -0.62..0.38). The interior reads its proportions. */
 cx:0,cz:-.12,a:.82,b:.5,roundness:9,
 /** The left wing's front stands this far behind the right wing's; the step is at x = joint. */
 leftStep:.07,joint:-.26,
 /** Corner radii: the right wing's wide curves and the left wing's softer ones. */
 rightRadius:.22,leftRadius:.12,
 /** Cream stone floor slabs stand this far proud of the glass. */
 slab:.035,
 /** The stone entrance bay, proud of the front, rising above the roof with the logo and name on it. */
 bayHalf:.26,bayProud:.08,bayRise:.14,
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
 * The front door's dressing, as in the concept: a broad stone staircase of four steps out to the
 * plaza, the stone bay carried on two posts, dark green jambs under a brass header (the opening
 * glass doors themselves are the map's shared EntranceDoors, placed by ccDoor), a deep brass
 * canopy on two slim brass columns, and two door lamps that light at night.
 * Boxes as [x, y, z, w, h, d, colour], y the bottom; lamps listed apart.
 */
export type CcBox=[number,number,number,number,number,number,string];
export function ccEntrance(k=1){
 const bay=ccBay(k),z=bay.front,dw=.24*k,dh=.21*k,brass=HQ_PALETTE.brass,stone=HQ_PALETTE.stone;
 const stairW=bay.w+.14*k,tread=.04*k,rise=.01*k,canopyY=dh+.05*k,canopyD=.24*k;
 const boxes:CcBox[]=[
  // Four steps: each one shorter in depth and a riser higher, so they climb toward the door.
  ...[0,1,2,3].map(i=>[0,0,z+tread*(4-i)/2,stairW-.03*k*i,rise*(i+1),tread*(4-i),i%2?'#ede4d2':'#e5dccb'] as CcBox),
  // The stone posts that carry the bay down to the ground.
  ...[-1,1].map(side=>[side*(bay.w/2-.025*k),0,bay.z,.05*k,bay.y,bay.d,stone] as CcBox),
  ...[-1,1].map(side=>[side*(dw/2+.01*k),.02*k,z+.012*k,.018*k,dh+.02*k,.024*k,'#2f5d4a'] as CcBox),
  [0,.02*k+dh,z+.012*k,dw+.05*k,.02*k,.026*k,brass],
  // The canopy: wider than the bay, a deep gold slab over the steps on two slim brass columns.
  [0,canopyY,z+canopyD/2,bay.w+.12*k,.018*k,canopyD,brass],
  ...[-1,1].map(side=>[side*(bay.w/2+.03*k),rise*4,z+canopyD-.02*k,.014*k,canopyY-rise*4,.014*k,brass] as CcBox),
 ];
 const lamps:CcBox[]=[-1,1].map(side=>[side*.17*k,.03*k,z+.05*k,.014*k,.045*k,.014*k,'#ffffff']);
 return {boxes,lamps};
}

/**
 * The grounds round the building, as in the concept: stone-kerbed flower beds along the front of
 * each wing (clipped hedge with pink, purple and white flowers), a potted tree either side of the
 * stairs and small round trees at the front corners. Kept inside the parcel, clear of the street
 * ring. Boxes as CcBox; blobs [x, y, z, sx, sy, sz, colour] for flowers and crowns; trunks as CcBox.
 */
export function ccGrounds(k=1){
 const f=ccFront(k)+CC.slab*k,bay=ccBay(k),stone=HQ_PALETTE.stone,hedge=HQ_PALETTE.hedge;
 const boxes:CcBox[]=[],blobs:CcBox[]=[],trunks:CcBox[]=[];
 const flowers=['#d98cc0','#a77fd0','#f3eef4','#e7a3c9'];
 // One bed in front of each wing: left wing a step back, right wing up to where its corner curves.
 const beds:[number,number,number][]=[[-(CC.a-.02)*k,-(bay.w/2+.16*k),f-CC.leftStep*k+.06*k],[bay.w/2+.16*k,(CC.a-CC.rightRadius+.05)*k,f+.06*k]];
 beds.forEach(([x0,x1,z],b)=>{
  const w=x1-x0,cx=(x0+x1)/2;
  boxes.push([cx,0,z,w+.02*k,.03*k,.09*k,stone],[cx,.03*k,z-.012*k,w-.02*k,.03*k,.04*k,hedge]);
  const n=Math.max(3,Math.round(w/(.045*k)));
  for(let i=0;i<n;i++){const x=x0+.02*k+(w-.04*k)*i/(n-1);blobs.push([x,.04*k,z+.022*k,.026*k,.02*k,.026*k,flowers[(i+b)%flowers.length]]);}
 });
 // Potted trees either side of the stairs.
 for(const side of [-1,1]){
  const x=side*(bay.w/2+.09*k),z=bay.front+.13*k;
  boxes.push([x,0,z,.06*k,.05*k,.06*k,stone]);
  trunks.push([x,.05*k,z,.012*k,.08*k,.012*k,'#6d5a45']);
  blobs.push([x,.15*k,z,.055*k,.065*k,.055*k,'#5f8a55']);
 }
 // Small round trees at the front corners of the parcel.
 for(const [x,z] of [[-.74,.74],[.74,.74],[-.8,.5]] as Pt[]){
  trunks.push([x*k,0,z*k,.016*k,.1*k,.016*k,'#6d5a45']);
  blobs.push([x*k,.14*k,z*k,.075*k,.08*k,.075*k,'#6f9a62']);
 }
 return {boxes,blobs,trunks};
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
