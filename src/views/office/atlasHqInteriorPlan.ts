import type {Pt} from '../map3d/roads';
import {HQ,superellipse} from '../map3d/atlasHqPlan';

/**
 * Atlas Command Center inside, matched to the outside (Khaneil, 2026-11-17). Plain numbers, no three.js.
 *
 * Each floor plate is the building's rounded rectangle: a glass curtain wall with a mullion at every
 * outline point, a forest-green panel on every eighth, a cream stone slab and lift core, and a brass
 * head rail. The exterior draws the same outline, points and level spacing (HQ.plate in
 * src/views/map3d/atlasHqPlan.ts), shrunk to the map, so windows and floors line up between views.
 *
 * Coordinates are the office scene's: x across, z toward the open front, y up from the floor.
 */
export const HQ_INTERIOR={
 /** Glass sits this far outside the office plan, so desks and furniture keep their places. */
 margin:.6,
 roundness:HQ.plate.roundness,
 points:HQ.plate.points,
 height:2.7,
 /** Lobby glass runs up to the floor above: the double-height lobby. */
 lobbyHeight:3.3,
 sill:.34,
 coreWidth:HQ.core.w,
 floors:HQ.plate.levels,
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
/** Green panels stand on the same mullions as outside. */
export const isPanel=(i:number)=>i%HQ.panelEvery===0;
/** Back and west walls stand full height; the front and east are cut down so the camera sees in. */
export function isTall(i:number){const f=around(i);return f>.07&&f<.62;}

/** Glass height: storey height, double on the lobby. */
export const glassHeight=(level:number)=>level===0?HQ_INTERIOR.lobbyHeight:HQ_INTERIOR.height;

/** The stone lift core at the back, behind the wall display. */
export function core(d:number){return {x:0,z:-d/2-.1,w:HQ_INTERIOR.coreWidth,depth:.2};}
