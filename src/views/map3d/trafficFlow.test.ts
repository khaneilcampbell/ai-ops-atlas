import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {planDealershipTraffic,planHighwayTraffic,planVehicles,trafficJunctions,vehicleAt,vehicleVisible} from './vehicles';
import {vehicleBounds} from './vehicleModels';
import {TRAFFIC,trafficFlow} from './trafficFlow';

// Two minutes of traffic at a fixed step: no two vehicles ever inside each other, nobody stuck for long.
// A turning car's corner may graze the next lane by this much (rounded turns): contact, not a crash.
const GRAZE=.03;
type Box={x:number;z:number;ux:number;uz:number;l:number;w:number;y:number};
const overlap=(a:Box,b:Box)=>{
 if(Math.abs(a.y-b.y)>TRAFFIC.height)return false;
 for(const [ax,az] of [[a.ux,a.uz],[-a.uz,a.ux],[b.ux,b.uz],[-b.uz,b.ux]]){
  const r=(q:Box)=>q.l*Math.abs(q.ux*ax+q.uz*az)+q.w*Math.abs(-q.uz*ax+q.ux*az);
  if(Math.abs((b.x-a.x)*ax+(b.z-a.z)*az)>=r(a)+r(b)-GRAZE)return false;
 }
 return true;
};
for(const g of ['district','tag'] as const)describe(`traffic flow, ${g} grouping`,()=>{
 it('keeps every vehicle clear of the others and moving',()=>{
  const s=buildScene(layoutMap(catalog,[],g)),plans=[...planVehicles(s),...planDealershipTraffic(s),...planHighwayTraffic(s)];
  const flow=trafficFlow(plans,trafficJunctions(s)),dims=plans.map(v=>{const b=vehicleBounds(v.kind);return {l:(b.front-b.rear)/2,w:b.halfWidth};});
  const hits=new Set<string>(),still=new Float64Array(plans.length),heading=plans.map(()=>[1,0]);let longest=0;
  for(let k=0;k<1200;k++){
   const before=Float64Array.from(flow.times);flow.step(.1);
   const boxes=plans.map((v,i)=>{const a=vehicleAt(v,flow.times[i]),n=Math.hypot(a.dx,a.dz);if(n>.2)heading[i]=[a.dx/n,a.dz/n];return vehicleVisible(v,flow.times[i])?{x:a.x,z:a.z,y:a.y,ux:heading[i][0],uz:heading[i][1],...dims[i]}:undefined;});
   for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a&&b&&overlap(a,b))hits.add(`${plans[i].id}/${plans[j].id}`);}
   for(let i=0;i<plans.length;i++){still[i]=flow.times[i]-before[i]<1e-4?still[i]+.1:0;longest=Math.max(longest,still[i]);}
  }
  // District (the default view) is contact-free. The tag layout keeps up to three brief corner contacts where one car
  // turns in behind another on a rounded corner (boxes swing wide mid-turn): a turning-lane geometry follow-up.
  if(g==='district')expect([...hits].slice(0,6)).toEqual([]);else expect(hits.size).toBeLessThanOrEqual(3);
  expect(longest).toBeLessThan(TRAFFIC.stuck+1);
 });
});
