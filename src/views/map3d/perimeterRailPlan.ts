import {financialDimensions} from './financialArchitecture';
import type {Scene3D} from './scene';
import type {Pt,Box} from './roads';
import type {Point3} from './hillsCommunityPlan';
import {COMMUNITY} from './hillsCommunityPlan';
import {cityEnvelope} from './citySpacing';
import {roundedRoad,distanceToRoad} from './highway';
import {routeAround} from './routing';
import {airportFootprint,airportPoint} from './airport';

export const PERIMETER_RAIL={margin:2,radius:5,speed:COMMUNITY.speed,dwell:15,doorTime:1.2,platformLength:8,deckWidth:1.08,platformOffset:.85,supportSpacing:6,passengersPerStop:2} as const;
export const LOOP_STATIONS=[
 {id:'service:financial-station',name:'Financial District Station',district:'Financial District'},
 {id:'service:atlas-station',name:'Atlas Central Station',district:'Atlas Marketplace'},
 {id:'service:skyline-station',name:'Skyline Station',district:'Skyline'},
 {id:'service:stadium-station',name:'Stadium Station',district:'Stadium'},
 {id:'service:airport-station',name:'Airport Station',district:'Atlas Airport'},
] as const;
export interface RailStop {id:string;name:string;district:string;point:Pt;yaw:number;distance:number;arrival:number;walk:Point3[]}
export interface PerimeterRailPlan {route:Pt[];lengths:number[];length:number;period:number;stops:RailStop[]}
const measure=(route:Pt[])=>{const lengths=[0];for(let i=1;i<route.length;i++)lengths.push(lengths[i-1]+Math.hypot(route[i][0]-route[i-1][0],route[i][1]-route[i-1][1]));return lengths;};
/** Local x runs along the track; local z faces the land on this clockwise loop. */
export function stationPoint(stop:Pick<RailStop,'point'|'yaw'>,x:number,z:number):Pt{const tx=Math.sin(stop.yaw),tz=Math.cos(stop.yaw);return [stop.point[0]+tx*x-tz*z,stop.point[1]+tz*x+tx*z];}
export function loopPoint(p:Pick<PerimeterRailPlan,'route'|'lengths'|'length'>,distance:number){const d=((distance%p.length)+p.length)%p.length;let i=1;while(i<p.lengths.length-1&&p.lengths[i]<d)i++;const a=p.route[i-1],b=p.route[i],u=(d-p.lengths[i-1])/(p.lengths[i]-p.lengths[i-1]||1);return {x:a[0]+(b[0]-a[0])*u,z:a[1]+(b[1]-a[1])*u,yaw:Math.atan2(b[0]-a[0],b[1]-a[1])};}
function distanceAt(route:Pt[],lengths:number[],point:Pt){for(let i=1;i<route.length;i++)if(distanceToRoad(point,[route[i-1],route[i]])<1e-5)return lengths[i-1]+Math.hypot(point[0]-route[i-1][0],point[1]-route[i-1][1]);throw new Error('Station is not on perimeter track');}
/** All stations share this exact boarding path, platform and stair opening. */
export function stationBoardingPath(s:Pick<RailStop,'point'|'yaw'>):Point3[]{return [[1,0,5.9],[1,COMMUNITY.platformRise,1.7],[1,COMMUNITY.platformRise,1.05],[.24,COMMUNITY.platformRise,1.05],[.24,COMMUNITY.platformRise,.27]].map(([x,y,z])=>{const p=stationPoint(s,x,z);return [p[0],y,p[1]];});}
export function planPerimeterRail(s:Pick<Scene3D,'land'|'financial'|'mall'|'airport'|'stadium'|'parks'|'towers'|'kiosks'|'retail'|'dealership'>):PerimeterRailPlan|undefined{
 const e=cityEnvelope(s.land),f=s.financial,m=s.mall,a=s.airport,stadium=s.stadium,sky=s.parks.find(p=>p.label==='Skyline');if(!e||!f||!m||!a||!stadium||!sky)return;
 const gap=PERIMETER_RAIL.margin,left=e.x-gap,right=e.x+e.w+gap,top=e.z-gap,bottom=e.z+e.d+gap,r=PERIMETER_RAIL.radius;
 const clamp=(v:number,lo:number,hi:number)=>Math.max(lo+r+5,Math.min(hi-r-5,v));
 const financialX=clamp(f.x+20.8,left,right),start:Pt=[financialX,top];
 // Start on the Financial stop's straight section. Rounded corners meet without a duplicate seam.
 const ring=roundedRoad([[left,top],[right,top],[right,bottom],[left,bottom],[left,top]],r,true);
 const north=ring.findIndex((p,i)=>i>0&&p[1]===top&&ring[i-1][1]===top&&p[0]>=financialX);
 const route=[start,...ring.slice(north,-1),...ring.slice(0,north),start],lengths=measure(route),length=lengths[lengths.length-1];
 const airportLand=airportFootprint(a),front=airportPoint(a,-.7,6);
 const seeds=[
  {...LOOP_STATIONS[0],point:start,target:[f.x+21.8,f.z+11.95] as Pt},
  {...LOOP_STATIONS[1],point:[right,clamp(m.cz,top,bottom)] as Pt,target:[m.cx,m.z+m.d] as Pt},
  {...LOOP_STATIONS[2],point:[clamp(sky.x+sky.w/2,left,right),bottom] as Pt,target:[sky.x+sky.w/2,sky.z+sky.d-.4] as Pt},
  {...LOOP_STATIONS[3],point:[clamp(stadium.x+stadium.w/2,left,right),bottom] as Pt,target:[stadium.x+stadium.w+.5,stadium.z+stadium.d/2] as Pt},
  {...LOOP_STATIONS[4],point:[left,clamp(airportLand.z-10,top,bottom)] as Pt,target:front},
 ];
 const boxes:Box[]=[...s.towers,...s.kiosks,...s.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
 boxes.push(...f.buildings.map(b=>({x:f.x+b.x,z:f.z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d})),{x:m.cx,z:m.cz-.8,w:m.w,d:m.d-2.5},{x:stadium.x+stadium.w/2,z:stadium.z+stadium.d/2,w:stadium.w,d:stadium.d});
 if(s.dealership){const b=s.dealership.lot;boxes.push({x:b.x+b.w/2,z:b.z+b.d/2,w:b.w,d:b.d});}
 // Reserve the airside parcel as a whole; public walks approach the terminal along its eastern edge.
 const airsideRight=front[0]-.8;boxes.push({x:(airportLand.x+airsideRight)/2,z:airportLand.z+airportLand.d/2,w:airsideRight-airportLand.x,d:airportLand.d});
 const stops=seeds.map(seed=>{
  const distance=distanceAt(route,lengths,seed.point),pose=loopPoint({route,lengths,length},distance),basis={point:seed.point,yaw:pose.yaw},boarding=stationBoardingPath(basis),landing:Pt=[boarding[0][0],boarding[0][2]];
  const ground=routeAround(seed.target,landing,boxes,.3);if(!ground)throw new Error(`No protected public walk to ${seed.name}`);
  const walk:Point3[]=[...ground.map(([x,z]):Point3=>[x,0,z]),...boarding.slice(1)];
  return {...seed,yaw:pose.yaw,distance,arrival:0,walk};
 }).sort((a,b)=>a.distance-b.distance);
 stops.forEach((stop,i)=>stop.arrival=stop.distance/PERIMETER_RAIL.speed+i*PERIMETER_RAIL.dwell);
 return {route,lengths,length,stops,period:length/PERIMETER_RAIL.speed+stops.length*PERIMETER_RAIL.dwell};
}
/** Open only when fully stopped. Opening/closing use the existing 15-second dwell, not extra timers. */
export function loopState(seconds:number,p:PerimeterRailPlan){const t=((seconds%p.period)+p.period)%p.period;
 for(let i=0;i<p.stops.length;i++){const stop=p.stops[i],next=p.stops[(i+1)%p.stops.length],end=stop.arrival+PERIMETER_RAIL.dwell;
  if(t>=stop.arrival&&t<end){const elapsed=t-stop.arrival;return {distance:stop.distance,station:i,doors:Math.max(0,Math.min(1,elapsed/PERIMETER_RAIL.doorTime,(PERIMETER_RAIL.dwell-elapsed)/PERIMETER_RAIL.doorTime)),moving:false};}
  if(t>=end&&t<(i+1<p.stops.length?next.arrival:p.period))return {distance:stop.distance+(t-end)*PERIMETER_RAIL.speed,station:-1,doors:0,moving:true};
 }
 return {distance:0,station:0,doors:0,moving:false};
}
