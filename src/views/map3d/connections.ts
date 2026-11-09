import {airportTrafficKeepOut,airportPoint,airportFootprint,airportPublicPath,type AirportPlan} from './airport';
import type {StadiumPlan} from './stadiumPlan';
import {stadiumGate} from './stadiumGeometry';
import {routeAround} from './routing';
import {pathClear,type Box,type Pt} from './roads';
export interface DistrictConnection {id:string;road:Pt[];walk:Pt[];
 /** A district street the highway collector may leave from directly (a clean T, not a run along it). */
 frontage?:Pt[]}
/** Public access remains on the city-facing side, completely outside the aircraft apron. */
export function districtConnections(a?:AirportPlan,s?:StadiumPlan,boxes:Box[]=[]):DistrictConnection[]{
 const links:DistrictConnection[]=[];

 // Roads and walks go around Atlas Stadium, never through its shells or concourse.
 if(s)boxes=[...boxes,{x:s.x+s.w/2,z:s.z+s.d/2,w:s.w,d:s.d}];
 if(a){
  const front=airportPoint(a,-1.5,6);
  links.push({id:'skyline-airport',road:a.publicViaZ===undefined?[[a.accessX,a.accessZ],[front[0],a.accessZ],front]:[[a.accessX-.6,a.accessZ],[a.accessX-.6,a.publicViaZ],[front[0],a.publicViaZ],front],walk:airportPublicPath(a)});
 }
 if(s){
  // Both links end at the foot of Atlas Stadium's main gate steps.
  const outside=s.x+s.w+1,entry:Pt=stadiumGate(s);
  links.push({id:'profile-stadium',road:[[s.accessX,s.accessZ],[outside,s.accessZ],[outside,entry[1]],entry],walk:[[s.accessX,s.accessZ+.6],[outside+.6,s.accessZ+.6],[outside+.6,entry[1]+.6],[entry[0],entry[1]+.6],entry]});
  if(a){
   const front=airportPoint(a,-1.5,6),north=airportFootprint(a).z+.6;
   links.push({id:'stadium-airport',road:[front,[front[0],north],[outside,north],[outside,entry[1]],entry],walk:[airportPoint(a,-.7,6),[front[0]+(a.west?-.8:.8),north+.6],[outside+.6,north+.6],[outside+.6,entry[1]+.6],[entry[0],entry[1]+.6],entry]});
  }
 }
 const repair=(path:Pt[],margin:number,keepOut:Box[]=[])=>{
  const blockers=[...boxes,...keepOut];
  const out:Pt[]=[];
  for(let i=1;i<path.length;i++){
   const a=path[i-1],b=path[i],part=pathClear([a,b],blockers,margin)?[a,b]:routeAround(a,b,blockers,margin);
   if(!part)return [];out.push(...part.slice(out.length?1:0));
  }
  return out;
 };
 return links.map(link=>({...link,road:repair(link.road,.3,a?[airportTrafficKeepOut(a)]:[]),walk:repair(link.walk,.3)}));
}
