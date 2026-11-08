import {along,commuterRoute,type CommuterRoute} from './railCommuters';
import {PERIMETER_RAIL,type PerimeterRailPlan} from './perimeterRailPlan';
export interface LoopPassenger {id:string;origin:number;destination:number;pace:number;out:CommuterRoute;destinationWalk:CommuterRoute;leave:number;board:number;alight:number;atDestination:number;leaveDestination:number;returnBoard:number;homeAlight:number;atHome:number;period:number}
/** Existing unnamed visitor identities, now assigned to actual perimeter stops, two per stop. */
export function planLoopPassengers(p:PerimeterRailPlan):LoopPassenger[]{return p.stops.flatMap((origin,i)=>Array.from({length:PERIMETER_RAIL.passengersPerStop},(_,k)=>{
 const j=(i+1)%p.stops.length,destination=p.stops[j],pace=.5+k*.05,out=commuterRoute(origin.walk),destinationWalk=commuterRoute([...destination.walk].reverse());
 const board=origin.arrival+5+k*3,arrival=destination.arrival+(j<=i?p.period:0),alight=arrival+2+k*2,atDestination=alight+destinationWalk.length/pace;
 const returnBoard=arrival+Math.max(1,Math.ceil((2*destinationWalk.length/pace+10)/p.period))*p.period+7+k*2;
 const homeArrival=origin.arrival+Math.ceil((returnBoard-origin.arrival)/p.period)*p.period,homeAlight=homeArrival+2+k*2,atHome=homeAlight+out.length/pace;
 const leave=board-out.length/pace,period=Math.ceil((atHome+10-leave)/p.period)*p.period;
 return {id:`commuter:${i*PERIMETER_RAIL.passengersPerStop+k}`,origin:i,destination:j,pace,out,destinationWalk,leave,board,alight,atDestination,leaveDestination:returnBoard-destinationWalk.length/pace,returnBoard,homeAlight,atHome,period};
}));}
export function loopPassengerAt(p:LoopPassenger,seconds:number){let t=((seconds%p.period)+p.period)%p.period;if(t>=p.leave+p.period)t-=p.period;
 const walk=(route:CommuterRoute,d:number)=>({where:'walking' as const,visible:true as const,...along(route,d,0)});
 if(t>=p.leave&&t<p.board)return walk(p.out,(t-p.leave)*p.pace);
 if(t>=p.board&&t<p.alight)return {where:'aboard' as const,visible:false as const};
 if(t>=p.alight&&t<p.atDestination)return walk(p.destinationWalk,(t-p.alight)*p.pace);
 if(t>=p.leaveDestination&&t<p.returnBoard)return walk(p.destinationWalk,p.destinationWalk.length-(t-p.leaveDestination)*p.pace);
 if(t>=p.returnBoard&&t<p.homeAlight)return {where:'aboard' as const,visible:false as const};
 if(t>=p.homeAlight&&t<p.atHome)return walk(p.out,p.out.length-(t-p.homeAlight)*p.pace);
 return {where:'inside' as const,visible:false as const};
}
