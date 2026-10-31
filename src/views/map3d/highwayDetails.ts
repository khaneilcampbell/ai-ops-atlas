import {HIGHWAY,distanceToRoad} from './highway';
import type {Pt} from './roads';
import type {HighwayAccess} from './highwayAccess';
const LIGHTS={spacing:8,start:3,setback:.08} as const;
/** Plan poles and bulbs together; keep the complete junction opening clear. */
export function highwayLightPositions(path:Pt[],openings:Pt[]):Pt[]{
 const positions:Pt[]=[];
 for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<=6)continue;
  const dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length,offset=HIGHWAY.barrier+LIGHTS.setback;
  for(let t=LIGHTS.start;t<length;t+=LIGHTS.spacing){
   const p:Pt=[a[0]+dx*t+dz*offset,a[1]+dz*t-dx*offset];
   if(!openings.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<HIGHWAY.junctionRadius+.05))positions.push(p);
  }
 }
 return positions;
}
/** Structural crossbeams follow the same tapered profile as the asphalt above them. */
export function profileWidthAt(profile:{points:Pt[];widths:number[]},point:Pt):number{
 let closest=Infinity,width=profile.widths[0]??HIGHWAY.width;
 for(let i=1;i<profile.points.length;i++){
  const a=profile.points[i-1],b=profile.points[i],d=distanceToRoad(point,[a,b]);if(d>=closest)continue;
  const dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
  const t=length2?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/length2)):0;
  closest=d;width=profile.widths[i-1]+(profile.widths[i]-profile.widths[i-1])*t;
 }
 return width;
}
/** Each paired interchange has an inbound arrow and an outbound arrow. */
export function interchangeArrows(access:Pick<HighwayAccess,'ramps'>[]):{a:Pt;b:Pt}[]{
 return access.flatMap(link=>link.ramps.map((ramp,index)=>{
  const a=ramp[Math.floor((ramp.length-1)*.42)],b=ramp[Math.floor((ramp.length-1)*.5)];
  return index===0?{a:b,b:a}:{a,b};
 }));
}
