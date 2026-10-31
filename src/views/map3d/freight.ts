import {ACCESS,planHighwayAccess,type HighwayAccess} from "./highwayAccess";
import {routeAround} from "./routing";
import {airportCargoPoint,airportFootprint} from "./airport";
import {pathClear,type CarBridge,type Box} from "./roads";
import {HIGHWAY,roundedRoad,lanePath,roadWidthAt,roadIntersections,distanceToRoad,closedRoadArc} from "./highway";
import {cityPerimeter,type CompactParcels} from './cityPerimeter';
import type {Scene3D} from "./scene";
import type {VehiclePlan,Leg,Pt} from "./vehicles";
export const FREIGHT_SPEED={city:.55,highway:1.1,transition:2} as const;
/** Ease speed down across the approach instead of carrying highway speed into town. */
export function freightSpeed(point:Pt,highway:Pt[]):number{
 const blend=Math.max(0,Math.min(1,(distanceToRoad(point,highway)-.45)/FREIGHT_SPEED.transition));
 return FREIGHT_SPEED.highway+(FREIGHT_SPEED.city-FREIGHT_SPEED.highway)*blend;
}
/** How close (centre to centre) a freight point may run to a district street before it joins it. */
export const FREIGHT_STREET_SNAP=1;
/** Turning radius where the truck joins or leaves a shared street, so a whole semi stays on the road. */
export const FREIGHT_STREET_TURN=.9;
/** Snap points that hug a street onto it, keep one entry and one exit per shared run, and report those joins. */
export function snapToStreets(route:Pt[],streets:Pt[][],snap:number):{route:Pt[];joins:Pt[]}{
 if(!streets.length)return {route,joins:[]};
 const project=(p:Pt):Pt|undefined=>{let best:Pt|undefined,dist=snap;for(const st of streets)for(let i=1;i<st.length;i++){const a=st[i-1],b=st[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1))),q:Pt=[a[0]+dx*t,a[1]+dz*t],d=Math.hypot(p[0]-q[0],p[1]-q[1]);if(d<dist){dist=d;best=q;}}return best;};
 const out:Pt[]=[],joins:Pt[]=[];let run:Pt[]=[];
 const flush=()=>{if(!run.length)return;out.push(run[0]);if(run.length>1)out.push(run[run.length-1]);joins.push(run[0],run[run.length-1]);run=[];};
 for(const p of route){const q=project(p);if(q)run.push(q);else{flush();out.push(p);}}
 flush();
 return {route:out.filter((p,i)=>!i||Math.hypot(p[0]-out[i-1][0],p[1]-out[i-1][1])>1e-6),joins:joins.filter((p,i,a)=>a.findIndex(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<1e-6)===i)};
}
/** Round only the corners at street joins; the rest of the route already carries its own curves. */
export function roundJoins(route:Pt[],joins:Pt[],radius:number):Pt[]{
 const out:Pt[]=[];
 for(let i=0;i<route.length;i++){const p=route[i];
  if(i>0&&i<route.length-1&&joins.some(j=>Math.hypot(j[0]-p[0],j[1]-p[1])<1e-6)){
   const a=route[i-1],b=route[i+1],r=Math.min(radius,Math.hypot(p[0]-a[0],p[1]-a[1])*.45,Math.hypot(b[0]-p[0],b[1]-p[1])*.45);
   out.push(...roundedRoad([a,p,b],r).slice(1,-1));
  }else out.push(p);
 }
 return out.filter((p,i)=>!i||Math.hypot(p[0]-out[i-1][0],p[1]-out[i-1][1])>1e-6);
}
export interface FreightPlan {lot:{x:number;z:number};route:Pt[];
 /** District streets the truck shares; route segments on them are not drawn a second time. */
 streets?:Pt[][];highway:Pt[];cityAccess:Pt[];exits:Pt[];truck:VehiclePlan;localJunctions:Pt[];land:{x:number;z:number;w:number;d:number}[];access:HighwayAccess[]}
