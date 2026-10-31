import {financialDimensions,financialHeight} from './financialArchitecture';
import {financialBrand} from "./financialBrands";
import type {Rect,Scene3D} from './scene';
import type {Pt} from './roads';
import {distanceToRoad} from './highway';
import {airportFootprint} from './airport';
import {routeAround} from './routing';
import {CITY_SPACING,cityEnvelope} from './citySpacing';
import {CIRCA} from './circaPlan';
export const FINANCIAL_PARK_KEY='service:financial-park';
export const FINANCIAL_KEY='service:financial-district';
export const financialKey=(id:string)=>`service:financial:${id}`;
export const FINANCIAL={width:44,originalWidth:20,expansion:24,depth:15,streetZ:12.7,northWalkZ:11.95,promenadeZ:14.1,towerWidth:3,towerDepth:2.6,crossings:[10,20,34],parkTreeRadius:.65,perimeterTreeRadius:.6,park:{x:15.5,z:2.3,w:9,d:9.3}} as const;
const BUILDING_LAYOUT=[
 {id:'banks',name:'Banks',x:4,z:4,rise:1.32,style:'glass',role:'Account Review Analyst',purpose:'Planned read-only account overview from local statements or approved aggregated data.'},
 {id:'residence',name:'Residence',x:3.5,z:9,rise:1.24,style:'balcony',role:'Residence Planning Coordinator',purpose:'Planned residential spaces and household financial planning.'},
 {id:'budget',name:'Spending & Budget',x:14.5,z:9.5,rise:1.08,style:'stepped',role:'Budget Review Analyst',purpose:'Planned spending categories, budgets and variance reviews from local imports.'},
 {id:'investments',name:'Investments',x:9.8,z:6.8,rise:1.48,style:'crown',role:'Investment Records Analyst',purpose:'Planned read-only holdings and statement summaries. No trading or money movement.'},
 {id:'records',name:'Bills & Records',x:15.7,z:4.3,rise:1.12,style:'articulated',role:'Bills & Records Coordinator',purpose:'Planned subscription, bill, tax and receipt organization. No automatic payments.'},
 {id:'insurance',name:'Insurance',x:-20,z:4,rise:1.18,style:'articulated',role:'Insurance Records Analyst',purpose:'Planned local policy, coverage and renewal records. No purchases or provider messaging.'},
 {id:'business-finance',name:'Business Finance',x:-13,z:4.2,rise:1.35,style:'glass',role:'Business Finance Analyst',purpose:'Planned read-only business cash-flow and statement reviews from local imports.'},
 {id:'financial-planning',name:'Financial Planning',x:-20,z:9,rise:1.1,style:'stepped',role:'Financial Planning Analyst',purpose:'Planned budgeting and scenario reviews. No transactions or investment execution.'},
 {id:'harbor-residence',name:'Harbor Residence',x:-12.5,z:9.2,rise:1.22,style:'balcony',role:'Harbor Residence Coordinator',purpose:'Planned residential and household organization spaces. No financial services connected.'},
 // West waterfront parcel by the highway; already district-local, so no expansion offset.
 {id:'circa',name:'Circa',x:CIRCA.x-FINANCIAL.expansion,z:CIRCA.z,rise:CIRCA.rise,style:'twin',role:'Residential Amenities Planning Coordinator',purpose:'Planned twin-tower residence.'},
] as const;
export const FINANCIAL_BUILDINGS=BUILDING_LAYOUT.map(b=>{const brand=financialBrand(b.id);return {...b,name:brand?.name??b.name,role:brand?.role??b.role,purpose:brand?.purpose??b.purpose};});
export interface FinancialPark extends Rect {paths:Pt[][];pool:Rect;trees:Pt[];benches:Pt[];lights:Pt[]}
export function financialPark():FinancialPark{return {...FINANCIAL.park,
 paths:[[[21.8,FINANCIAL.northWalkZ],[21.8,2.75]],[[15.95,2.75],[24.05,2.75],[24.05,11.15],[15.95,11.15],[15.95,2.75]],[[15.95,8.3],[24.05,8.3]],[[18.6,8.3],[18.6,9.1]],[[24.05,6.8],[23.6,6.8]]],
 pool:{x:17.8,z:4.6,w:2.6,d:1.5},trees:[[17.2,3.95],[23,4.2],[17.2,9.7],[23,9.7]],benches:[[18.6,9.5],[23,6.8]],lights:[[16.8,7.4],[23.2,10.6],[20.8,3.5],[20.8,10.7]]};}
