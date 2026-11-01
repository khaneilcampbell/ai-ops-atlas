import {FINANCIAL,type FinancialPlan} from './financialPlan';
import {RAIL_COMMUTERS,along,commuterRoute,type CommuterRoute} from './railCommuters';
import type {Point3} from './hillsCommunityPlan';

/**
 * Simulated office workers in the Financial District who walk the north sidewalk between towers:
 * out of one tower's door, along the sidewalk, into another tower, and back again later. They use
 * the same routes and walking maths as the rail commuters, so there is one movement system.
 * Pure and deterministic: the same clock always gives the same picture.
 */
export const DISTRICT_WALKERS={count:24,rest:[7,10,13,16,19,22],laneWidth:.09} as const;

export interface DistrictWalker {
 id:string;from:string;to:string;pace:number;lane:number;
 /** Seconds into its period this walker starts, so the sidewalk never empties at once. */
 offset:number;
 /** Seconds spent inside each tower between walks. */
 restFrom:number;restTo:number;route:CommuterRoute;
}
export type WalkerState={visible:false;inside:string}|{visible:true;x:number;y:number;z:number;yaw:number};

/** Door → sidewalk for one tower, then sidewalk → door of the other, on the towers' own approaches. */
function walkerRoute(a:FinancialPlan['buildings'][number],b:FinancialPlan['buildings'][number]):Point3[]{
 return [...a.approach,...b.approach.slice().reverse()].map(p=>[p[0],0,p[1]] as Point3);
}
const spread=(i:number,salt:number)=>((i*0.6180339887+salt*0.4142135624)%1+1)%1;

export function planDistrictWalkers(f:FinancialPlan|undefined):DistrictWalker[]{
 const towers=f?.buildings.filter(b=>b.approach.length>1&&Math.abs(b.approach[b.approach.length-1][1]-(f.z+FINANCIAL.northWalkZ))<.01)??[];
 if(towers.length<2)return [];
 const walkers:DistrictWalker[]=[];
 for(let i=0;i<DISTRICT_WALKERS.count;i++){
  // Pairs step through the towers so neighbours and long walks across the district both appear.
  const a=towers[i%towers.length],b=towers[(i+1+Math.floor(i/towers.length)*2)%towers.length];
  if(a.id===b.id)continue;
  const route=commuterRoute(walkerRoute(a,b)),pace=RAIL_COMMUTERS.paces[(i*5)%RAIL_COMMUTERS.paces.length];
  const restFrom=DISTRICT_WALKERS.rest[i%DISTRICT_WALKERS.rest.length],restTo=DISTRICT_WALKERS.rest[(i*7+3)%DISTRICT_WALKERS.rest.length];
  const period=2*route.length/pace+restFrom+restTo;
  walkers.push({id:`walker:${i}`,from:a.id,to:b.id,pace,lane:((i%5)-2)*DISTRICT_WALKERS.laneWidth/2,offset:spread(i,5)*period,restFrom,restTo,route});
 }
 return walkers;
}

export function walkerPeriod(w:DistrictWalker){return 2*w.route.length/w.pace+w.restFrom+w.restTo;}

/** Inside the first tower, walk over, inside the second tower, walk back. */
export function walkerAt(w:DistrictWalker,seconds:number):WalkerState{
 const period=walkerPeriod(w),walk=w.route.length/w.pace,t=((seconds+w.offset)%period+period)%period;
 if(t<w.restFrom)return {visible:false,inside:w.from};
 if(t<w.restFrom+walk)return {visible:true,...along(w.route,(t-w.restFrom)*w.pace,w.lane)};
 if(t<w.restFrom+walk+w.restTo)return {visible:false,inside:w.to};
 return {visible:true,...along(w.route,w.route.length-(t-w.restFrom-walk-w.restTo)*w.pace,-w.lane)};
}

/**
 * How many simulated people to draw. KC's original twelve rail commuters always show; the rest
 * scale with the quality governor (each level that trades pixels for speed draws fewer people)
 * and with Battery saver (half), so the crowd never costs a slow Mac its frame rate.
 */
export function crowdLimit(total:number,{qualityLevel,saver,base=12}:{qualityLevel:number;saver:boolean;base?:number}){
 const extra=Math.max(0,total-base),share=[1,.75,.5,.25][Math.min(3,Math.max(0,qualityLevel))]*(saver?.5:1);
 return Math.min(total,base+Math.round(extra*share));
}
