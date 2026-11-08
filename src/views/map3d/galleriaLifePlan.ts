import type {GalleriaPlan} from './galleriaPlan';
import type {Pt} from './roads';

/**
 * People and cars round the Atlas Galleria (KC, 2026-11-08): shoppers walking the entrance
 * promenade and round the fountain, a few standing at the forecourt, and drivers who walk out of
 * the entrance to their car, drive it out of the car park, and later come back and park. Scripted
 * loops only: a pose is a pure function of time, nothing is simulated, stored or sent anywhere.
 * They are illustrations of a planned building, not running agents.
 */
export interface GalleriaWalker {id:string;path:Pt[];dwell:number[];speed:number;phase:number}
export interface GalleriaDriver {
 id:string;
 /** Walk from the entrance to the car door. */
 walk:Pt[];
 /** Car route from its bay, out along the aisle, to where it leaves the lot. */
 route:Pt[];
 /** Facing of the parked car (radians, atan2(dx, dz) convention). */
 parkedYaw:number;phase:number;
}
export interface GalleriaLife {walkers:GalleriaWalker[];drivers:GalleriaDriver[]}
export type LifePose={visible:boolean;x:number;z:number;yaw:number;moving:boolean};

export const GALLERIA_LIFE={walkSpeed:.32,carSpeed:.75,
 /** Seconds: getting in or out of the car, waiting away from the lot, shopping inside. */
 board:1.4,away:12,inside:10,maxWalkers:14} as const;

const len=(p:Pt[])=>p.slice(1).reduce((s,q,i)=>s+Math.hypot(q[0]-p[i][0],q[1]-p[i][1]),0);
/** Point and heading at distance d along a polyline. */
export function along(p:Pt[],d:number):{x:number;z:number;yaw:number}{
 let left=Math.max(0,d);
 for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<1e-6)continue;const yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);
  if(left<=l||i===p.length-1){const k=Math.min(1,left/l);return {x:a[0]+(b[0]-a[0])*k,z:a[1]+(b[1]-a[1])*k,yaw};}left-=l;}
 return {x:p[0][0],z:p[0][1],yaw:0};
}
/** Out and back, pausing at each end. */
const outBack=(pts:Pt[],far:number,home:number)=>({path:[...pts,...pts.slice(1,-1).reverse()],dwell:[home,...pts.slice(1,-1).map(()=>0),far,...pts.slice(1,-1).map(()=>0)]});

export function planGalleriaLife(p:GalleriaPlan):GalleriaLife{
 const [e,link,top,end]=p.promenade,f=p.fountain,walkers:GalleriaWalker[]=[];
 const add=(id:string,o:{path:Pt[];dwell:number[]},speed:number,phase:number)=>walkers.push({id,...o,speed,phase});
 // Shoppers between the doors and both ends of the promenade.
 add('promenade-north',outBack([[e[0],e[1]],link,top],3,4),GALLERIA_LIFE.walkSpeed,0);
 add('promenade-south',outBack([[e[0],e[1]],link,end],2.5,5),GALLERIA_LIFE.walkSpeed*.9,6);
 add('promenade-stroll',outBack([top,end],2,2),GALLERIA_LIFE.walkSpeed*.8,11);
 add('promenade-pair',outBack([end,link,[e[0],e[1]]],4,3),GALLERIA_LIFE.walkSpeed*.85,17);
 // A slow loop round the fountain, and people standing by it and at the doors.
 const ring=Array.from({length:10},(_,i):Pt=>{const t=i/10*Math.PI*2;return [f.x+Math.cos(t)*(f.r+.22),f.z+Math.sin(t)*(f.r+.22)];});
 walkers.push({id:'fountain-loop',path:ring,dwell:ring.map((_,i)=>i===0?3:0),speed:GALLERIA_LIFE.walkSpeed*.6,phase:2});
 for(const [i,[dx,dz]] of ([[.3,-.25],[.32,-.05],[-.15,.42]] as Pt[]).entries())walkers.push({id:`standing-${i}`,path:[[f.x+f.r+dx,f.z+dz]],dwell:[1],speed:1,phase:0});
 walkers.push({id:'door-greeter',path:[[e[0]+.25,e[1]-.35]],dwell:[1],speed:1,phase:0});
 const drivers:GalleriaDriver[]=[];
 const lot=p.parking;
 if(lot)lot.slots.forEach((slot,i)=>{
  // Bays face the building (nose toward -z); the car backs into the aisle, then drives east and out.
  const out=lot.x1+.25,exit=Math.min(p.rect.x+p.rect.w+.3,out+.6);
  const route:Pt[]=[[slot.x,slot.z],[slot.x,lot.aisleZ],[slot.x+.35,lot.aisleZ],[out,lot.aisleZ],[exit,lot.aisleZ]];
  const walk:Pt[]=[[e[0],e[1]],link,[link[0],lot.aisleZ],[slot.x+.2,lot.aisleZ],[slot.x+.2,slot.z]];
  drivers.push({id:`driver-${i}`,walk,route,parkedYaw:Math.PI,phase:i*19});
 });
 return {walkers:walkers.slice(0,GALLERIA_LIFE.maxWalkers),drivers};
}

