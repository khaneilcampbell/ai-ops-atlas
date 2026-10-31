import {MALL_SHOPS,mallFloor} from '../map3d/mallPlan';
import type {Pt} from '../map3d/roads';

/** Interior scale: the same horseshoe as the map building, drawn at room size. */
export const MALL_IN={rx:11,rz:9,floor:3.4,levels:4,unitsPerFloor:8,segmentsPerUnit:5} as const;
export const MALL_SHAPE={cx:0,cz:0,rx:MALL_IN.rx,rz:MALL_IN.rz};

export type UnitKind='shop'|'vacant'|'food'|'hall'|'studio'|'service';
export interface MallUnit {id:string;level:number;index:number;name:string;kind:UnitKind;note:string;
 /** Shop front (atrium side) and back wall, as edge points. */
 front:Pt[];back:Pt[]}
export interface MallLevel {level:number;title:string;summary:string}

/**
 * Floors follow the reference's section: shops around a central atrium on the ground and first
 * floors, a food court on the second, and an events floor on top, over a basement car park.
 */
export const MALL_LEVELS:MallLevel[]=[
 {level:0,title:'Ground · Client services',summary:'Entrance, information desk and the first agent shops'},
 {level:1,title:'Floor 1 · Agent shops',summary:'Open units for the next sellable agents'},
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
 if(level===1)return {name:`Unit 1${index+1}`,kind:'vacant',note:VACANT};
 if(level===2)return {name:index<4?'Food court west':'Food court east',kind:'food',note:'Shared seating. Visual only.'};
 return index>=4?{name:'Demo hall',kind:'hall',note:'Client demos of planned agents. No live events.'}:{name:`Studio 3${index+1}`,kind:'studio',note:'Prepared studio. No agents assigned yet.'};
}

/** Every unit on every floor, cut from the same curved floor plate the map draws. */
export function mallUnits():MallUnit[]{
 const out:MallUnit[]=[];
 for(let level=0;level<MALL_IN.levels;level++){
  const {outer,inner}=mallFloor(MALL_SHAPE,level),n=MALL_IN.segmentsPerUnit;
  // Shops start a corridor's width back from the atrium rail and stop short of the facade.
  const front=inner.map(([x,z],i):Pt=>[x+(outer[i][0]-x)*.3,z+(outer[i][1]-z)*.3]);
  const back=outer.map(([x,z],i):Pt=>[x+(inner[i][0]-x)*.06,z+(inner[i][1]-z)*.06]);
  for(let index=0;index<MALL_IN.unitsPerFloor;index++){
   const a=index*n,b=a+n+1;
   out.push({id:`L${level}-U${index}`,level,index,...unitName(level,index),front:front.slice(a,b),back:back.slice(a,b)});
  }
 }
 return out;
}
