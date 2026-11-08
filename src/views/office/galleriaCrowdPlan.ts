import {GALLERIA,GALLERIA_ATRIUM_LINE,GALLERIA_BASEMENT,GALLERIA_VALLEYS,insidePoly,slabOutline} from '../map3d/galleriaPlan';
import type {Pt} from '../map3d/roads';
import type {CrowdPerson} from './agencyCrowdPlan';
import type {P3} from './agencyInteriorPlan';

/**
 * Shoppers inside the Atlas Galleria (KC, 2026-11-08): loops round the funnel atrium on every
 * shopping floor, people coming in from the main entrance, and drivers walking from the basement
 * car park to the lift core. Plan metres in, interior units out; a pose is a pure function of time.
 * Illustrations of a planned building, not running agents.
 */
const SHIRTS=['#346583','#a18455','#6d875e','#846798','#ab6355','#c9a35a','#3f5f6b','#8c3b52'];
const LIFT:Pt=[50,52];

/** A loop round the atrium edge (or round the column on the ground floor), radius in plan metres. */
function ring(level:number,grow:number,n:number,offset:number):Pt[]{
 const line=GALLERIA_ATRIUM_LINE,cx=line.reduce((s,p)=>s+p[0],0)/line.length,cy=line.reduce((s,p)=>s+p[1],0)/line.length;
 if(level===1){const [x,y]=GALLERIA.column;return Array.from({length:n},(_,i):Pt=>{const t=(i/n)*Math.PI*2+offset;return [x+Math.cos(t)*grow,y+Math.sin(t)*grow];});}
 return Array.from({length:n},(_,i):Pt=>{const p=line[Math.floor(((i/n+offset/(Math.PI*2))%1)*line.length)],dx=p[0]-cx,dy=p[1]-cy,l=Math.hypot(dx,dy)||1;return [p[0]+dx/l*grow,p[1]+dy/l*grow];});
}
const plate=(level:number)=>level===0?GALLERIA_BASEMENT:slabOutline(level-1);

/**
 * People for one floor (0 basement, 1 ground, 2, 3) at floor height y. `toIn` maps plan metres to
 * interior x/z. Points that fall outside the floor plate are dropped, so nobody walks on air.
 */
export function planGalleriaCrowd(level:number,y:number,toIn:(p:Pt)=>Pt):CrowdPerson[]{
 const on=(p:Pt)=>insidePoly(plate(level),p),at=(p:Pt):P3=>{const [x,z]=toIn(p);return [x,y,z];};
 const people:CrowdPerson[]=[];
 const add=(id:string,pts:Pt[],speed:number,phase:number,dwellAt:number[]=[])=>{
  const path=pts.filter(on);if(!path.length)return;
  people.push({id:`galleria-${level}-${id}`,level,color:SHIRTS[(people.length*3+level)%SHIRTS.length],pose:path.length>1?'walk':'stand',path:path.map(at),dwell:path.map((_,i)=>dwellAt.includes(i)?2.5:0),speed,phase});
 };
 if(level===0){
  // Drivers from the parking bays to the lift core and back.
  add('driver-a',[[18,14],[18,44],[LIFT[0]-2,LIFT[1]-3]],1.1,0,[0,2]);
  add('driver-b',[[64,12],[64,40],[LIFT[0]+2,LIFT[1]-3]],1.1,7,[0,2]);
  add('waiting',[[LIFT[0]-1.5,LIFT[1]-3.5]],1,0);
  return people;
 }
 const loops=level===1?[[9,1.2],[13,1]]:[[3.5,1.1],[3.5,.9],[5.5,1]];
 loops.forEach(([grow,speed],i)=>add(`loop-${i}`,ring(level,grow,12,i*2.1),speed,i*5,[0,6]));
 // Standing at the atrium rail, window shopping.
 ring(level,level===1?11:2.4,6,.6).slice(0,level===1?2:3).forEach((p,i)=>add(`rail-${i}`,[p],1,0));
 if(level===1){
  // In from the main entrance to the atrium and back out.
  const [ex,ey]=GALLERIA_VALLEYS[0],[cx,cy]=GALLERIA.column;
  add('arrive',[[ex+3,ey+1],[cx-9,cy-2],[cx-9,cy+6]],1.2,3,[0,2]);
  add('leave',[[cx-10,cy+3],[ex+3.5,ey+3]],1.15,11,[0,1]);
 }
 return people;
}
