import {COMMUNITY,COMMUNITY_BUILDINGS,type CommunityPlan,type Point3,type RailPlan} from './hillsCommunityPlan';
import {FINANCIAL,type FinancialPlan} from './financialPlan';
import {HILLS} from './hillsPlan';

/**
 * Simulated rail commuters: unnamed residents who live in Atlas Hills and work in Financial District
 * towers. Each one walks from a real doorway along existing paths at their own pace, timed to reach
 * the waiting train within its 15 second stop, rides, then walks on to a tower or home. Pure and
 * deterministic: the same clock always gives the same picture, with no timers or teleporting.
 */
export const RAIL_COMMUTERS={rest:8,paces:[.31,.36,.41,.46,.5,.55],laneWidth:.07} as const;
/** Financial District tower ids: Circa (twin towers), American Express and The Ritz-Carlton. */
export const COMMUTER_TOWERS={circa:'circa',amex:'budget',ritz:'harbor-residence'} as const;
/**
 * KC, 2026-10-31: two groups of six. Each group rides one train together: two to Circa, two to
 * American Express, two to the Ritz-Carlton. Ritz-Carlton guests return to Atlas Mansion,
 * and one American Express guest goes home to Vista House.
 */
export const COMMUTER_GROUPS=[
 [{home:'cafe',work:'circa'},{home:'home-4',work:'amex'},{home:'mansion',work:'ritz'},{home:'home-1',work:'circa'},{home:'shops',work:'amex'},{home:'mansion',work:'ritz'}],
 [{home:'gym',work:'circa'},{home:'home-2',work:'amex'},{home:'mansion',work:'ritz'},{home:'social',work:'circa'},{home:'spa',work:'amex'},{home:'mansion',work:'ritz'}],
] as const;
/**
 * KC, 2026-10-31: more people in the Financial District who take the train to Atlas Hills
 * businesses and the mansion. Each person here works in a Financial District office and spends
 * the time between trains at a Hills place: the café, shops, fitness, spa, social club,
 * clubhouse, golf clubhouse or the mansion. `work` names a Financial District building id.
 * The mansion destination is its front door from the Hills plan, so a redesign of the house on
 * the same lot keeps working.
 */
export const VISITOR_GROUPS=[
 [{home:'cafe',work:'banks'},{home:'mansion',work:'investments'},{home:'shops',work:'records'},{home:'gym',work:'insurance'},{home:'spa',work:'business-finance'},{home:'golf-club',work:'financial-planning'}],
 [{home:'social',work:'residence'},{home:'clubhouse',work:'banks'},{home:'mansion',work:'business-finance'},{home:'cafe',work:'investments'},{home:'golf-club',work:'insurance'},{home:'shops',work:'financial-planning'}],
 [{home:'spa',work:'records'},{home:'gym',work:'banks'},{home:'mansion',work:'residence'},{home:'clubhouse',work:'investments'},{home:'cafe',work:'insurance'},{home:'social',work:'business-finance'}],
 [{home:'golf-club',work:'banks'},{home:'shops',work:'residence'},{home:'mansion',work:'financial-planning'},{home:'spa',work:'investments'},{home:'gym',work:'records'},{home:'clubhouse',work:'insurance'}],
] as const;
export const RAIL_COMMUTER_COUNT=[...COMMUTER_GROUPS,...VISITOR_GROUPS].reduce((n,g)=>n+g.length,0);

export interface CommuterRoute {points:Point3[];lengths:number[];length:number}
export interface RailCommuter {
 id:string;group:number;home:string;work:string;pace:number;lane:number;
 /** Cycle in which this person rides out; they ride back `returnCycles` later, then repeat every `period`. */
 offset:number;
 /** Home doorway → train door at Atlas Hills, and train door → tower doorway in the Financial District. */
 hills:CommuterRoute;financial:CommuterRoute;
 /** Seconds before departure each one reaches the train, and seconds after arrival they step off. */
 hillsLead:number;financialLead:number;alight:number;
}
export interface CommuterPlan {travel:number;cycle:number;returnCycles:number;periodCycles:number;commuters:RailCommuter[]}
export type CommuterState={where:'home'|'work'|'aboard';visible:false;direction?:'outbound'|'return'}|{where:'walking';visible:true;x:number;y:number;z:number;yaw:number};

