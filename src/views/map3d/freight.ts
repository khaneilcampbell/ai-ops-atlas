import {ACCESS,planHighwayAccess,type HighwayAccess} from "./highwayAccess";
import {routeAround} from "./routing";
import {airportCargoPoint,airportFootprint} from "./airport";
import {pathClear,type CarBridge,type Box} from "./roads";
import {TRANSPORT} from "./transportScale";
import {HIGHWAY,highwayShare,streetBlend,roundedRoad,lanePath,roadWidthAt,roadIntersections,distanceToRoad,closedRoadArc} from "./highway";
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
export const FREIGHT_STREET_TURN=1.5;
/** Wider reach for highway collectors: a parallel road this close (centre to centre) is merged into it. */
export const FREIGHT_COLLECTOR_SNAP=2.4;
/** Snap points that hug a street onto it, keep one entry and one exit per shared run, and report those joins. */
export function snapToStreets(route:Pt[],streets:Pt[][],snap:number,keepShape=false):{route:Pt[];joins:Pt[]}{
 if(!streets.length)return {route,joins:[]};
 // square: the step from the point onto the street meets it at a right angle.
 type Hit={q:Pt;street:number;at:number;p:Pt;square:boolean;dir:Pt};
 const project=(p:Pt):Hit|undefined=>{let best:Hit|undefined,dist=snap;streets.forEach((st,s)=>{let along=0;for(let i=1;i<st.length;i++){const a=st[i-1],b=st[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1))),q:Pt=[a[0]+dx*t,a[1]+dz*t],d=Math.hypot(p[0]-q[0],p[1]-q[1]);if(d<dist){dist=d;best={q,street:s,at:along+len*t,p,square:d<1e-6||Math.abs((p[0]-q[0])*dx+(p[1]-q[1])*dz)/(d*len||1)<.05,dir:[dx/(len||1),dz/(len||1)]};}along+=len;}});return best;};
 // keepShape: a shared run follows the street's own bends between the entry and exit points.
 const between=(a:Hit,b:Hit):Pt[]=>{const st=streets[a.street],out:Pt[]=[];let along=0;const inner:{p:Pt;at:number}[]=[];for(let i=0;i<st.length;i++){if(i)along+=Math.hypot(st[i][0]-st[i-1][0],st[i][1]-st[i-1][1]);if(along>Math.min(a.at,b.at)+1e-6&&along<Math.max(a.at,b.at)-1e-6)inner.push({p:st[i],at:along});}if(a.at>b.at)inner.reverse();out.push(a.q,...inner.map(v=>v.p),b.q);return out;};
 const out:Pt[]=[],joins:Pt[]=[];let run:Hit[]=[];
 // keepShape also keeps the truck's own first and last points, so it steps straight across to the
 // collector and back where its original road was clear, never cutting a diagonal through a building.
 // A run that leaves the street past one of its bends would step off on a slant the trailer swings
 // wide on; it carries straight on along the street's last heading and turns square onto the truck's
 // own road instead (see squareExit).
 const exits:{q:Pt;dir:Pt}[]=[];
 const flush=()=>{if(!run.length)return;const tail:Pt[]=[];if(keepShape)while(run.length>1&&!run[run.length-1].square)tail.unshift(run.pop()!.p);
  const first=run[0],last=run[run.length-1];if(keepShape&&first.street===last.street){out.push(first.p,...between(first,last));if(tail.length)exits.push({q:last.q,dir:last.dir});else out.push(last.p);}else{out.push(first.q);if(run.length>1)out.push(last.q);}joins.push(first.q,last.q);out.push(...tail);run=[];};
 for(const p of route){const q=project(p);if(q)run.push(q);else{flush();out.push(p);}}
 flush();
 for(const e of exits)squareExit(out,e.q,e.dir);
 return {route:out.filter((p,i)=>!i||Math.hypot(p[0]-out[i-1][0],p[1]-out[i-1][1])>1e-6),joins:joins.filter((p,i,a)=>a.findIndex(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<1e-6)===i)};
}
/**
 * From an exit point q heading dir, find the first later stretch of the route that crosses that
 * heading at a right angle (within reach), and replace the points between with one rounded corner.
 */
function squareExit(route:Pt[],q:Pt,dir:Pt,reach=4){
 const qi=route.findIndex(p=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-6);if(qi<0)return;
 for(let i=qi+1;i+1<route.length;i++){
  const u=route[i],v=route[i+1],sx=v[0]-u[0],sz=v[1]-u[1],len=Math.hypot(sx,sz);
  if(Math.hypot(u[0]-q[0],u[1]-q[1])>reach*2)return;
  if(len<.3||Math.abs(sx*dir[0]+sz*dir[1])/len>.05)continue;
  // q + s*dir meets the line through u and v.
  const den=dir[0]*sz-dir[1]*sx;if(Math.abs(den)<1e-9)continue;
  const s=((u[0]-q[0])*sz-(u[1]-q[1])*sx)/den;if(s<=0||s>reach)continue;
  const x:Pt=[q[0]+dir[0]*s,q[1]+dir[1]*s],r=Math.min(FREIGHT_STREET_TURN,s*.45,Math.hypot(v[0]-x[0],v[1]-x[1])*.45);
  route.splice(qi+1,i-qi,...roundedRoad([q,x,v],r).slice(1,-1));return;
 }
}
/**
 * Remove a point where the route doubles straight back on itself. When a crossing corner and a street
 * join land in the wrong order (seen once Circa's parcel moves the route), the route would run out
 * along the street and back, which no truck can drive. Of the two points that make the stub, drop the
 * one that leaves the gentler turns.
 */
