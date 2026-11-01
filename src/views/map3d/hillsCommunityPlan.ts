import {financialDimensions} from './financialArchitecture';
import type {HillsPlan} from './hillsPlan';
import type {Pt} from './roads';
import type {FinancialPlan} from './financialPlan';
import type {Rect} from './scene';
import {roundedRoad} from './highway';
import {CITY_SPACING} from './citySpacing';
import {HILLS} from './hillsPlan';
export const COMMUNITY={streetX:21,streetZ:27,sidewalkX:20,sidewalkZ:26.35,financialShoreGap:2.4,stationX:28,trackZ:18.5,platformOffset:.85,platformWidth:1.05,platformLength:7.8,railRise:1.8,platformRise:2.06,trackWidth:.7,trainLength:3.6,carriageLength:1.3,carriageSpacing:1.1,dwell:32,speed:3.2} as const;
export const COMMUNITY_BUILDINGS=[
 {id:'home-1',name:'Cypress House',kind:'house',x:4,z:24,w:3.2,d:2.6,h:1.8,color:'#eee2cd',purpose:'Planned gated residence with a private garden and garage.'},
 {id:'home-2',name:'Palm House',kind:'house',x:10,z:24,w:3.2,d:2.6,h:2.2,color:'#dce3dc',purpose:'Planned two-story residence with a balcony and private garage.'},
 {id:'home-3',name:'Laurel House',kind:'house',x:16,z:24,w:3.2,d:2.6,h:1.9,color:'#efe9dc',purpose:'Planned courtyard residence with landscaped frontage.'},
 {id:'home-4',name:'Vista House',kind:'house',x:28,z:8,w:3.8,d:3,h:2.4,color:'#e6e0d4',purpose:'Planned hillside residence with a shaded terrace.'},
 {id:'shops',name:'Village Shops',kind:'shop',x:4,z:32,w:3.6,d:2.8,h:1.8,color:'#eee8d7',purpose:'Planned neighborhood retail spaces; no sales or services connected.'},
 {id:'cafe',name:'Hills Café',kind:'cafe',x:10,z:32,w:3.6,d:2.8,h:1.5,color:'#ead9c5',purpose:'Planned café and outdoor seating around the village plaza.'},
 {id:'clubhouse',name:'Community Clubhouse',kind:'club',x:16,z:32,w:3.6,d:2.8,h:2.1,color:'#d9e1d7',purpose:'Planned shared neighborhood gathering and meeting spaces.'},
 {id:'gym',name:'Hills Fitness',kind:'gym',x:4,z:41,w:3.8,d:3.2,h:2.1,color:'#d6dee0',purpose:'Planned fitness studio and exercise spaces; no memberships connected.'},
 {id:'social',name:'Hills Social Club',kind:'club',x:10,z:41,w:3.8,d:3.2,h:2.3,color:'#e5ddcf',purpose:'Planned social lounge and neighborhood events space.'},
 {id:'spa',name:'Health & Wellness Spa',kind:'spa',x:16,z:41,w:3.8,d:3.2,h:1.8,color:'#dce6dd',purpose:'Planned wellness courtyard and relaxation garden; no bookings or health data.'},
 {id:'golf',name:'Three-Hole Golf',kind:'golf',x:28,z:37,w:8,d:14,h:.6,color:'#71965f',purpose:'A compact schematic three-hole short course, separated from public paths and rail.'},
 {id:'golf-club',name:'Golf Clubhouse',kind:'club',x:28,z:29,w:3.6,d:2.6,h:1.4,color:'#e7e2d5',purpose:'Planned golf reception and equipment storage.'},
 {id:'station',name:'Atlas Hills Station',kind:'station',x:28,z:20,w:8,d:7,h:3.5,color:'#dce5e4',purpose:'Planned elevated passenger station. One simulated train links the Financial District; no live transit or agent execution.'},
] as const;
export type CommunityBuilding=typeof COMMUNITY_BUILDINGS[number];
export const communityKey=(id:string)=>`service:hills:${id}`;
export interface CommunityPlan {x:number;z:number;buildings:readonly CommunityBuilding[];streets:Pt[][];walks:Pt[][];gate:Pt;station:Pt;golfPath:Pt[]}
export function planCommunity(h?:HillsPlan):CommunityPlan|undefined{
 if(!h)return;
 const world=(p:Pt):Pt=>[h.x+p[0],h.z+p[1]];
 return {golfPath:[[24.5,31.2],[31.5,31.2],[31.5,43.8],[24.5,43.8],[24.5,31.2]].map(p=>world(p as Pt)),x:h.x,z:h.z,buildings:COMMUNITY_BUILDINGS,gate:world([13,18.75]),station:world([COMMUNITY.stationX,COMMUNITY.trackZ]),
 streets:[[[1,1.5],[21,1.5],[21,44]],[[21,27],[2,27]]].map(path=>path.map(p=>world(p as Pt))),
 walks:[[[13,16],[13,20.5],[20,20.5],[20,44.3]],[[2,26.35],[20,26.35]],[[2,35],[20,35]],[[2,44.3],[20,44.3]],[[20,26.35],[29,26.35],[29,24.4]],[[20,29],[23,29],[23,44]],[[20,34.5],[23,34.5]],...COMMUNITY_BUILDINGS.filter(b=>!['golf','station','golf-club'].includes(b.id)).map(b=>b.id==='home-4'?[[b.x+.65,b.z+b.d/2+.15],[b.x+.65,11],[22,11],[22,20.5],[20,20.5]] as Pt[]:[[b.x+.65,b.z+b.d/2+.15],[b.x+.65,b.z<27?26.35:b.z<36?35:44.3]] as Pt[]),[[28.65,30.45],[28.65,30.6],[23,30.6]]].map(path=>path.map(p=>world(p as Pt)))};
}
export type Point3=[number,number,number];
export interface RailPlan {route:Pt[];lengths:number[];length:number;hills:Pt;financial:Pt;financialLand:Rect;hillsWalk:Point3[];financialWalk:Point3[]}
export function financialStationLand(f:FinancialPlan):Rect{return {x:f.x+f.w+COMMUNITY.financialShoreGap,z:f.z+.5,w:8.1,d:8};}
export function planCommunityRail(c:CommunityPlan|undefined,f:FinancialPlan|undefined):RailPlan|undefined{
 if(!c||!f)return;
 const a=c.station,b:Pt=[f.x+f.w+COMMUNITY.financialShoreGap+3.8,f.z+2];
 // A direct eastern spine crosses the roads and water, without wrapping the highway.
 const east=Math.max(c.x+HILLS.width+CITY_SPACING.railEdgeClearance,b[0]+CITY_SPACING.railEndApproach);
 const route=roundedRoad([a,[east,a[1]],[east,b[1]],b],4),lengths=[0];
 for(let i=1;i<route.length;i++)lengths.push(lengths[i-1]+Math.hypot(route[i][0]-route[i-1][0],route[i][1]-route[i-1][1]));
 const shore=f.x+Math.min(f.w-.7,Math.max(...f.buildings.map(b=>b.x+financialDimensions(b.id).w/2))+.55);
 const bank=f.buildings.find(b=>b.id==='banks')!,cross=f.x+34,world=(p:Point3):Point3=>[c.x+p[0],p[1],c.z+p[2]];
 return {route,lengths,length:lengths[lengths.length-1],hills:a,financial:b,financialLand:financialStationLand(f),
 hillsWalk:[[16.65,0,25.45],[16.65,0,26.35],[20,0,26.35],[29,0,26.35],[29,0,24.4],[29,COMMUNITY.platformRise,20.2],[28.33,COMMUNITY.platformRise,19.35],[28.33,COMMUNITY.platformRise,18.78]].map(p=>world(p as Point3)),
 financialWalk:[[b[0]-.33,COMMUNITY.platformRise,b[1]+.28],[b[0]-.33,COMMUNITY.platformRise,b[1]+.85],[b[0]+1,COMMUNITY.platformRise,b[1]+1.7],[b[0]+1,0,b[1]+5.9],[shore,0,b[1]+5.9],[shore,0,f.z+14.1],[cross,0,f.z+14.1],[cross,0,f.z+11.95],[f.x+bank.x,0,f.z+11.95],...bank.approach.slice().reverse().slice(1).map(p=>[p[0],0,p[1]] as Point3)]};
}
/** Distance-based sampling is shared by train movement and route checks. */
export function railPoint(p:RailPlan,distance:number){const d=Math.max(0,Math.min(p.length,distance));let i=1;while(i<p.lengths.length-1&&p.lengths[i]<d)i++;const a=p.route[i-1],b=p.route[i],t=(d-p.lengths[i-1])/(p.lengths[i]-p.lengths[i-1]||1);return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,yaw:Math.atan2(b[0]-a[0],b[1]-a[1])};}
export function railState(seconds:number,length:number){const travel=length/COMMUNITY.speed,dwell=COMMUNITY.dwell,cycle=2*(travel+dwell),t=((seconds%cycle)+cycle)%cycle;
 if(t<dwell)return {distance:0,doors:1,phase:'hills' as const,progress:t/dwell};
 if(t<dwell+travel)return {distance:(t-dwell)*COMMUNITY.speed,doors:0,phase:'outbound' as const,progress:(t-dwell)/travel};
 if(t<2*dwell+travel)return {distance:length,doors:1,phase:'financial' as const,progress:(t-dwell-travel)/dwell};
 return {distance:length-(t-2*dwell-travel)*COMMUNITY.speed,doors:0,phase:'return' as const,progress:(t-2*dwell-travel)/travel};}
