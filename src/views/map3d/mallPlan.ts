import type {Rect,Scene3D} from './scene';
import type {Pt} from './roads';

export const MALL_KEY='service:atlas-marketplace';
/**
 * Atlas Marketplace: a low wave-style mall (stacked curving floors wrapped in white fins) on the
 * open lot between the Skyline park and the Hills boulevard. Sizes are in map units. Floors are as
 * tall as the Atlas Hills mansion's (1.6), so four of them stand twice its height on about its footprint.
 */
export const MALL={levels:4,floor:1.6,slab:.1,gap:.35,openingHalf:.78,segments:40,outerFinStep:.15,innerFinStep:.24,maxW:12.4,maxD:11.6,plantStep:.95,canopyR:1.5} as const;

/** One planned shop per sellable service. Status is never shown as live until the service is. */
export interface MallShop {id:string;name:string;status:'planned'|'vacant';offer:string;doc?:string}
export const MALL_SHOPS:MallShop[]=[
 {id:'skyline-inquiry-assistant',name:'Skyline Inquiry Assistant',status:'planned',offer:'Website form to inbox, inquiry log and owner alerts. Proposed pilot: $750 setup, $149/month.',doc:'docs/skyline-inquiry-assistant.md'},
 {id:'unit-2',name:'Unit 2',status:'vacant',offer:'Open for the next sellable agent.'},
 {id:'unit-3',name:'Unit 3',status:'vacant',offer:'Open for the next sellable agent.'},
 {id:'unit-4',name:'Unit 4',status:'vacant',offer:'Open for the next sellable agent.'},
];

export interface MallPlan extends Rect {
 /** Centre of the horseshoe; the open side faces +z, onto the plaza. */
 cx:number;cz:number;rx:number;rz:number;
 plaza:Rect;fountain:{x:number;z:number;r:number};
}

type Input=Pick<Scene3D,'parks'|'land'|'towers'|'kiosks'|'retail'>&{hills?:Rect;links:{id?:string;road:Pt[]}[];
 /** Every drivable road, so the lot stops short of any that crosses it. */
 roads?:Pt[][]};
/** Half a road plus its sidewalk: how far the lot stays back from a road's centre line. */
const ROAD_CLEAR=.95;

const inside=(r:Rect,x:number,z:number)=>x>=r.x-1e-6&&x<=r.x+r.w+1e-6&&z>=r.z-1e-6&&z<=r.z+r.d+1e-6;

/**
 * The open lot east of the Skyline park, west of the Hills boulevard and north of Atlas Hills.
 * Returns nothing if that lot is not there or not clear, so the map never draws a mall on top of
 * something else.
 */
export function planMall(s:Input):MallPlan|undefined{
 const park=s.parks.find(p=>p.label==='Skyline');
 const boulevard=s.links.find(l=>l.id==='hills-city-boulevard');
 if(!park||!boulevard||!s.hills)return;
 // The boulevard's long north-south run is the lot's east edge.
 const xs=boulevard.road.slice(1).flatMap((b,i)=>{const a=boulevard.road[i];return Math.abs(a[0]-b[0])<1e-6&&Math.abs(a[1]-b[1])>4?[a[0]]:[];});
 if(!xs.length)return;
 const east=Math.min(...xs)-1.2,west=park.x+park.w+MALL.gap;
 // The green east of the park may reach further north than the park (MALL_LOT); start from it.
 const green=s.land.find(r=>Math.abs(r.x-(park.x+park.w))<.01&&r.z<park.z-.01);
 const north=green?green.z:park.z-.6;let south=s.hills.z-.45;
 // A road running across the lot (the highway's local collector does) ends the lot on its near side.
 for(const road of s.roads??[])for(let i=1;i<road.length;i++){
  const [a,b]=[road[i-1],road[i]];
  if(Math.abs(a[1]-b[1])<1e-6&&Math.max(a[0],b[0])>west&&Math.min(a[0],b[0])<east&&a[1]>north&&a[1]-ROAD_CLEAR<south)south=a[1]-ROAD_CLEAR;
 }
 if(east-west<6.5||south-north<8)return;
 // A bigger lot (other map groupings) gets the same-size mall, centred, not a bigger one.
 const w=Math.min(east-west,MALL.maxW),d=Math.min(south-north,MALL.maxD);
 const lot={x:(west+east-w)/2,z:south-d,w,d};
 // Every corner must be on land, and no building may stand in the lot.
 const corners:[number,number][]=[[lot.x,lot.z],[lot.x+w,lot.z],[lot.x,lot.z+d],[lot.x+w,lot.z+d],[lot.x+w/2,lot.z+d/2]];
 if(!corners.every(([x,z])=>s.land.some(r=>inside(r,x,z))))return;
 if([...s.towers,...s.kiosks,...s.retail].some(b=>b.x+b.size/2>lot.x&&b.x-b.size/2<lot.x+w&&b.z+b.size/2>lot.z&&b.z-b.size/2<lot.z+d))return;
 const plazaD=2.3,bd=d-plazaD;
 const rx=w/2-.1,rz=bd/2-.05;
 const plaza={x:lot.x+.3,z:lot.z+bd,w:w-.6,d:plazaD};
 return {...lot,cx:lot.x+w/2,cz:lot.z+bd/2,rx,rz,plaza,fountain:{x:lot.x+w/2,z:plaza.z+1.45,r:.42}};
}

