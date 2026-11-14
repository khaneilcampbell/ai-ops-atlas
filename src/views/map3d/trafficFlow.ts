import {vehicleAt,vehicleVisible,type VehiclePlan} from './vehicles';
import {vehicleBounds} from './vehicleModels';

/**
 * Car following for the decorative fleet (Khaneil, 2026-11-13: "make sure no vehicles collide, operate like real
 * human traffic"). Junctions take turns, first come first served, and every vehicle keeps its route; what changes is how far along it is. Each step a vehicle checks
 * where its own footprint will be a moment ahead on its route, through turns and junctions alike: if that would
 * touch another vehicle it stops, if a longer look ahead would it slows, otherwise it eases back to cruising. Two vehicles that
 * block each other (a junction stand-off) are settled by giving way to the lower index; anyone held for long gives
 * way to nobody for a moment, so traffic can never lock up. No allocation in step() beyond vehicleAt's pose.
 */
export const TRAFFIC={box:.55,gap:.05,near:1,far:2,height:.2,accel:4,stuck:6,release:1,warmup:6,catchUp:2,rejoin:8} as const;

export interface TrafficFlow {times:Float64Array;step(dt:number):void}

/**
 * `clock` (optional) is the train clock: a scheduled vehicle (a travel-loop shuttle) still stops for traffic, then drives
 * up to TRAFFIC.catchUp times faster until it is back on its timetable; far off it (a new scene) it rejoins at once.
 */
