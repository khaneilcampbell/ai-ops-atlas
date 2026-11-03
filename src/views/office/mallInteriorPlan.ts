import {MALL_SHOPS,MALL} from '../map3d/mallPlan';
import {marketplaceWorkspace} from './marketplaceWorkspaces';
import type {Pt} from '../map3d/roads';

/** Interior scale: the same horseshoe as the map building, drawn at room size. */
export const MALL_IN={rx:16,rz:13,floor:3.4,levels:4,unitsPerFloor:8,segmentsPerUnit:5} as const;
export const MALL_CIRCULATION={hallway:1.35,landingWidth:1.6} as const;
export const MALL_SHAPE={cx:0,cz:0,rx:MALL_IN.rx,rz:MALL_IN.rz};

export type UnitKind='shop'|'vacant'|'food'|'hall'|'studio'|'service';
export interface MallUnit {id:string;level:number;index:number;name:string;kind:UnitKind;note:string;
 /** Shop front (atrium side) and back wall, as edge points. */
 front:Pt[];back:Pt[]}
export interface MallLevel {level:number;title:string;summary:string}

/**
 * Floors follow the reference's section: shops around a central atrium on the ground and first
 * floors, a food court on the second, and an events floor on top. Stable floor and unit IDs are retained.
 */
export const MALL_LEVELS:MallLevel[]=[
 {level:0,title:'Lobby · Client services',summary:'Entrance, information desk and the first agent shops'},
 {level:1,title:'Floor 1 · Benjaire production',summary:'Assigned workspaces for existing Commerce workers'},
 {level:2,title:'Floor 2 · Food court',summary:'Seating around the atrium'},
 {level:3,title:'Floor 3 · Events and demos',summary:'Demo hall for client walk-throughs, plus studios'},
];

const VACANT='Open for the next sellable agent. Not selling.';

function unitName(level:number,index:number):{name:string;kind:UnitKind;note:string}{
 if(level===0){
  if(index===3||index===4)return {name:'Information desk',kind:'service',note:'Front desk under the canopy. Visual only.'};
  const order=[0,1,2,-1,-1,3,4,5][index];
  const shop=MALL_SHOPS[order];
  if(shop)return {name:shop.name,kind:shop.status==='planned'?'shop':'vacant',note:shop.status==='planned'?`Planned · not selling yet. ${shop.offer}`:VACANT};
  return {name:`Unit G${index+1}`,kind:'vacant',note:VACANT};
 }
 const workspace=marketplaceWorkspace(`L${level}-U${index}`);
 if(workspace)return {name:workspace.role,kind:'studio',note:`Workspace assigned · Building workflow planned. Existing worker: ${workspace.agentId}. ${workspace.deliverable}. No execution authority changed.`};
 if(level===1)return {name:`Unit 1${index+1}`,kind:'vacant',note:VACANT};
 if(level===2)return {name:index<4?'Food court west':'Food court east',kind:'food',note:'Shared seating. Visual only.'};
 return index>=4?{name:'Demo hall',kind:'hall',note:'Client demos of planned agents. No live events.'}:{name:`Studio 3${index+1}`,kind:'studio',note:'Prepared studio. No agents assigned yet.'};
}

/** Every unit on every floor, cut from the same curved floor plate the map draws. */
export function mallUnits():MallUnit[]{
 const out:MallUnit[]=[];
 for(let level=0;level<MALL_IN.levels;level++){
  const {outer,inner}=mallInteriorFloor(MALL_SHAPE,level),n=MALL_IN.segmentsPerUnit;
  // Shops start a corridor's width back from the atrium rail and stop short of the facade.
  const front=inner.map(([x,z],i):Pt=>{const dx=outer[i][0]-x,dz=outer[i][1]-z,k=Math.max(.3,MALL_CIRCULATION.hallway/Math.hypot(dx,dz));return [x+dx*k,z+dz*k];});
  const back=outer.map(([x,z],i):Pt=>[x+(inner[i][0]-x)*.06,z+(inner[i][1]-z)*.06]);
  for(let index=0;index<MALL_IN.unitsPerFloor;index++){
   const a=index*n,b=a+n+1;
   out.push({id:`L${level}-U${index}`,level,index,...unitName(level,index),front:front.slice(a,b),back:back.slice(a,b)});
  }
 }
 return out;
}

/**
 * Escalators cross the atrium in a zigzag, as in the section drawing. Each one starts on a landing
 * bridge that reaches out from one side of a floor and climbs at 30° to a bridge on the other side
 * of the floor above, clear of the funnel tree's stem (it runs in front of it, at z).
 */
