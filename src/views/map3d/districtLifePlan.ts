import type {Scene3D} from './scene';
import type {Pt} from './roads';
import {financialBrand} from './financialBrands';
import {financialDimensions} from './financialArchitecture';

export const DISTRICT_LIFE={maxVisitors:36,speed:.32,insidePause:8,outsidePause:5,doorRadius:.65,bodyRadius:.04} as const;
export const SIMULATED_COMMUTERS=6;
export const commuterLane=(i:number)=>(i-(SIMULATED_COMMUTERS-1)/2)*.065;
export type LifeArea='financial'|'hills'|'golf'|'bmw';
export interface VisitorRoute {points:Pt[];lengths:number[];length:number}
export interface DistrictVisitor {id:string;area:LifeArea;route:VisitorRoute;offset:number;lane:number;door?:string;target?:string;golf?:boolean;threshold?:number}
export interface VisitorDoor {id:string;area:LifeArea;x:number;z:number;width:number;height:number}
export interface DistrictLifePlan {visitors:DistrictVisitor[];doors:VisitorDoor[]}
export function visitorRoute(points:Pt[]):VisitorRoute{
 const clean=points.filter((p,i)=>!i||Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1])>.001),lengths=[0];
 for(let i=1;i<clean.length;i++)lengths.push(lengths[i-1]+Math.hypot(clean[i][0]-clean[i-1][0],clean[i][1]-clean[i-1][1]));
 return {points:clean,lengths,length:lengths[lengths.length-1]??0};
}
/** Deterministic out-and-back visits, with pauses; no timers, resets or teleporting. */
export function visitorAt(v:DistrictVisitor,seconds:number){
 const r=v.route,travel=r.length/DISTRICT_LIFE.speed,inside=v.door?DISTRICT_LIFE.insidePause:3,cycle=2*travel+inside+DISTRICT_LIFE.outsidePause;
 const t=((seconds+v.offset)%cycle+cycle)%cycle;
 const forward=t<travel+inside,progress=t<travel?t/travel:t<travel+inside?1:t<2*travel+inside?1-(t-travel-inside)/travel:0;
 const distance=Math.max(0,Math.min(1,progress))*r.length;let i=1;
 while(i<r.lengths.length-1&&r.lengths[i]<distance)i++;
 const a=r.points[i-1],b=r.points[i],len=r.lengths[i]-r.lengths[i-1],fraction=(distance-r.lengths[i-1])/(len||1),dx=(b[0]-a[0])/(len||1),dz=(b[1]-a[1])/(len||1);
 const x=a[0]+(b[0]-a[0])*fraction-dz*v.lane,z=a[1]+(b[1]-a[1])*fraction+dx*v.lane;
 return {y:.11+(v.threshold===undefined?0:Math.max(0,Math.min(1,(v.threshold+.25-z)/.35))*.1),x,z,yaw:Math.atan2(dx,dz)+(forward?0:Math.PI),inside:!!v.door&&t>=travel&&t<travel+inside};
}
export function visitorDoorOccupied(door:VisitorDoor,plan:DistrictLifePlan,seconds:number){return plan.visitors.some(v=>{if(v.door!==door.id)return false;const p=visitorAt(v,seconds);return Math.hypot(p.x-door.x,p.z-door.z)<DISTRICT_LIFE.doorRadius;});}
/** Use existing pedestrian routes and real entrances, never new shortcuts across roads. */
export function planDistrictLife(s:Pick<Scene3D,'financial'|'community'|'dealership'>):DistrictLifePlan{
 const visitors:DistrictVisitor[]=[],doors:VisitorDoor[]=[];
 const add=(id:string,area:LifeArea,points:Pt[],offset:number,extra:Partial<DistrictVisitor>={})=>{
  const route=visitorRoute(points);if(route.points.length<2||route.length<.05||visitors.length>=DISTRICT_LIFE.maxVisitors)return;
  visitors.push({id,area,route,offset,lane:0,...extra});
 };
 if(s.financial){const f=s.financial;
  for(const [i,b]of f.buildings.entries()){
   if(!financialBrand(b.id))continue;
   const size=financialDimensions(b.id),door={id:`financial:${b.id}`,area:'financial' as const,x:f.x+b.x,z:f.z+b.z+size.depth/2+.045,width:.7,height:.65};doors.push(door);
   add(`visitor:${b.id}`,'financial',[...b.approach.slice().reverse(),[door.x,door.z],[door.x,door.z-.4]],i*11,{door:door.id,target:b.id,threshold:door.z});
  }
  for(let i=0;i<3;i++)add(`promenade:${i}`,'financial',f.sidewalk,i*40,{lane:i%2?.05:-.05});
  for(let i=0;i<2;i++)add(`park:${i}`,'financial',f.park.paths[1].map(p=>[f.x+p[0],f.z+p[1]]),i*35);
 }
 if(s.community){const c=s.community;
  for(const [i,index]of [1,1,2,2,3,3,0,4].entries())add(`community:${i}`,'hills',c.walks[index],i*15,{lane:i%2?.05:-.05});
  for(let i=0;i<2;i++)add(`golf-path:${i}`,'golf',c.golfPath,i*35);
  for(const [i,z]of [33,37,41].entries())add(`golfer:${i}`,'golf',[[c.x+26.9,c.z+z-.75],[c.x+28.5,c.z+z-.75],[c.x+28.5,c.z+z+.65]],i*6,{golf:true});
 }
 if(s.dealership){const d=s.dealership,door={id:'bmw:showroom',area:'bmw' as const,x:d.x+5,z:d.z+3.74,width:.84,height:1.12};doors.push(door);
  // Start on the display forecourt; the active driveway remains outside these routes.
  for(let i=0;i<4;i++)add(`bmw:${i}`,'bmw',[[d.x+5,d.z+5.7],[d.x+5,d.z+3.74],[d.x+5,d.z+3],[d.x+6.55,d.z+3]],i*17,{door:door.id,lane:i%2?.05:-.05});
 }
 return {visitors,doors};
}