/** Circa's waterfront parcel, world coordinates, joined to the district's west edge. */
export interface CircaSite extends Rect {street:Pt[];sidewalk:Pt[]}
export interface FinancialPlan extends Rect {circa?:CircaSite;perimeterTrees:Pt[];park:FinancialPark;originalX:number;referenceHeight:number;road:Pt[];walk:Pt[];street:Pt[];sidewalk:Pt[];buildings:(Omit<typeof FINANCIAL_BUILDINGS[number],'x'>&{x:number;height:number;approach:Pt[]})[]}
/** Conservative live tower envelope includes every existing crown style, including HQ spires. */
export function headquartersEnvelope(towers:Scene3D['towers']){
 return Math.max(1,...towers.map(t=>t.height+.27+Math.max(2.1,.42+t.size*.5,t.size*.3+.45,1.4)));
}
export function planFinancial(s:Pick<Scene3D,'stadium'|'land'|'towers'|'kiosks'|'retail'|'airport'|'terraces'|'carBridges'|'paving'>&{coreLand?:Rect[]}):FinancialPlan|undefined{
 const stadium=s.stadium;if(!stadium)return;
 const core=cityEnvelope(s.coreLand??s.terraces);if(!core)return;
 const w=FINANCIAL.width,d=FINANCIAL.depth,x=core.x-CITY_SPACING.financialWestOffset,originalX=x+FINANCIAL.expansion;
 const z=Math.min(core.z,stadium.z-2)-d-CITY_SPACING.gap;
 const park=financialPark();
 if(s.land.some(r=>x<r.x+r.w&&x+w>r.x&&z<r.z+r.d&&z+d>r.z))return;
 const site={x:x-CIRCA.siteWidth,z,w:CIRCA.siteWidth,d},westFree=!s.land.some(r=>site.x<r.x+r.w&&site.x+site.w>r.x&&site.z<r.z+r.d&&site.z+site.d>r.z);
 const referenceHeight=headquartersEnvelope(s.towers),buildings=FINANCIAL_BUILDINGS.filter(b=>b.id!=='circa'||westFree).map(b=>({...b,x:b.x+FINANCIAL.expansion,height:financialHeight(b.id,referenceHeight,b.rise),approach:[] as Pt[]}));
 // Circa stays the district's tallest however tall the headquarters (and so the others) grow.
 const twin=buildings.find(b=>b.id==='circa');if(twin)twin.height=Math.max(twin.height,...buildings.filter(b=>b!==twin).map(b=>b.height+financialDimensions(b.id).top-financialDimensions(twin.id).top+CIRCA.lead));
 const blocks=[...s.towers,...s.kiosks,...s.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
 blocks.push({x:stadium.x+stadium.w/2,z:stadium.z+stadium.d/2,w:stadium.w,d:stadium.d});
 if(s.airport){const r=airportFootprint(s.airport);blocks.push({x:r.x+r.w/2,z:r.z+r.d/2,w:r.w,d:r.d});}
 const towerBoxes=buildings.map(b=>({x:x+b.x,z:z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d}));
 for(let i=0;i<buildings.length;i++){const b=buildings[i];b.approach=routeAround([x+b.x,z+b.z+financialDimensions(b.id).d/2+.35],[x+b.x,z+FINANCIAL.northWalkZ],towerBoxes.filter((_,j)=>i!==j),.35)??[];if(!b.approach.length)return;}
 const perimeterTrees:Pt[]=[];
 for(const offset of [0,FINANCIAL.expansion])for(const [px,pz]of [[1.2,1.4],[7.7,2],[18.6,2],[1,10.8],[7,10.8],[13,10.8],[18.7,10.9]]){
  const local:Pt=[px+offset,pz],world:Pt=[x+local[0],z+local[1]],radius=FINANCIAL.perimeterTreeRadius;
  if(local[0]>park.x-radius&&local[0]<park.x+park.w+radius)continue;
  if(Math.abs(pz-FINANCIAL.northWalkZ)<radius+.35)continue;
  if(towerBoxes.some(b=>Math.abs(world[0]-b.x)<b.w/2+radius+.1&&Math.abs(world[1]-b.z)<b.d/2+radius+.1))continue;
  if(buildings.some(b=>distanceToRoad(world,b.approach)<radius+.35))continue;
  perimeterTrees.push(local);
 }
 blocks.push(...towerBoxes);
 // Join the nearest original local street, rather than a long stadium-side detour.
 const streets=s.carBridges.flatMap(b=>b.roads).flat().sort((a,b)=>a[1]-b[1]);
 const access=streets[0];if(!access)return;
 const entry:Pt=[Math.max(x+.6,Math.min(x+w-.6,access[0])),z+FINANCIAL.streetZ],walkEntry:Pt=[entry[0]+.9,z+FINANCIAL.promenadeZ];
 const road=routeAround(access,entry,blocks,.4);
 const paths=s.paving.map(p=>[p.x+p.w/2,p.z+p.d/2] as Pt).sort((a,b)=>Math.hypot(a[0]-walkEntry[0],a[1]-walkEntry[1])-Math.hypot(b[0]-walkEntry[0],b[1]-walkEntry[1]));
 const walk=paths.slice(0,8).map(p=>routeAround(p,walkEntry,blocks,.35)).find((p):p is Pt[]=>!!p);if(!road||!walk)return;
 const circa:CircaSite|undefined=westFree?{...site,street:[[x+.6,z+FINANCIAL.streetZ],[x-CIRCA.siteWidth+.5,z+FINANCIAL.streetZ]],sidewalk:[[x+.6,z+FINANCIAL.promenadeZ],[x-CIRCA.siteWidth+.4,z+FINANCIAL.promenadeZ]]}:undefined;
 return {x,z,w,d,circa,perimeterTrees,park,originalX,referenceHeight,buildings,road,walk,street:[[x+w-.6,entry[1]],entry,[x+.6,entry[1]]],sidewalk:[[x+.6,walkEntry[1]],walkEntry,[x+w-.6,walkEntry[1]]]};
}
