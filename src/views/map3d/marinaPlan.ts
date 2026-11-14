import type {Scene3D} from './scene';
import {railPoint,type RailPlan} from './hillsCommunityPlan';

/** Where the harbour marina (stair, pier and dock) sits: the shore end of the southernmost terrace. */
export interface MarinaSite {x:number;pierZ:number;shoreZ:number;cityWalkZ:number}
export interface Area {x:number;z:number;w:number;d:number}

export function marinaSite(scene:Pick<Scene3D,'terraces'|'land'|'paving'|'bounds'>,terraceTop:number):MarinaSite{
 const b=scene.bounds,shore=scene.terraces.reduce<(typeof scene.terraces)[number]|undefined>((best,p)=>!best||p.z+p.d>best.z+best.d?p:best,undefined);
 const x=shore?shore.x+shore.w/2:(b.x0+b.x1)/2;
 // The shore is the coast itself: open land may reach well past the terrace, and a promenade judged
 // from the terrace edge ran the pier walk across that land and over its streets (Khaneil, 2026-11-13).
 const shoreZ=Math.max(shore?shore.z+shore.d:b.z1,...scene.land.filter(r=>x>=r.x&&x<=r.x+r.w).map(r=>r.z+r.d)),coastZ=shoreZ;
 // Join the actual district promenade, rather than stopping at the cliff edge.
 const walks=scene.paving.filter(r=>x>=r.x&&x<=r.x+r.w&&r.z<shoreZ&&r.z+r.d>shoreZ-2&&r.y>=terraceTop);
 const cityWalkZ=walks.length?Math.max(...walks.map(r=>Math.min(shoreZ-0.2,r.z+r.d/2))):shoreZ-0.8;
 return {x,pierZ:coastZ+1.8,shoreZ,cityWalkZ};
}

/** Ground the marina covers (stair landing, stair, pier, cross dock and lamp posts) plus a clear margin round it. */
export function marinaFootprint(m:MarinaSite):Area{return {x:m.x-2.5,z:m.pierZ-2.6,w:5,d:4.2};}

/** True when a support of half-size (hx, hz) centred at (x, z) would stand inside any area. */
export function blocksArea(areas:Area[],x:number,z:number,hx:number,hz:number){return areas.some(a=>x+hx>a.x&&x-hx<a.x+a.w&&z+hz>a.z&&z-hz<a.z+a.d);}

/** Half-width of a viaduct support's footprint, rounded up so a rotated track still keeps it off the area. */
export const SUPPORT_HALF=.22;
/** A viaduct support near distance d that keeps off the marina and other kept-clear ground: it slides
 * along the track up to 3 units each way, and is left out only when nothing nearby is clear. */
export function supportPoint(track:Pick<RailPlan,'route'|'lengths'|'length'>,d:number,keepClear:Area[]){
 for(const shift of [0,.5,-.5,1,-1,1.5,-1.5,2,-2,2.5,-2.5,3,-3]){
  const at=d+shift;if(at<0||at>track.length)continue;
  const q=railPoint(track as RailPlan,at);if(!blocksArea(keepClear,q.x,q.z,SUPPORT_HALF,SUPPORT_HALF))return q;
 }
 return undefined;
}