export function dropReversals(route:Pt[]):Pt[]{
 const out=[...route];
 const turn=(a:Pt,p:Pt,b:Pt)=>{const ux=p[0]-a[0],uz=p[1]-a[1],vx=b[0]-p[0],vz=b[1]-p[1],l=Math.hypot(ux,uz)*Math.hypot(vx,vz);return l>0?(ux*vx+uz*vz)/l:1;};
 const worst=(r:Pt[],from:number,to:number)=>{let w=1;for(let k=Math.max(1,from);k<=Math.min(r.length-2,to);k++)w=Math.min(w,turn(r[k-1],r[k],r[k+1]));return w;};
 for(let i=1;i<out.length-1;){
  if(turn(out[i-1],out[i],out[i+1])>=-.999){i++;continue;}
  const options=[i,i-1].filter(k=>k>0).map(k=>{const r=out.filter((_,n)=>n!==k);return {k,score:worst(r,k-2,k+1)};}).sort((a,b)=>b.score-a.score);
  out.splice(options[0].k,1);i=Math.max(1,i-2);
 }
 return out;
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
/**
 * A short hop off one street onto another that crosses it becomes a plain corner at the crossing,
 * so the truck turns at the intersection instead of cutting a curve across the pavement.
 */
export function cornerAtCrossings(route:Pt[],streets:Pt[][],reach=4):{route:Pt[];corners:Pt[]}{
 const on=(p:Pt)=>streets.findIndex(st=>distanceToRoad(p,st)<1e-6),out:Pt[]=[],corners:Pt[]=[];
 for(let i=0;i<route.length;i++){
  out.push(route[i]);const s=on(route[i]);
  if(s<0||i+1>=route.length||distanceToRoad(route[i+1],streets[s])<1e-6)continue;
  let j=i+1,length=0;while(j<route.length&&on(route[j])<0){length+=Math.hypot(route[j][0]-route[j-1][0],route[j][1]-route[j-1][1]);j++;}
  if(j>=route.length)continue;length+=Math.hypot(route[j][0]-route[j-1][0],route[j][1]-route[j-1][1]);
  const t=on(route[j]);if(t===s||t<0||length>reach)continue;
  const x=roadIntersections(streets[s],streets[t]).sort((p,q)=>Math.hypot(p[0]-route[i][0],p[1]-route[i][1])-Math.hypot(q[0]-route[i][0],q[1]-route[i][1]))[0];
  if(!x||Math.hypot(x[0]-route[i][0],x[1]-route[i][1])>reach||Math.hypot(x[0]-route[j][0],x[1]-route[j][1])>reach)continue;
  out.push(x);corners.push(x);i=j-1;
 }
 return {route:out.filter((p,i)=>!i||Math.hypot(p[0]-out[i-1][0],p[1]-out[i-1][1])>1e-6),corners};
}
/** Where a route crosses a street, ignoring stretches where it runs along that street. */
function crossings(route:Pt[],street:Pt[]):Pt[]{
 const off=route.slice(1).map((b,i):Pt[]=>[route[i],b]).filter(([a,b])=>distanceToRoad([(a[0]+b[0])/2,(a[1]+b[1])/2],street)>1e-6);
 return off.flatMap(seg=>roadIntersections(seg,street)).filter((p,i,all)=>all.findIndex(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<.01)===i);
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
 const airportLand=airportFootprint(a),stadium=scene.stadium;
 const access=planHighwayAccess(highway,scene.connections??[],[...obstacles,{x:airportLand.x+airportLand.w/2,z:airportLand.z+airportLand.d/2,w:airportLand.w,d:airportLand.d},...(stadium?[{x:stadium.x+stadium.w/2,z:stadium.z+stadium.d/2,w:stadium.w,d:stadium.d}]:[])],scene.streets??[],scene.land??[]);
 // Highway collectors are streets too: a truck that would run beside one (two roads side by side
 // between towers) drives on the collector instead, so each gap between buildings has one road.
 const collectors=access.map(x=>x.collector),districtStreets=scene.streets??[];
 const share=(withCollectors:boolean)=>{
  const onCollector=withCollectors?snapToStreets(routed,collectors,FREIGHT_COLLECTOR_SNAP,true):{route:routed,joins:[] as Pt[]};
  const onStreets=snapToStreets(onCollector.route,districtStreets,FREIGHT_STREET_SNAP),joins=[...onCollector.joins,...onStreets.joins];
  const all=withCollectors?[...districtStreets,...collectors]:districtStreets,turned=cornerAtCrossings(onStreets.route,all);
  return {joins:[...joins,...turned.corners],streets:all,route:roundJoins(dropReversals(turned.route),joins.filter(j=>!turned.corners.some(c=>Math.hypot(c[0]-j[0],c[1]-j[1])<1e-6)),FREIGHT_STREET_TURN)};
 };
 // Prefer sharing collectors and streets; fall back to streets only, then to the routed road.
 // Only the stretches off shared streets need checking; each keeps its own bend widths.
 // Clearance uses the width actually drawn: street size in town, highway size near the highway.
 const dense=(path:Pt[])=>path.flatMap((p,i):Pt[]=>{if(!i)return [p];const a=path[i-1],n=Math.max(1,Math.ceil(Math.hypot(p[0]-a[0],p[1]-a[1])/.3));return Array.from({length:n},(_,j):Pt=>[a[0]+(p[0]-a[0])*(j+1)/n,a[1]+(p[1]-a[1])*(j+1)/n]);});
 const safeOff=(raw:Pt[],shared:Pt[][])=>{const path=dense(raw),k=highwayShare(path,land,highway);return path.slice(1).every((b,i)=>{const a=path[i],m:Pt=[(a[0]+b[0])/2,(a[1]+b[1])/2];if(shared.some(st=>distanceToRoad(m,st)<1e-6))return true;const w=streetBlend(TRANSPORT.cityWidth,roadWidthAt(path,i+1),Math.max(k[i],k[i+1])),n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.1);return Array.from({length:n+1},(_,j)=>clear(a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n,w/2+.03)).every(Boolean);});};
 const shared=[share(true),share(false)].find(c=>c.route.length>1&&safeOff(c.route,c.streets));
 const route=shared?.route??routed,streets=shared?.streets??districtStreets;
 const streetJoins=shared?.joins??[];
 // A short branch joins an existing district street; freight itself uses the wider service road.
 const candidates=(scene.carBridges??[]).flatMap(b=>b.roads).flatMap(path=>path.slice(1).flatMap((b,i)=>{
  const a=path[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((lot![0]-a[0])*dx+(lot![1]-a[1])*dz)/(dx*dx+dz*dz||1)));
  const p:Pt=[a[0]+dx*t,a[1]+dz*t];return [[lot!,[p[0],lot![1]] as Pt,p],[lot!,[lot![0],p[1]] as Pt,p]];
 }));
 const ordered=candidates.sort((a,b)=>distance(a)-distance(b));
 const cityAccess=ordered.find(p=>pathClear(p,obstacles,.26))??ordered.slice(0,4).map(p=>findPath(lot!,p[p.length-1],.26)).find((p):p is Pt[]=>!!p)??[];
 function distance(p:Pt[]){return p.slice(1).reduce((sum,b,i)=>sum+Math.hypot(b[0]-p[i][0],b[1]-p[i][1]),0);}

 const freightMouths=route.filter((p,i)=>distanceToRoad(p,highway)<.001&&((i>0&&distanceToRoad(route[i-1],highway)>.001)||(i+1<route.length&&distanceToRoad(route[i+1],highway)>.001)));
 // The truck keeps to its city lane in town and its highway lane on the deck (road standard).
 const lane=(path:Pt[])=>lanePath(path,highwayShare(path,land,highway).map(k=>streetBlend(TRANSPORT.cityLaneOffset,HIGHWAY.laneOffset,k)));
 const legs:Leg[]=[];const hold=(p:Pt)=>legs.push({a:p,b:p,ya:.03,yb:.03,dur:8,hold:true});hold(lane(route)[0]);
 const drive=(path:Pt[])=>{for(let i=1;i<path.length;i++)legs.push({a:path[i-1],b:path[i],ya:.03,yb:.03,dur:Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1])/freightSpeed([(path[i][0]+path[i-1][0])/2,(path[i][1]+path[i-1][1])/2],highway),hold:false});};drive(lane(route));hold(route[route.length-1]);drive(lane([...route].reverse()));
 return {lot:{x:lot[0],z:lot[1]},route,streets,highway,cityAccess,land,access,localJunctions:[...streetJoins,...(shared?streets.flatMap(st=>crossings(route,st)):[]),...access.map(a=>a.junction),...access.filter(a=>!streets.includes(a.collector)).flatMap(a=>roadIntersections(a.collector,route)),...[...(scene.carBridges??[]).flatMap(b=>b.roads.flatMap(p=>roadIntersections(route,p))),...(scene.connections??[]).flatMap(l=>roadIntersections(route,l.road))]],exits:[...access.flatMap(a=>a.mouths),...freightMouths,...(scene.connections??[]).flatMap(l=>roadIntersections(highway,l.road))],truck:{id:"canva-airport-freight",kind:"semi",color:"#294237",legs,period:legs.reduce((n,l)=>n+l.dur,0),offset:0}};
}