/** Plan once, routing around building footprints; the rendered road shares these exact points. */
export function planFreight(scene:Pick<Scene3D,"airport"|"towers"|"kiosks"|"retail"|"stadium"> & {compactParcels?:CompactParcels;reserved?:Box[];connections?:{id?:string;road:Pt[];frontage?:Pt[]}[];carBridges?:CarBridge[];streets?:Pt[][];land?:{x:number;z:number;w:number;d:number}[];fountains?:{x:number;z:number;k?:number}[]}):FreightPlan|undefined {
 const a=scene.airport,canva=scene.kiosks.find(k=>k.name.toLowerCase()==="canva");
 if(!a||!canva)return;
 const obstacles=[...scene.towers.map(t=>({x:t.x,z:t.z,w:t.size,d:t.size})),...scene.kiosks.map(k=>({x:k.x,z:k.z,w:k.size,d:k.size})),...scene.retail.map(k=>({x:k.x,z:k.z,w:k.size,d:k.size}))];
 obstacles.push(...(scene.reserved??[]));
 obstacles.push(...(scene.fountains??[]).map(f=>({x:f.x,z:f.z,w:.8*(f.k??1),d:.8*(f.k??1)})));
 const clear=(x:number,z:number,margin=.45)=>!obstacles.some(o=>Math.abs(x-o.x)<o.w/2+margin&&Math.abs(z-o.z)<o.d/2+margin);
 let lot:Pt|undefined;
 for(const dz of [0,1.5,-1.5,3,-3])for(const dx of [1.7,2.3,3])if(!lot&&clear(canva.x-canva.size/2-dx,canva.z+dz,1.5))lot=[canva.x-canva.size/2-dx,canva.z+dz];
 if(!lot)return;
 const target:Pt=airportCargoPoint(a);
 const land=scene.land??[{x:Math.min(lot[0],target[0])-2,z:Math.min(lot[1],target[1])-2,w:Math.abs(lot[0]-target[0])+4,d:Math.abs(lot[1]-target[1])+4}];
 const left=Math.min(...land.map(r=>r.x))-ACCESS.setback,right=Math.max(...land.map(r=>r.x+r.w),...obstacles.map(o=>o.x+o.w/2))+ACCESS.setback,top=Math.min(...land.map(r=>r.z))-ACCESS.setback,bottom=Math.max(...land.map(r=>r.z+r.d))+ACCESS.setback;
 const perimeter=cityPerimeter({left,right,top,bottom},scene.compactParcels),highway=perimeter.route;
 const findPath=(from:Pt,to:Pt,margin=HIGHWAY.width/2+.8)=>routeAround(from,to,obstacles,margin);
 // A short city collector reaches the nearest northern edge, then curves into the perimeter.
 const mergeX=Math.max(perimeter.northWest+HIGHWAY.cornerRadius+4,Math.min(right-HIGHWAY.cornerRadius-4,lot[0]-3));
 const leftRuns=highway.slice(1).flatMap((p,i)=>Math.abs(p[0]-left)<.001&&Math.abs(highway[i][0]-left)<.001?[[Math.min(p[1],highway[i][1]),Math.max(p[1],highway[i][1])]]:[]);
 const entryZ=leftRuns.map(([lo,hi])=>Math.max(lo+.1,Math.min(hi-.1,a.z+20))).sort((x,y)=>Math.abs(x-a.z-20)-Math.abs(y-a.z-20))[0];if(entryZ===undefined)return;
 const exit:Pt=[mergeX,top],entry:Pt=[left,entryZ],apron:Pt=[target[0],entryZ];
 const outbound=findPath(lot,[mergeX+3,top+3]);if(!outbound)return;
 const sharedHighway=closedRoadArc(highway,exit,entry);if(sharedHighway.length<2)return;
 const safe=(path:Pt[])=>path.slice(1).every((b,i)=>{const a=path[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.1);return Array.from({length:n+1},(_,j)=>clear(a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n,roadWidthAt(path,i+1)/2+.03)).every(Boolean);});
 const routed=[HIGHWAY.cornerRadius,1.5].map(r=>[...roundedRoad([...outbound,[mergeX+3,top],exit],r),...sharedHighway.slice(1,-1),...roundedRoad([sharedHighway[sharedHighway.length-2],entry,apron,target],r).slice(1)]).find(safe);if(!routed)return;
 // A truck that runs beside a district street drives on that street instead of on a second,
 // overlapping road: points that hug it snap onto it, and the run between joins is one straight.
 const streets=scene.streets??[],snapped=snapToStreets(routed,streets,FREIGHT_STREET_SNAP),shared={...snapped,route:roundJoins(snapped.route,snapped.joins,FREIGHT_STREET_TURN)};
 const route=shared.route.length>1&&safe(shared.route.filter(p=>streets.every(st=>distanceToRoad(p,st)>1e-6)))?shared.route:routed;
 const streetJoins=route===shared.route?shared.joins:[];
 // A short branch joins an existing district street; freight itself uses the wider service road.
 const candidates=(scene.carBridges??[]).flatMap(b=>b.roads).flatMap(path=>path.slice(1).flatMap((b,i)=>{
  const a=path[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((lot![0]-a[0])*dx+(lot![1]-a[1])*dz)/(dx*dx+dz*dz||1)));
  const p:Pt=[a[0]+dx*t,a[1]+dz*t];return [[lot!,[p[0],lot![1]] as Pt,p],[lot!,[lot![0],p[1]] as Pt,p]];
 }));
 const ordered=candidates.sort((a,b)=>distance(a)-distance(b));
 const cityAccess=ordered.find(p=>pathClear(p,obstacles,.26))??ordered.slice(0,4).map(p=>findPath(lot!,p[p.length-1],.26)).find((p):p is Pt[]=>!!p)??[];
 function distance(p:Pt[]){return p.slice(1).reduce((sum,b,i)=>sum+Math.hypot(b[0]-p[i][0],b[1]-p[i][1]),0);}

 const airportLand=airportFootprint(a),stadium=scene.stadium;
 const access=planHighwayAccess(highway,scene.connections??[],[...obstacles,{x:airportLand.x+airportLand.w/2,z:airportLand.z+airportLand.d/2,w:airportLand.w,d:airportLand.d},...(stadium?[{x:stadium.x+stadium.w/2,z:stadium.z+stadium.d/2,w:stadium.w,d:stadium.d}]:[])]);
 const freightMouths=route.filter((p,i)=>distanceToRoad(p,highway)<.001&&((i>0&&distanceToRoad(route[i-1],highway)>.001)||(i+1<route.length&&distanceToRoad(route[i+1],highway)>.001)));
 const legs:Leg[]=[];const hold=(p:Pt)=>legs.push({a:p,b:p,ya:.03,yb:.03,dur:8,hold:true});hold(lanePath(route)[0]);
 const drive=(path:Pt[])=>{for(let i=1;i<path.length;i++)legs.push({a:path[i-1],b:path[i],ya:.03,yb:.03,dur:Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1])/freightSpeed([(path[i][0]+path[i-1][0])/2,(path[i][1]+path[i-1][1])/2],highway),hold:false});};drive(lanePath(route));hold(route[route.length-1]);drive(lanePath([...route].reverse()));
 return {lot:{x:lot[0],z:lot[1]},route,streets,highway,cityAccess,land,access,localJunctions:[...streetJoins,...access.map(a=>a.junction),...access.flatMap(a=>roadIntersections(a.collector,route)),...[...(scene.carBridges??[]).flatMap(b=>b.roads.flatMap(p=>roadIntersections(route,p))),...(scene.connections??[]).flatMap(l=>roadIntersections(route,l.road))]],exits:[...access.flatMap(a=>a.mouths),...freightMouths,...(scene.connections??[]).flatMap(l=>roadIntersections(highway,l.road))],truck:{id:"canva-airport-freight",kind:"semi",color:"#294237",legs,period:legs.reduce((n,l)=>n+l.dur,0),offset:0}};
}
