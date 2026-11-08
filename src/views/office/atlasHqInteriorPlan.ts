import type {Pt} from '../map3d/roads';
import {superellipse,wingSway} from '../map3d/atlasHqPlan';

/**
 * Atlas HQ inside, matched to the outside (KC, 2026-10-31). Plain numbers, no three.js.
 *
 * Each floor plate takes the tower's softly rounded plan, wrapped in a glass curtain wall with a
 * mullion every bay. The gold wing shows as the part of that wall glazed gold; where blue turns to
 * gold moves floor by floor along the same S the wing sways through outside. The lobby is glazed
 * gold all round, the top floor's glass rises under the roof that slopes from west to east, and
 * Floor 3 opens onto the podium's roof garden. A stone core stands at the back, as in the section.
 *
 * Coordinates are the office scene's: x across, z toward the open front, y up from the floor.
 */
export const HQ_INTERIOR={
 /** Glass sits this far outside the office plan, so desks and furniture keep their places. */
 margin:.6,
 /** Same squareness family as the tower outline, a little squarer to fit a room. */
 roundness:5,
 points:64,
 height:2.7,
 /** Lobby glass runs up to the floor above: the double-height gold lobby. */
 lobbyHeight:3.3,
 sill:.34,
 /** Extra height of the top floor's glass at its west end, falling to none at the east. */
 roofRise:1.3,
 coreWidth:3.4,
 floors:5,
 /** Floor 3 meets the top of the three-storey podium. */
 terraceFloor:3,
} as const;

export const isAtlasHq=(projectId:string)=>projectId==='ai-ops-atlas';

export function shellAxes(w:number,d:number){return {a:w/2+HQ_INTERIOR.margin,b:d/2+HQ_INTERIOR.margin};}
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

/**
 * How far the gold glass reaches round the back from the east side on this floor: the wing's
 * sway outside, read at the floor's height. The further east the wing leans, the less gold.
 */
export function goldReach(level:number){
 const t=(level+.5)/HQ_INTERIOR.floors,x=wingSway(t).x;
 return .3-(x-.05)/.3*.24;
}
export function isGold(i:number,level:number){
 if(level===0)return true;
 const f=around(i);return f<=goldReach(level)||f>=.94;
}
/** Back and west walls stand full height; the front and east are cut down so the camera sees in. */
export function isTall(i:number){const f=around(i);return f>.07&&f<.62;}

/** Glass height at a point: storey height, double on the lobby, rising west under the top roof. */
export function glassHeight(x:number,level:number,w:number,d:number){
 const {a}=shellAxes(w,d);
 if(level===0)return HQ_INTERIOR.lobbyHeight;
 const base=HQ_INTERIOR.height;
 return level===HQ_INTERIOR.floors-1?base+HQ_INTERIOR.roofRise*(1-(x/a+1)/2):base;
}

/** The podium roof garden off the east side of Floor 3. */
export function terrace(w:number,d:number){
 const {a,b}=shellAxes(w,d);
 const x0=a-.35,x1=a+2.6,z0=-b*.75,z1=b*.35;
 return {x0,x1,z0,z1,pool:{x:(x0+x1)/2+.35,z:z0+.95,rx:.9,rz:.38},trees:[[x1-.55,z0+.55],[x0+.95,z1-.6],[x1-.6,z1-.55]] as Pt[]};
}

/** The stone core at the back (lifts and stairs in the section), behind the wall display. */
export function core(d:number){return {x:0,z:-d/2-.1,w:HQ_INTERIOR.coreWidth,depth:.2};}
