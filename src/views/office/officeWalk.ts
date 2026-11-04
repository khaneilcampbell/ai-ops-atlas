import type {Pt} from '../map3d/roads';
import {mallDoorway,mallInteriorFloor,MALL_SHAPE,type MallUnit} from './mallInteriorPlan';

export interface OfficeWalk {points:Pt[];length:number;seatYaw:number;delay:number}
export const OFFICE_WALK={speed:.85,rest:12,pause:4,cycle:90,radius:.2} as const;
export function marketplaceWalk(u:MallUnit):OfficeWalk{
 const i=Math.floor(u.front.length/2),f=u.front[i],b=u.back[i],x=(f[0]+b[0])/2,z=(f[1]+b[1])/2,ang=Math.atan2(f[1]-z,f[0]-x);
 const depth=Math.hypot(b[0]-f[0],b[1]-f[1]);
 const along=(d:number,side:number):Pt=>[x+Math.cos(ang)*d-Math.sin(ang)*side,z+Math.sin(ang)*d+Math.cos(ang)*side];
 const seatD=-depth*.15+.7,door=mallDoorway(u),entrance:Pt=[(door.a[0]+door.b[0])/2,(door.a[1]+door.b[1])/2];
 const {inner}=mallInteriorFloor(MALL_SHAPE,u.level);
 const hall=(k:number):Pt=>{const edge=inner[u.index*5+k],front=u.front[k];return [(edge[0]+front[0])/2,(edge[1]+front[1])/2];};
 const points=[along(seatD,.65),along(seatD,-.2),entrance,hall(3),hall(4)];
 return {points,length:points.slice(1).reduce((sum,p,j)=>sum+Math.hypot(p[0]-points[j][0],p[1]-points[j][1]),0),seatYaw:-ang+Math.PI/2,delay:Math.max(0,u.index-1)*7};
}
export function officeWalkAt(route:OfficeWalk,elapsed:number){
 const cycle=Math.max(OFFICE_WALK.cycle,route.length*2/OFFICE_WALK.speed+OFFICE_WALK.rest+OFFICE_WALK.pause+4);
 const t=Math.max(0,elapsed-route.delay)%cycle,travel=route.length/OFFICE_WALK.speed;
 let phase:'seated'|'walking'|'paused'='seated',distance=0,reverse=false;
 if(elapsed>=route.delay&&t>=OFFICE_WALK.rest&&t<OFFICE_WALK.rest+2*travel+OFFICE_WALK.pause){
  if(t<OFFICE_WALK.rest+travel){phase='walking';distance=(t-OFFICE_WALK.rest)*OFFICE_WALK.speed;}
  else if(t<OFFICE_WALK.rest+travel+OFFICE_WALK.pause){phase='paused';distance=route.length;}
  else{phase='walking';reverse=true;distance=route.length-(t-OFFICE_WALK.rest-travel-OFFICE_WALK.pause)*OFFICE_WALK.speed;}
 }
 let remaining=distance;
 for(let i=1;i<route.points.length;i++){
  const a=route.points[i-1],b=route.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
  if(remaining<=len||i===route.points.length-1){const k=Math.min(1,remaining/Math.max(len,1e-9));return {phase,x:a[0]+dx*k,z:a[1]+dz*k,yaw:phase==='seated'?route.seatYaw:Math.atan2(reverse?dx:-dx,reverse?dz:-dz)};}
  remaining-=len;
 }
 return {phase,x:route.points[0][0],z:route.points[0][1],yaw:route.seatYaw};
}
