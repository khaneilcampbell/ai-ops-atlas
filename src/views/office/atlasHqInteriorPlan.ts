import type {Pt} from '../map3d/roads';
import {HQ,superellipse} from '../map3d/atlasHqPlan';
import {CC} from '../map3d/commandCenterPlan';

/**
 * Atlas Command Center inside, matched to the building on the map (Khaneil, 2026-11-17). Plain
 * numbers, no three.js.
 *
 * Each floor plate takes the block's rounded-rectangle plan, wrapped in the same green glass with
 * cream mullions and a spandrel at the same storey. The lobby is the warm glass of the lobby
 * outside, and the roof is flat, so every floor has the same height. A stone core stands at the back.
 *
 * Coordinates are the office scene's: x across, z toward the open front, y up from the floor.
 */
export const HQ_INTERIOR={
 /** Glass sits this far outside the office plan, so desks and furniture keep their places. */
 margin:.6,
 /** The block's own squareness, so each floor plate has its rounded corners. */
 roundness:CC.roundness,
 points:64,
 height:2.7,
 /** Lobby glass runs up to the floor above: the double-height gold lobby. */
 lobbyHeight:3.3,
 sill:.34,
 coreWidth:3.4,
 floors:5,
 /** Office units per map unit: the interior is the building drawn about 12 times larger. */
 scale:12,
} as const;

/** The block's plan, width over depth (about 1.5): every floor plate keeps it, so the floors read as slices of the building. */
export const towerAspect=CC.a/CC.b;
/** The facade's window grid inside: a bay and a storey of the building, at interior scale. */
export const facadeBay=HQ.bay*HQ_INTERIOR.scale;

export const isAtlasHq=(projectId:string)=>projectId==='ai-ops-atlas';

export function shellAxes(w:number,d:number){
 // Office plans widen to the block's proportions; the desks keep their places inside.
 const b=d/2+HQ_INTERIOR.margin;return {a:Math.max(w/2+HQ_INTERIOR.margin,b*towerAspect),b};
}
/** The curtain wall outline, counter-clockwise from above, starting at the east (+x) point. */
export function shellOutline(w:number,d:number):Pt[]{
 const {a,b}=shellAxes(w,d);return superellipse(0,0,a,b,HQ_INTERIOR.roundness,HQ_INTERIOR.points);
}
/** Inside the curtain wall? (1 on the glass.) */
export function shellValue(w:number,d:number,x:number,z:number){
 const {a,b}=shellAxes(w,d),n=HQ_INTERIOR.roundness;return Math.abs(x/a)**n+Math.abs(z/b)**n;
}

/** Where along the outline (0 east, .25 back, .5 west, .75 front) a point index sits. */
export const around=(i:number)=>i/HQ_INTERIOR.points;

/** The lobby is glazed in the warm lobby glass all round; the office floors in green glass. */
export function isGold(_i:number,level:number){return level===0;}
/** Back and west walls stand full height; the front and east are cut down so the camera sees in. */
export function isTall(i:number){const f=around(i);return f>.07&&f<.62;}

/** Glass height: the lobby's double height, a storey on every office floor (the roof is flat). */
export function glassHeight(_x:number,level:number,_w:number,_d:number){
 return level===0?HQ_INTERIOR.lobbyHeight:HQ_INTERIOR.height;
}

/** The stone core at the back (lifts and stairs in the section), behind the wall display. */
export function core(d:number){return {x:0,z:-d/2-.1,w:HQ_INTERIOR.coreWidth,depth:.2};}

/**
 * The clear glass door on Floors 1 to 4 (Khaneil, 2026-11-17), in the front glass on the centre
 * line, above the lobby entrance: agents walk from the lift corridor through it to the desks.
 */
export function floorDoor(w:number,d:number){return {x:0,z:shellAxes(w,d).b,width:1.4,height:2.2};}
/**
 * A stretch of curtain wall with the doorway cut out: front glass on Floors 1 to 4 loses the part
 * between the door jambs, so the door stands open to walk through. Returns the pieces that stay.
 */
export function wallPieces(a:Pt,b:Pt,level:number,w:number,d:number):[Pt,Pt][]{
 const door=floorDoor(w,d),h=door.width/2+.12;
 if(level===0||a[1]+b[1]<=0||Math.max(a[0],b[0])<=-h||Math.min(a[0],b[0])>=h)return [[a,b]];
 const at=(x:number):Pt=>{const t=(x-a[0])/(b[0]-a[0]);return [x,a[1]+(b[1]-a[1])*t];};
 const lo=Math.min(a[0],b[0])<-h,hi=Math.max(a[0],b[0])>h,out:[Pt,Pt][]=[];
 // Keep a's side first, so the pieces run the same way round as the outline.
 const fromLow=a[0]<b[0];
 const low:[Pt,Pt]|null=lo?(fromLow?[a,at(-h)]:[at(-h),b]):null,high:[Pt,Pt]|null=hi?(fromLow?[at(h),b]:[a,at(h)]):null;
 for(const piece of fromLow?[low,high]:[high,low])if(piece)out.push(piece);
 return out;
}

/**
 * Width of ground the city outside keeps clear around the HQ cutaway: the glass, and the lift
 * landing and canopy in front. The city's own palms and trees used to stand inside it and push up
 * through the floors (Khaneil, 2026-11-17).
 */
export function hqClearSpan(w:number,d:number){
 const {a,b}=shellAxes(w,d);return 2*Math.max(a,b+2.8);
}