/** Outer and inner edge of one floor. Floors drift in and out, which makes the planted terraces. */
export function mallFloor(p:Pick<MallPlan,'cx'|'cz'|'rx'|'rz'>,level:number){
 const n=MALL.segments,a0=Math.PI/2+MALL.openingHalf,a1=Math.PI/2+2*Math.PI-MALL.openingHalf;
 const outer:Pt[]=[],inner:Pt[]=[];
 for(let i=0;i<=n;i++){
  const t=a0+(a1-a0)*i/n;
  // Ends taper so each wing finishes in a rounded nose instead of a cut.
  const end=Math.min(1,Math.min(i,n-i)/4);
  const out=.97-.075*level+.06*Math.sin(t*1.5+1.3+level*1.25)+.03*Math.sin(t*3+level);
  const inn=.52+.04*Math.sin(t*2+level*.9);
  const k=inn+(out-inn)*(.35+.65*Math.sqrt(end));
  outer.push([p.cx+Math.cos(t)*p.rx*k,p.cz+Math.sin(t)*p.rz*k]);
  inner.push([p.cx+Math.cos(t)*p.rx*inn,p.cz+Math.sin(t)*p.rz*inn]);
 }
 return {outer,inner};
}

/** Points every `step` along a polyline, with the heading at each. */
export function along(line:Pt[],step:number){
 const out:{x:number;z:number;a:number;u:number}[]=[];let carry=0,u=0;
 for(let i=1;i<line.length;i++){
  const [ax,az]=line[i-1],[bx,bz]=line[i],len=Math.hypot(bx-ax,bz-az),a=Math.atan2(bz-az,bx-ax);
  let t=carry;
  while(t<len){out.push({x:ax+(bx-ax)*t/len,z:az+(bz-az)*t/len,a,u:u+t});t+=step;}
  carry=t-len;u+=len;
 }
 return out;
}

export interface MallFin {x:number;z:number;y:number;h:number;a:number}
/** The white fin skin. The bottom of each fin band rises and falls, so a floor reads as a wave. */
export function mallFins(p:Pick<MallPlan,'cx'|'cz'|'rx'|'rz'>,y0:number):MallFin[]{
 const fins:MallFin[]=[];
 for(let l=0;l<MALL.levels;l++){
  const {outer,inner}=mallFloor(p,l),top=y0+(l+1)*MALL.floor+MALL.slab;
  for(const [line,step,phase] of [[outer,MALL.outerFinStep,0],[inner,MALL.innerFinStep,2]] as const)
   for(const f of along(line,step)){const h=MALL.floor*(.68+.3*Math.sin(f.u*.75+l*1.7+phase));fins.push({x:f.x,z:f.z,a:f.a,y:top-h,h});}
 }
 return fins;
}

/** Every instanced piece the mall draws; held to a budget in mallPlan.test.ts. */
export function mallPieceCount(p:MallPlan,y0=0){
 const plants=Array.from({length:MALL.levels},(_,l)=>along(mallFloor(p,l).outer,MALL.plantStep).length).reduce((a,b)=>a+b,0);
 return mallFins(p,y0).length+plants+MALL_FIXED_PIECES;
}
/** Plaza, fountain, canopy, sign, entrance and ramp pieces. */
export const MALL_FIXED_PIECES=14;
