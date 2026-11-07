import type {Scene3D} from './scene';
import type {FreightPlan} from './freight';
import type {Pt,Leg} from './vehicles';
import {airportCargoPoint} from './airport';
import {routeAround} from './routing';
import {pathClear,type Box} from './roads';
import {roundedRoad,lanePath,roadIntersections} from './highway';
import {TRANSPORT} from './transportScale';

/** Local logistics: one shared service street, no perimeter highway or access ramps. */
export function planLocalFreight(s:Pick<Scene3D,'airport'|'towers'|'kiosks'|'retail'|'land'|'carBridges'|'stadium'|'fountains'> & {reserved:Box[];connections:{road:Pt[]}[]}):FreightPlan|undefined{
 const canva=s.kiosks.find(k=>k.name.toLowerCase()==='canva');if(!canva||!s.airport)return;
 const blocks=[...s.towers,...s.kiosks,...s.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size})).concat(s.reserved);
 const lot=[0,1.5,-1.5,3,-3].flatMap(dz=>[1.7,2.3,3].map(dx=>[canva.x-canva.size/2-dx,canva.z+dz] as Pt)).find(p=>pathClear([p,p],blocks,1.5));
 if(!lot)return;
 const target=airportCargoPoint(s.airport),raw=routeAround(lot,target,blocks,1.1);if(!raw)return;
 const route=roundedRoad(raw,1.5);if(!pathClear(route,blocks,.5))return;
 const streets=[...s.carBridges.flatMap(b=>b.roads),...s.connections.map(c=>c.road)];
 const joins=streets.flatMap(st=>st.slice(1).map((b,i)=>{const a=st[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((lot[0]-a[0])*dx+(lot[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return [a[0]+dx*t,a[1]+dz*t] as Pt;})).sort((a,b)=>Math.hypot(a[0]-lot[0],a[1]-lot[1])-Math.hypot(b[0]-lot[0],b[1]-lot[1]));
 let cityAccess:Pt[]=[];for(const join of joins.slice(0,8)){const path=routeAround(lot,join,blocks,.4);if(path){cityAccess=path;break;}}
 const legs:Leg[]=[];
 const drive=(path:Pt[])=>{const lane=lanePath(path,TRANSPORT.cityLaneOffset);legs.push({a:lane[0],b:lane[0],ya:.03,yb:.03,dur:8,hold:true});for(let i=1;i<lane.length;i++)legs.push({a:lane[i-1],b:lane[i],ya:.03,yb:.03,dur:Math.hypot(lane[i][0]-lane[i-1][0],lane[i][1]-lane[i-1][1])/.55,hold:false});};
 drive(route);drive([...route].reverse());
 // Cross the two lanes only within the spacious loading/parking endpoints, without teleporting.
 for(let i=1;i<legs.length;i++)if(Math.hypot(legs[i].a[0]-legs[i-1].b[0],legs[i].a[1]-legs[i-1].b[1])>1e-6){const to=legs[i].a,from=legs[i-1].b;legs.splice(i,0,{a:from,b:to,ya:.03,yb:.03,dur:Math.hypot(to[0]-from[0],to[1]-from[1])/.2,hold:false});i++;}
 legs.push({a:legs[legs.length-1].b,b:legs[0].a,ya:.03,yb:.03,dur:1.6,hold:Math.hypot(legs[legs.length-1].b[0]-legs[0].a[0],legs[legs.length-1].b[1]-legs[0].a[1])<1e-6});
 return {lot:{x:lot[0],z:lot[1]},route,streets,highway:[],cityAccess,exits:[],access:[],land:s.land,localJunctions:streets.flatMap(st=>roadIntersections(route,st)),truck:{id:'canva-airport-freight',kind:'semi',color:'#294237',legs,period:legs.reduce((n,l)=>n+l.dur,0),offset:0}};
}
