import type {Rect,Scene3D} from './scene';
import type {Pt} from './roads';
import {routeAround} from './routing';
import {CITY_SPACING,cityEnvelope,overlapsParcel} from './citySpacing';
export const HILLS_KEY='service:atlas-hills';
/** The district is Atlas Hills; the house on its estate is Atlas Mansion (KC, 2026-11-01). Display names only. */
export const HILLS_DISTRICT_NAME='Atlas Hills';
export const MANSION_NAME='Atlas Mansion';
/**
 * The mansion's interior key predates the rename and stays as it was, so saved views and the
 * interior catalog entry keep working. Show MANSION_NAME wherever this key would be printed.
 */
export const MANSION_INTERIOR_BUILDING='Atlas Hills';
export const MANSION_INTERIOR_ID=`skyline-business:${MANSION_INTERIOR_BUILDING}`;
/** The name a person sees for an interior building key. */
export const interiorDisplayName=(building:string)=>building===MANSION_INTERIOR_BUILDING?MANSION_NAME:building;
/** The nameplate over the house: it names the mansion, and its hover title names the district too. */
export function mansionPlaque(hills:Pick<Rect,'x'|'z'>){
 return {id:HILLS_KEY,select:HILLS_KEY,name:MANSION_NAME,title:`${MANSION_NAME} · ${HILLS_DISTRICT_NAME} · Planned community`,x:hills.x+HILLS.mansion.x,z:hills.z+HILLS.mansion.z,roofAboveTerrace:HILLS.mansion.h+.25,priority:2};
}
export const HILLS={width:34,depth:46,estateWidth:20,mansion:{x:13,z:10,w:9,d:5,h:3.2},garage:{x:4.5,z:4,w:5,d:3},pool:{x:6.2,z:10,w:2.4,d:6},court:{x:2.4,z:11,w:3.5,d:8,playWidth:2.8,playDepth:6.08},gateX:1,walkGateX:7.95} as const;
export interface HillsPlan extends Rect {road:Pt[];walk:Pt[];drive:Pt[];promenade:Pt[]}
/** Keep the neighborhood beside the original city, independent of the airport's outer edge. */
export function planHills(s:Pick<Scene3D,'land'|'paving'|'carBridges'|'towers'|'kiosks'|'retail'>&{coreLand?:Rect[];fountains?:Scene3D['fountains'];terraces?:{x:number;z:number;w:number;d:number;label?:string}[]}):HillsPlan|undefined{
 const streets=s.carBridges.flatMap(b=>b.roads).flat();if(!streets.length||!s.paving.length)return;
 const access=streets.reduce((a,b)=>b[1]>a[1]?b:a);
 const shore=s.terraces?.reduce((best,p)=>p.z+p.d>best.z+best.d?p:best),harborX=shore?shore.x+shore.w/2:undefined;
 let x=access[0]-HILLS.estateWidth/2;
 if(harborX!==undefined&&harborX>=x-1&&harborX<=x+HILLS.estateWidth+1)x=harborX+CITY_SPACING.dockClearance;
 const core=cityEnvelope(s.coreLand??s.terraces??s.land);if(!core)return;
 const candidates=[core.z+core.d+CITY_SPACING.gap,...s.land.map(r=>r.z+r.d+CITY_SPACING.gap)].sort((a,b)=>a-b);
 const z=candidates.find(z=>z>=core.z+core.d&& !s.land.some(r=>overlapsParcel({x,z,w:HILLS.width,d:HILLS.depth},r)));if(z===undefined)return;
 const boxes=[...s.towers,...s.kiosks,...s.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
 boxes.push(...(s.fountains??[]).map(f=>({x:f.x,z:f.z,w:.95*(f.k??1),d:.95*(f.k??1)})));
 const entry:Pt=[x+HILLS.gateX,z+.5],landing:Pt=[x+HILLS.walkGateX,z+.5];
 const approach:Pt=shore?[Math.max(shore.x+.8,Math.min(shore.x+shore.w-.8,entry[0])),shore.z+shore.d-.35]:entry;
 const first=routeAround(access,approach,boxes,.4),last=routeAround(approach,entry,boxes,.4);if(!first||!last)return;
 const road=[...first,...last.slice(1)];
 const paths=s.paving.map(p=>[p.x+p.w/2,p.z+p.d/2] as Pt).filter(p=>!boxes.some(b=>Math.abs(p[0]-b.x)<b.w/2+.4&&Math.abs(p[1]-b.z)<b.d/2+.4));
 const walkApproach:Pt=[approach[0]+.9,approach[1]],walkGate:Pt=[entry[0]+.9,landing[1]];
 paths.sort((a,b)=>Math.hypot(a[0]-walkApproach[0],a[1]-walkApproach[1])-Math.hypot(b[0]-walkApproach[0],b[1]-walkApproach[1]));
 const walkStart=paths.slice(0,8).map(p=>routeAround(p,walkApproach,boxes,.35)).find((p):p is Pt[]=>!!p);if(!walkStart)return;
 const walk=[...walkStart,walkGate,landing];
 return {x,z,w:HILLS.width,d:HILLS.depth,road,walk,drive:[entry,[x+1,z+6.5],[x+4.5,z+6.5],[x+4.5,z+5.5]],promenade:[landing,[x+HILLS.walkGateX,z+16],[x+13,z+16],[x+13,z+12.5]]};
}
