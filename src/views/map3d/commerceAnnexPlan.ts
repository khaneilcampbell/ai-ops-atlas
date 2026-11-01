import type {Pt} from './roads';
import {teardrop} from './commerceTowerPlan';

/**
 * The Commerce district's tool offices (Canva, Serper, Stripe, ...) as smaller members of the
 * Commerce Pipeline family (KC, 2026-11-01): the same teardrop plan, silver fin curtain wall and
 * gold glass, each turned so its point faces the main tower and twisting a little as it rises.
 * They use their whole tool lot (about 1.25, see scene.ts). Numbers are for a 0.9 lot and scale with it. Original stylized design; brand colour only
 * on each building's own name sign.
 */
export const ANNEX={
 projectId:'commerce-pipeline',
 refSize:.9,
 /** Teardrop: round end radius, point radius, centre-to-centre length. */
 round:.25,tip:.08,length:.42,ring:36,
 /** Turn over the full height (radians), alternating direction building to building. */
 twist:.42,
 /** The plan narrows by this share toward the roof. */
 taper:.12,
 /** The roof falls toward the round end by this share of the height. */
 slope:.1,
 levels:10,
 /** Gold glass lobby height and the gold strip up the point (outline points either side). */
 lobby:.36,strip:3,
 finEvery:2,finDepth:.03,
 /** Stone plinth: outward reach and height. */
 plinth:.07,plinthH:.05,
} as const;

export const isCommerceAnnex=(k:{projectId:string})=>k.projectId===ANNEX.projectId;

const rot=([x,z]:Pt,a:number):Pt=>[x*Math.cos(a)-z*Math.sin(a),x*Math.sin(a)+z*Math.cos(a)];
/** Eased turn at height t (0 base, 1 top), so the twist reads as a gentle S like the main tower. */
export const annexTwist=(t:number,twist:number)=>twist*(t-Math.sin(2*Math.PI*t)/(2*Math.PI));

export interface AnnexShape {heading:number;twist:number;k:number}
/**
 * How one office stands: its point faces the tower (or +z with no tower), and neighbours twist
 * opposite ways so the family does not look copied.
 */
export function annexShape(lot:{x:number;z:number;size:number},tower:{x:number;z:number}|undefined,index:number):AnnexShape{
 const heading=tower?Math.atan2(tower.z-lot.z,tower.x-lot.x):Math.PI/2;
 return {heading,twist:ANNEX.twist*(index%2?-1:1),k:lot.size/ANNEX.refSize};
}

/** Outline at height t, local to the lot centre: centred in the lot, turned and tapered. */
export function annexPlan(shape:AnnexShape,t:number,grow=0):Pt[]{
 const a=ANNEX,s=1-a.taper*t,round=a.round*s,tip=a.tip*s,length=a.length*s;
 // Centre the shape's full length (round end back to point) on the lot.
 const mid=(length+tip-round)/2;
 return teardrop(round+grow,tip+grow,length,a.ring).map(([x,z])=>{const [rx,rz]=rot([x-mid,z],shape.heading+annexTwist(t,shape.twist));return [rx*shape.k,rz*shape.k] as Pt;});
}

/** Roof height share over each outline point: the point (index 0) stands full height. */
export function annexRoof(i:number,n:number=ANNEX.ring){
 const f=Math.min(i,n-i)/(n/2);
 return 1-ANNEX.slope*f*f;
}

/** Point indices covered by the gold strip up the point. */
export function annexStrip(n:number=ANNEX.ring):Set<number>{
 const s=new Set<number>();for(let d=-ANNEX.strip;d<=ANNEX.strip;d++)s.add((d+n)%n);return s;
}

/** The front of the base outline (largest z) where the door and canopy go, local to the lot. */
export function annexFront(shape:AnnexShape){
 const base=annexPlan(shape,0);let best=base[0];for(const p of base)if(p[1]>best[1])best=p;
 return {x:best[0],z:best[1]};
}

/** Furthest reach of the plinth from the lot centre on each axis, for clearance checks. */
export function annexReach(shape:AnnexShape):{x:number;z:number}{
 const pts=annexPlan(shape,0,ANNEX.plinth);
 return {x:Math.max(...pts.map(p=>Math.abs(p[0]))),z:Math.max(...pts.map(p=>Math.abs(p[1])))};
}
