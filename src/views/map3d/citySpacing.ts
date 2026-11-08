import type {Rect} from './scene';

/** Neighborhood spacing is independent of airport size and simulation routes. */
export const CITY_SPACING={gap:.6,dockClearance:2.5,financialWestOffset:7,railEndApproach:6,railEdgeClearance:1.2,causewayWidth:3.2,maxCausewayGap:3} as const;
export function cityEnvelope(rects:Rect[]):Rect|undefined{
 if(!rects.length)return;
 const x=Math.min(...rects.map(r=>r.x)),z=Math.min(...rects.map(r=>r.z));
 return {x,z,w:Math.max(...rects.map(r=>r.x+r.w))-x,d:Math.max(...rects.map(r=>r.z+r.d))-z};
}
export function overlapsParcel(a:Rect,b:Rect,gap=0){return a.x<b.x+b.w+gap&&a.x+a.w>b.x-gap&&a.z<b.z+b.d+gap&&a.z+a.d>b.z-gap;}