export function commuterRoute(points:Point3[]):CommuterRoute{
 const clean=points.filter((p,i)=>!i||Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1],p[2]-points[i-1][2])>1e-6),lengths=[0];
 for(let i=1;i<clean.length;i++)lengths.push(lengths[i-1]+Math.hypot(clean[i][0]-clean[i-1][0],clean[i][1]-clean[i-1][1],clean[i][2]-clean[i-1][2]));
 return {points:clean,lengths,length:lengths[lengths.length-1]??0};
}
/** Stable spread in [0,1) per commuter, so arrivals and paces differ without randomness. */
const spread=(i:number,salt:number)=>((i*0.6180339887+salt*0.4142135624)%1+1)%1;

/** Hills paths follow the village's own sidewalks: doorway, row sidewalk, the x=20 spine, station stairs. */
function hillsRoute(c:CommunityPlan,id:string,door:number):Point3[]{
 const rise=COMMUNITY.platformRise,sx=COMMUNITY.stationX,tz=COMMUNITY.trackZ;
 const local:Point3[]=[];
 // The mansion's front walk joins the village spine at the gate path (x 13, then z 20.5).
 if(id==='mansion')local.push([HILLS.mansion.x,0,HILLS.mansion.z+HILLS.mansion.d/2+.15],[HILLS.mansion.x,0,16],[13,0,20.5],[20,0,20.5],[20,0,26.35]);
 else{const b=COMMUNITY_BUILDINGS.find(b=>b.id===id)!;
 if(id==='home-4')local.push([b.x+.65,0,b.z+b.d/2+.15],[b.x+.65,0,11],[22,0,11],[22,0,20.5],[20,0,20.5],[20,0,26.35]);
 else if(id==='golf-club')local.push([28.65,0,30.45],[28.65,0,30.6],[23,0,30.6],[23,0,29],[20,0,29],[20,0,26.35]);
 else{const row=b.z<27?COMMUNITY.sidewalkZ:b.z<36?35:44.3;local.push([b.x+.65,0,b.z+b.d/2+.15],[b.x+.65,0,row],[COMMUNITY.sidewalkX,0,row],[COMMUNITY.sidewalkX,0,COMMUNITY.sidewalkZ]);}}
 // Station connector and stairs, then along the platform to a door of the waiting train.
 local.push([29,0,COMMUNITY.sidewalkZ],[29,0,24.4],[29,rise,20.2],[29,rise,19.45],[sx+door,rise,19.45],[sx+door,rise,tz+.3]);
 return local.map(p=>[c.x+p[0],p[1],c.z+p[2]]);
}
/** Financial paths: train door, platform, stairs into Financial Park, the park path and north walk, a tower door. */
function financialRoute(f:FinancialPlan,r:RailPlan,building:FinancialPlan['buildings'][number],door:number):Point3[]{
 const [x,z]=r.financial,rise=COMMUNITY.platformRise,walkZ=f.z+FINANCIAL.northWalkZ;
 return [[x+door,rise,z+.3],[x+door,rise,z+1.05],[x+1,rise,z+1.05],[x+1,rise,z+1.7],[x+1,0,z+5.9],[x+1,0,walkZ],[f.x+building.x,0,walkZ],...building.approach.slice().reverse().slice(1).map(p=>[p[0],0,p[1]] as Point3)];
}

export function planRailCommuters(c:CommunityPlan|undefined,f:FinancialPlan|undefined,r:RailPlan|undefined):CommuterPlan|undefined{
 if(!c||!f||!r)return;
 const towerId=(key:string)=>key in COMMUTER_TOWERS?COMMUTER_TOWERS[key as keyof typeof COMMUTER_TOWERS]:key;
 const tower=(key:string)=>f.buildings.find(b=>b.id===towerId(key)&&b.approach.length>1)??f.buildings.find(b=>b.id===COMMUTER_TOWERS.amex&&b.approach.length>1);
 const dwell=COMMUNITY.dwell,travel=r.length/COMMUNITY.speed,cycle=2*(travel+dwell),doors=[-1.3,-.8,-.3,.2,.7,1.2];
 const groups=[...COMMUTER_GROUPS,...VISITOR_GROUPS] as readonly (readonly {home:string;work:string}[])[];
 const trips=groups.flatMap((g,group)=>g.map((trip,k)=>({...trip,group,k})));
 if(trips.some(t=>!tower(t.work)))return;
 const commuters=trips.map(({home,work,group,k},i):RailCommuter=>{
  // Circa is optional (its own pull request); until it exists its guests use American Express.
  const building=tower(work)!,door=doors[k%doors.length];
  return {id:`commuter:${i}`,group,home,work:building.id,pace:RAIL_COMMUTERS.paces[(k*5+group)%RAIL_COMMUTERS.paces.length],lane:((k%5)-2)*RAIL_COMMUTERS.laneWidth/2,offset:0,
   hills:commuterRoute(hillsRoute(c,home,door)),financial:commuterRoute(financialRoute(f,r,building,door)),
   // Arrivals spread across the stop: some are waiting at the doors early, others hurry in at the end.
   hillsLead:1.2+spread(i,1)*(dwell-2.6),financialLead:1.2+spread(i,2)*(dwell-2.6),alight:.4+spread(i,3)*2.6};
 });
 // A day at work and an evening at home must each fit between trains, for the slowest walker.
 const need=(walk:number,lead:number,alight:number)=>2*walk+lead+alight+RAIL_COMMUTERS.rest-dwell;
 const returnCycles=Math.max(1,...commuters.map(p=>Math.ceil(need(p.financial.length/p.pace,p.financialLead,p.alight)/cycle)));
 const homeCycles=Math.max(1,...commuters.map(p=>Math.ceil(need(p.hills.length/p.pace,p.hillsLead,p.alight)/cycle)));
 const periodCycles=returnCycles+1+homeCycles;
 // KC's two groups ride different trains, half a round of trips apart; the visitor groups fill
 // the trains in between, so most trains carry someone.
 commuters.forEach(p=>{p.offset=p.group<2?p.group*Math.max(1,Math.floor(periodCycles/2)):(p.group-2)*Math.max(1,Math.floor(periodCycles/VISITOR_GROUPS.length))+1;});
 return {travel,cycle,returnCycles,periodCycles,commuters};
}