export function walkerAt(w:GalleriaWalker,t:number):LifePose{
 const pts=w.path;if(pts.length===1)return {visible:true,x:pts[0][0],z:pts[0][1],yaw:-Math.PI/2+w.phase,moving:false};
 // Every path is a closed loop: the last point walks back to the first.
 const legs=pts.map((q,i)=>{const r=pts[(i+1)%pts.length];return Math.hypot(r[0]-q[0],r[1]-q[1])/w.speed;});
 const cycle=legs.reduce((s,l)=>s+l,0)+w.dwell.reduce((s,d)=>s+d,0);let u=((t+w.phase)%cycle+cycle)%cycle;
 for(let i=0;i<pts.length;i++){const q=pts[i],r=pts[(i+1)%pts.length],yaw=Math.atan2(r[0]-q[0],r[1]-q[1]);
  if(u<w.dwell[i])return {visible:true,x:q[0],z:q[1],yaw,moving:false};u-=w.dwell[i];
  if(u<legs[i]){const k=u/(legs[i]||1);return {visible:true,x:q[0]+(r[0]-q[0])*k,z:q[1]+(r[1]-q[1])*k,yaw,moving:true};}u-=legs[i];}
 return {visible:true,x:pts[0][0],z:pts[0][1],yaw:0,moving:false};
}

/** Length of one driver's whole loop in seconds. */
export function driverCycle(d:GalleriaDriver){const L=GALLERIA_LIFE,w=len(d.walk)/L.walkSpeed,r=len(d.route)/L.carSpeed;return 2*w+2*r+2*L.board+L.away+L.inside;}

/**
 * Where a driver and their car are at time t. The loop: inside shopping (hidden), walk to the car,
 * get in, drive out, away, drive back in and park, get out, walk back to the doors.
 */
export function driverAt(d:GalleriaDriver,t:number):{person:LifePose;car:LifePose}{
 const L=GALLERIA_LIFE,walkL=len(d.walk),routeL=len(d.route),w=walkL/L.walkSpeed,r=routeL/L.carSpeed;
 const cycle=driverCycle(d);let u=((t+d.phase)%cycle+cycle)%cycle;
 const [sx,sz]=d.route[0],parked:LifePose={visible:true,x:sx,z:sz,yaw:d.parkedYaw,moving:false},hidden:LifePose={visible:false,x:sx,z:sz,yaw:0,moving:false};
 const walking=(k:number,back:boolean):LifePose=>{const dist=back?walkL*(1-k):walkL*k,q=along(d.walk,dist);return {visible:true,x:q.x,z:q.z,yaw:back?q.yaw+Math.PI:q.yaw,moving:true};};
 // Out: the car backs into the aisle (facing the building still), then turns and drives forward.
 const driving=(k:number,back:boolean):LifePose=>{const dist=back?routeL*(1-k):routeL*k,q=along(d.route,dist),reversing=dist<Math.abs(d.route[1][1]-d.route[0][1]);
  return {visible:true,x:q.x,z:q.z,yaw:reversing?d.parkedYaw:back?q.yaw+Math.PI:q.yaw,moving:true};};
 if(u<L.inside)return {person:hidden,car:parked};u-=L.inside;
 if(u<w)return {person:walking(u/w,false),car:parked};u-=w;
 if(u<L.board)return {person:{...walking(1,false),moving:false},car:parked};u-=L.board;
 if(u<r)return {person:hidden,car:driving(u/r,false)};u-=r;
 if(u<L.away)return {person:hidden,car:hidden};u-=L.away;
 if(u<r)return {person:hidden,car:driving(u/r,true)};u-=r;
 if(u<L.board)return {person:{...walking(1,false),moving:false},car:parked};u-=L.board;
 return {person:walking(Math.min(1,u/w),true),car:parked};
}