export function walkPoint(path:Point3[],t:number):Point3{const lengths=[0];for(let i=1;i<path.length;i++)lengths.push(lengths[i-1]+Math.hypot(...path[i].map((n,j)=>n-path[i-1][j])));const d=Math.max(0,Math.min(1,t))*lengths[lengths.length-1];let i=1;while(i<lengths.length-1&&lengths[i]<d)i++;const k=(d-lengths[i-1])/(lengths[i]-lengths[i-1]||1);return path[i].map((n,j)=>path[i-1][j]+(n-path[i-1][j])*k) as Point3;}

/** Physical track extends past stop centers, supporting the complete parked train. */
export function railDeck(p:RailPlan):RailPlan{const extension=COMMUNITY.trainLength/2+.7,a=railPoint(p,0),b=railPoint(p,p.length);return {...p,route:[[a.x-Math.sin(a.yaw)*extension,a.z-Math.cos(a.yaw)*extension],...p.route,[b.x+Math.sin(b.yaw)*extension,b.z+Math.cos(b.yaw)*extension]],lengths:[0,...p.lengths.map(d=>d+extension),p.length+2*extension],length:p.length+2*extension};}

export function commuterStage(state:ReturnType<typeof railState>){const aboard=state.phase==='outbound'||state.phase==='return',hills=state.phase==='hills';return {aboard,hills,progress:hills?(state.progress<.5?1-state.progress*2:state.progress*2-1):(state.progress<.5?state.progress*2:2-state.progress*2)};}