export const ESCALATOR={z:3.2,width:1.1,slope:Math.PI/6,stepDepth:.4} as const;
/** Which side (−1 west, +1 east) of a floor its landing bridge reaches out from. */
export const bridgeSide=(level:number)=>level%2===0?-1:1;
export function escalatorFor(level:number){
 const run=MALL_IN.floor/Math.tan(ESCALATOR.slope),s=bridgeSide(level);
 return {level,from:s*run/2,to:-s*run/2,run,rise:MALL_IN.floor,steps:Math.round(run/ESCALATOR.stepDepth)};
}

/** Prepared lift and landing inside the atrium, clear of the escalator at z=3. */
export const MALL_LIFT={x:0,z:-5.4,width:1.6,depth:1.4,height:3.1,landingEnd:Math.min(...[-1,0,1].map(x=>landingEdge(mallInteriorFloor(MALL_SHAPE,0).inner.map(([px,pz]):Pt=>[pz,px]),x,-1)))-.35,opening:1.2} as const;
/** A full doorway replaces three front bays, rather than squeezing into one curved segment. */
export function mallDoorway(u:MallUnit){
 const middle=Math.floor((u.front.length-1)/2),a=u.front[middle-1],b=u.front[middle+2];
 return {middle,a,b,width:Math.min(1.8,Math.hypot(b[0]-a[0],b[1]-a[1])*.8)};
}

/** Intersect a floor edge with a horizontal landing strip. Rendering and rail openings share it. */
export function landingEdge(line:Pt[],z:number,side:number):number{
 for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i];
  if((z-a[1])*(z-b[1])>0||Math.abs(b[1]-a[1])<1e-8)continue;
  const x=a[0]+(b[0]-a[0])*(z-a[1])/(b[1]-a[1]);
  if(Math.sign(x)===side)return x;
 }
 throw new Error('Marketplace landing has no floor edge');
}
export function mallLandings(level:number){
 const {inner}=mallInteriorFloor(MALL_SHAPE,level),e=escalatorFor(level);
 // Intermediate floors need both arrival and departure landings.
 const sides=level===0?[bridgeSide(level)]:level===MALL_IN.levels-1?[-bridgeSide(level-1)]:[-1,1];
 return sides.map(side=>({side,from:side*(e.run/2-.4),to:side*Math.max(...[-.8,.8].map(dz=>Math.abs(landingEdge(inner,ESCALATOR.z+dz,side))))+.35*side,z:ESCALATOR.z,width:MALL_CIRCULATION.landingWidth}));
}
/** Footprint-aware furnishings, leaving the front of every room clear for entry. */
export function mallFurniture(u:MallUnit){
 const i=Math.floor(u.front.length/2),f=u.front[i],b=u.back[i];
 const depth=Math.hypot(f[0]-b[0],f[1]-b[1]);
 const width=Math.hypot(u.front[0][0]-u.front[u.front.length-1][0],u.front[0][1]-u.front[u.front.length-1][1]);
 return {depth,width,tableOffsets:width>3.4?[-.9,.9]:[0],tableDepth:-Math.min(.5,depth*.15),stageWidth:Math.min(1.6,width*.5),chairRows:Math.max(1,Math.min(2,Math.floor((depth-1.2)/.6)))};
}

/** Schematic interior has its own expanded floor plate; never changes the map exterior. */
export function mallInteriorFloor(p:{cx:number;cz:number;rx:number;rz:number},_level:number){
 const n=MALL.segments,a0=Math.PI/2+MALL.openingHalf,a1=Math.PI/2+2*Math.PI-MALL.openingHalf;
 const outer:Pt[]=[],inner:Pt[]=[];
 for(let i=0;i<=n;i++){
  const t=a0+(a1-a0)*i/n;
  // Ends taper so each wing finishes in a rounded nose instead of a cut.
  const end=Math.min(1,Math.min(i,n-i)/4);
  const out=.97+.06*Math.sin(t*1.5+1.3)+.03*Math.sin(t*3);
  const inn=.52+.04*Math.sin(t*2);
  const k=inn+(out-inn)*(.7+.3*Math.sqrt(end));
  outer.push([p.cx+Math.cos(t)*p.rx*k,p.cz+Math.sin(t)*p.rz*k]);
  inner.push([p.cx+Math.cos(t)*p.rx*inn,p.cz+Math.sin(t)*p.rz*inn]);
 }
 return {outer,inner};
}