export function trafficFlow(plans:VehiclePlan[],junctions:[number,number][]=[],clock?:()=>number|undefined):TrafficFlow{
 let own=-TRAFFIC.warmup;
 const n=plans.length,times=new Float64Array(n),speed=new Float64Array(n).fill(1),held=new Float64Array(n),free=new Float64Array(n);
 const x=new Float64Array(n),z=new Float64Array(n),y=new Float64Array(n),dx=new Float64Array(n).fill(1),dz=new Float64Array(n),on=new Uint8Array(n);
 const half=Float64Array.from(plans,v=>{const b=vehicleBounds(v.kind);return (b.front-b.rear)/2;}),width=Float64Array.from(plans,v=>vehicleBounds(v.kind).halfWidth);
 const blocker=new Int32Array(n);
 // Oriented footprints, inflated by half the safety gap: do two of them overlap (separating-axis test)?
 const hit=(ax:number,az:number,aux:number,auz:number,al:number,aw:number,bx:number,bz:number,bux:number,buz:number,bl:number,bw:number)=>{
  for(let k=0;k<4;k++){const nx=k===0?aux:k===1?-auz:k===2?bux:-buz,nz=k===0?auz:k===1?aux:k===2?buz:bux;
   const ra=al*Math.abs(aux*nx+auz*nz)+aw*Math.abs(-auz*nx+aux*nz),rb=bl*Math.abs(bux*nx+buz*nz)+bw*Math.abs(-buz*nx+bux*nz);
   if(Math.abs((bx-ax)*nx+(bz-az)*nz)>=ra+rb)return false;}
  return true;
 };
 const nearX=new Float64Array(n),nearZ=new Float64Array(n),nearU=new Float64Array(n),nearV=new Float64Array(n),farX=new Float64Array(n),farZ=new Float64Array(n),farU=new Float64Array(n),farV=new Float64Array(n);
 // Heading from the route; at a junction stop the direction shrinks to nothing, so the last good heading holds.
 const pose=(i:number,t:number,o:Float64Array[],k:number)=>{const a=vehicleAt(plans[i],t),l=Math.hypot(a.dx,a.dz);o[0][k]=a.x;o[1][k]=a.z;if(l>.2){o[2][k]=a.dx/l;o[3][k]=a.dz/l;}else if(o[2]!==dx){o[2][k]=dx[k];o[3][k]=dz[k];}return a;};
 const at=new Int32Array(n),inBox=new Uint8Array(n),dist=new Float64Array(n),hard=new Uint8Array(n),level=new Float64Array(n),midX=new Float64Array(n),midZ=new Float64Array(n),midU=new Float64Array(n),midV=new Float64Array(n);
 const step=(dt:number)=>{
  own+=dt;const now=clock?.()??own;
  for(let i=0;i<n;i++){const a=pose(i,times[i],[x,z,dx,dz],i);y[i]=a.y;on[i]=vehicleVisible(plans[i],times[i])?1:0;pose(i,times[i]+TRAFFIC.near/2,[midX,midZ,midU,midV],i);pose(i,times[i]+TRAFFIC.near,[nearX,nearZ,nearU,nearV],i);pose(i,times[i]+TRAFFIC.far,[farX,farZ,farU,farV],i);}
  for(let i=0;i<n;i++){
   blocker[i]=-1;level[i]=1;hard[i]=0;if(!on[i])continue;
   const l=half[i]+TRAFFIC.gap/2,w=width[i]+TRAFFIC.gap/2;
   for(let j=0;j<n;j++){if(j===i||!on[j]||Math.abs(y[j]-y[i])>TRAFFIC.height)continue;
    const lj=half[j]+TRAFFIC.gap/2,wj=width[j]+TRAFFIC.gap/2;
    // Already touching: keep going only when the other is clearly behind (it is the one that waits).
    const ahead=(x[j]-x[i])*dx[i]+(z[j]-z[i])*dz[i]>0;
    const touching=hit(x[i],z[i],dx[i],dz[i],l,w,x[j],z[j],dx[j],dz[j],lj,wj);
    if(touching&&ahead)hard[i]=1;
    if((touching&&(ahead||(x[i]-x[j])*dx[j]+(z[i]-z[j])*dz[j]<=0))||(!touching&&(hit(nearX[i],nearZ[i],nearU[i],nearV[i],l,w,x[j],z[j],dx[j],dz[j],lj,wj)||hit(midX[i],midZ[i],midU[i],midV[i],l,w,x[j],z[j],dx[j],dz[j],lj,wj)||hit(midX[i],midZ[i],midU[i],midV[i],l,w,midX[j],midZ[j],midU[j],midV[j],lj,wj)||hit(nearX[i],nearZ[i],nearU[i],nearV[i],l,w,nearX[j],nearZ[j],nearU[j],nearV[j],lj,wj)))){level[i]=0;blocker[i]=j;break;}
    if(level[i]>.4&&hit(farX[i],farZ[i],farU[i],farV[i],l,w,x[j],z[j],dx[j],dz[j],lj,wj)){level[i]=.4;blocker[i]=j;}
   }
  }
  // Junctions take turns (first come, first served): find each vehicle's junction ahead and whether it is in it.
  for(let i=0;i<n;i++){at[i]=-1;if(!on[i])continue;for(let k=0;k<junctions.length;k++){const [jx,jz]=junctions[k];
   const dNow=Math.hypot(x[i]-jx,z[i]-jz),dNear=Math.hypot(nearX[i]-jx,nearZ[i]-jz);if(dNow<TRAFFIC.box||dNear<TRAFFIC.box){at[i]=k;inBox[i]=dNow<TRAFFIC.box?1:0;dist[i]=dNow;break;}}}
  for(let i=0;i<n;i++){if(at[i]<0||inBox[i])continue;
   for(let j=0;j<n;j++){if(j===i||at[j]!==at[i]||Math.abs(dx[i]*dx[j]+dz[i]*dz[j])>.9&&dx[i]*dx[j]+dz[i]*dz[j]>0)continue;
    if(inBox[j]||dist[j]<dist[i]-1e-6||(Math.abs(dist[j]-dist[i])<=1e-6&&j<i)){level[i]=0;if(blocker[i]<0)blocker[i]=j;break;}}}
  for(let i=0;i<n;i++){
   const j=blocker[i];let target=level[i];
   // Stand-off (both would meet): the one already further in (the other barely ahead of it) goes; ties by index.
   if(target===0&&j>=0&&blocker[j]===i&&level[j]===0){const mine=(x[j]-x[i])*dx[i]+(z[j]-z[i])*dz[i],theirs=(x[i]-x[j])*dx[j]+(z[i]-z[j])*dz[j];if(mine<theirs-1e-6||(Math.abs(mine-theirs)<=1e-6&&i<j))target=1;}
   if(free[i]>0){free[i]-=dt;target=hard[i]?0:1;}   // a released car still never drives into one it touches
   if(plans[i].scheduled){const lag=now-times[i];if(Math.abs(lag)>TRAFFIC.rejoin){times[i]=now;speed[i]=1;continue;}if(target>0)target=Math.max(0,Math.min(TRAFFIC.catchUp,1+lag));}
   speed[i]=target===0?0:speed[i]+(target-speed[i])*Math.min(1,dt*TRAFFIC.accel);
   held[i]=speed[i]<.05?held[i]+dt:0;if(held[i]>TRAFFIC.stuck){held[i]=0;free[i]=TRAFFIC.release;}
   times[i]+=dt*speed[i];
  }
 };
 // Settle the start so no two vehicles begin inside each other (scheduled ones start on time, at the warm-up's start).
 plans.forEach((v,i)=>{if(v.scheduled)times[i]=own;});
 for(let k=0;k<TRAFFIC.warmup*10;k++)step(.1);
 return {times,step};
}