export function along(route:CommuterRoute,distance:number,lane:number){
 const d=Math.max(0,Math.min(route.length,distance));let i=1;
 while(i<route.lengths.length-1&&route.lengths[i]<d)i++;
 const a=route.points[i-1],b=route.points[i],len=route.lengths[i]-route.lengths[i-1]||1,t=(d-route.lengths[i-1])/len;
 // The side-by-side lane eases to the centre line at each corner, so turns never jump.
 const dx=b[0]-a[0],dz=b[2]-a[2],flat=Math.hypot(dx,dz)||1,side=lane*Math.min(1,Math.min(d-route.lengths[i-1],route.lengths[i]-d)/.3);
 return {x:a[0]+dx*t-dz/flat*side,y:a[1]+(b[1]-a[1])*t,z:a[2]+dz*t+dx/flat*side,yaw:Math.atan2(dx,dz)};
}
/** Key times within one person's period, in seconds from the start of their outbound train's cycle. */
export function commuterTimes(plan:CommuterPlan,p:RailCommuter){
 const dwell=COMMUNITY.dwell,{travel,cycle}=plan,hillsWalk=p.hills.length/p.pace,financialWalk=p.financial.length/p.pace;
 const board=dwell-p.hillsLead,alightFinancial=dwell+travel+p.alight,returnBoard=plan.returnCycles*cycle+2*dwell+travel-p.financialLead,alightHills=(plan.returnCycles+1)*cycle+p.alight;
 return {leaveHome:board-hillsWalk,board,alightFinancial,atWork:alightFinancial+financialWalk,leaveWork:returnBoard-financialWalk,returnBoard,alightHills,atHome:alightHills+hillsWalk,period:plan.periodCycles*cycle};
}
export function commuterAt(plan:CommuterPlan,p:RailCommuter,seconds:number):CommuterState{
 const k=commuterTimes(plan,p),period=k.period;
 let t=((seconds-p.offset*plan.cycle)%period+period)%period;
 // The walk to the train starts before the cycle it rides in, so it wraps from the end of the period.
 if(t>=k.leaveHome+period)t-=period;
 if(t>=k.leaveHome&&t<k.board)return walking(p.hills,(t-k.leaveHome)*p.pace,p.lane);
 if(t>=k.board&&t<k.alightFinancial)return {where:'aboard',visible:false,direction:'outbound'};
 if(t>=k.alightFinancial&&t<k.atWork)return walking(p.financial,(t-k.alightFinancial)*p.pace,-p.lane);
 if(t>=k.atWork&&t<k.leaveWork)return {where:'work',visible:false};
 if(t>=k.leaveWork&&t<k.returnBoard)return walking(p.financial,p.financial.length-(t-k.leaveWork)*p.pace,p.lane);
 if(t>=k.returnBoard&&t<k.alightHills)return {where:'aboard',visible:false,direction:'return'};
 if(t>=k.alightHills&&t<k.atHome)return walking(p.hills,p.hills.length-(t-k.alightHills)*p.pace,-p.lane);
 return {where:'home',visible:false};
}
function walking(route:CommuterRoute,distance:number,lane:number):CommuterState{
 const q=along(route,distance,lane);return {where:'walking',visible:true,...q};
}
