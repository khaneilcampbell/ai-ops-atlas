import type {Pt,Pt3} from './roads';
import type {Scene3D} from './scene';
import {along,commuterRoute,type CommuterRoute} from './railCommuters';
import {buildStreetGraph,nearestStreet,streetLines} from './streetGraph';

/**
 * Life round Atlas Galleria (KC, 2026-11-08): a paved walk from the entrance out to the nearest
 * street, lamp posts round the building and along the walk, shoppers coming and going and
 * strolling round it, and drivers who walk out to a parked car, back out and drive off the lot,
 * then come back later and walk in again. Pure and deterministic, like the district visitors:
 * the same clock always gives the same picture, and nothing here is a real agent or a real car.
 */
export const GALLERIA_LIFE={
 walkWidth:.5,lampStep:2.1,lampRing:.5,lampHeight:.95,
 pace:.32,drive:1.1,shoppers:8,strollers:5,
 /** A street farther than this from the lot's edge is too far to walk to; the walk stops at the lot. */
 maxStreet:4,
} as const;

export interface GalleriaLamp {x:number;z:number;yaw:number}
export interface GalleriaWalker {route:CommuterRoute;phase:number;pace:number;lane:number;
 /** Out-and-back (a shopper going in) or a closed loop (a stroller round the building). */
 loop:boolean;rest:number}
export interface GalleriaDriver {walk:CommuterRoute;drive:CommuterRoute;car:{x:number;z:number;yaw:number;c:string};offset:number;wait:number;
 /** Backs out of a bay into the aisle (the car park behind the building) rather than pulling straight out (the street court). */
 backOut:boolean}
/** Where the lot is too shallow for the car park behind the building: a row of bays each side of the walk, facing the street. */
export interface GalleriaCourt {pad:{x:number;z:number;w:number;d:number}[];stripes:Pt[];cars:{x:number;z:number;c:string}[]}
export interface GalleriaLife {walk:Pt[];lamps:GalleriaLamp[];walkers:GalleriaWalker[];drivers:GalleriaDriver[];court?:GalleriaCourt}
export type LifePose={visible:false}|{visible:true;x:number;z:number;yaw:number};

const flat=(p:Pt):Pt3=>[p[0],0,p[1]];
const dist=(a:Pt,b:Pt)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
/** A closed outline pushed `k` outward (positive) along each vertex's averaged normal. */
function offset(line:Pt[],k:number):Pt[]{
 const area=line.reduce((a,[x,z],i)=>{const [u,v]=line[(i+1)%line.length];return a+x*v-u*z;},0),sign=area>0?1:-1;
 return line.map(([x,z],i)=>{const [px,pz]=line[(i-1+line.length)%line.length],[nx,nz]=line[(i+1)%line.length],dx=nx-px,dz=nz-pz,l=Math.hypot(dx,dz)||1;return [x+sign*dz/l*k,z-sign*dx/l*k];});
}
/** Points every `step` round a closed line. */
function every(line:Pt[],step:number):{p:Pt;a:number}[]{
 const out:{p:Pt;a:number}[]=[],ring=[...line,line[0]];let carry=0;
 for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],len=dist(a,b);let t=carry;while(t<len){out.push({p:[a[0]+(b[0]-a[0])*t/len,a[1]+(b[1]-a[1])*t/len],a:Math.atan2(b[1]-a[1],b[0]-a[0])});t+=step;}carry=t-len;}
 return out;
}
const inRect=(r:{x:number;z:number;w:number;d:number},[x,z]:Pt,m=0)=>x>r.x-m&&x<r.x+r.w+m&&z>r.z-m&&z<r.z+r.d+m;

export function planGalleriaLife(scene:Scene3D):GalleriaLife|undefined{
 const g=scene.galleria;if(!g)return;
 const L=GALLERIA_LIFE,{rect,footprint:f,entrance:e}=g,east=rect.x+rect.w;
 const graph=buildStreetGraph(streetLines(scene));
 // The entrance walk: straight out of the forecourt to the lot's east edge, then on to the street if one is close.
 const walk:Pt[]=[[e.x,e.z],[east,e.z]];
 const street=nearestStreet(graph,[east,0,e.z]);
 if(street.d<L.maxStreet)walk.push([street.q[0],street.q[2]]);
 // Lamps: a ring a little outside the ground floor, skipping the forecourt and the walk, then pairs along the walk.
 const ring=offset(g.slabs[0],L.lampRing),lamps:GalleriaLamp[]=[];
 const clearOfWalk=([x,z]:Pt)=>!(x>e.x-1.4&&Math.abs(z-e.z)<1.1);
 // A lamp may stand at the lot's edge, but never in a street, on another building or in the car park.
 const blocks=[...scene.towers,...scene.kiosks,...scene.retail].map(b=>({x:b.x-b.size/2,z:b.z-b.size/2,w:b.size,d:b.size}));
 if(scene.mall)blocks.push(scene.mall);
 const offStreet=(p:Pt)=>nearestStreet(graph,[p[0],0,p[1]]).d>.45;
 for(const {p,a} of every(ring,L.lampStep))if(clearOfWalk(p)&&inRect(rect,p,.3)&&offStreet(p)&&!blocks.some(b=>inRect(b,p,.2))&&!(g.parking&&inRect(g.parking.area,p,.2)))lamps.push({x:p[0],z:p[1],yaw:-a});
 for(let i=1;i<walk.length;i++){const a=walk[i-1],b=walk[i],len=dist(a,b),n=Math.floor(len/1.6),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
  for(let k=1;k<=n;k++){const x=a[0]+dx*k*len/(n+1),z=a[1]+dz*k*len/(n+1);for(const s of [-1,1])lamps.push({x:x-dz*s*(L.walkWidth/2+.12),z:z+dx*s*(L.walkWidth/2+.12),yaw:Math.atan2(dx*s,-dz*s)});}}
 // Shoppers walk the entrance walk in and out; strollers circle the building on the lamp ring.
 const walkers:GalleriaWalker[]=[];
 const inbound=commuterRoute([...walk].reverse().map(flat));
 for(let i=0;i<L.shoppers;i++)walkers.push({route:inbound,phase:i*7.3,pace:L.pace*(.85+.3*((i*5)%7)/7),lane:((i%3)-1)*.12,loop:false,rest:6+(i%4)*3});
 const stroll=commuterRoute([...offset(g.slabs[0],L.lampRing-.3),offset(g.slabs[0],L.lampRing-.3)[0]].map(flat));
 for(let i=0;i<L.strollers;i++)walkers.push({route:stroll,phase:i*stroll.length/L.strollers/(L.pace*.8),pace:L.pace*.8,lane:i%2?.08:-.08,loop:true,rest:0});
 // Drivers: out of the entrance, down to their car, then the car backs into the aisle and drives east off the lot.
 const drivers:GalleriaDriver[]=[];let court:GalleriaCourt|undefined;
 const COLORS=['#b7c2c7','#2f3a45','#e8e4da','#8c3b34'];
 const farEnd=(q:Pt3,seg:number):Pt3|undefined=>{const sg=graph.segments[seg];if(!sg)return;const [a,b]=sg.map(n=>graph.nodes[n]);return dist([a[0],a[2]],[q[0],q[2]])>dist([b[0],b[2]],[q[0],q[2]])?[a[0],0,a[2]]:[b[0],0,b[2]];};
 if(!g.parking&&walk.length===3){
  // Bays across the strip between the lot and the street, nose to the street, clear of the walk, trees and lamps.
  // x1 stops short of the street's pavement, which runs about a unit either side of its centre line.
  const sx=walk[2][0],x0=east+.25,x1=sx-1.05,cx=(x0+x1)/2;
  if(x1-x0>=.45){
   const trees=[...scene.trees,...scene.bushes],busy=(x:number,z:number)=>trees.some(t=>Math.abs(t.x-x)<.32&&Math.abs(t.z-z)<.3)||lamps.some(l=>Math.abs(l.x-x)<.32&&Math.abs(l.z-z)<.25);
   court={pad:[],stripes:[],cars:[]};const bays:Pt[]=[];
   for(const [z0,z1] of [[rect.z+.3,e.z-.55],[e.z+.55,rect.z+rect.d-.3]] as const){
    if(z1-z0<.34)continue;court.pad.push({x:x0,z:z0-.05,w:x1-x0,d:z1-z0+.1});
    for(let z=z0+.17;z<=z1-.17;z+=.34){court.stripes.push([cx,z-.17]);if(!busy(cx,z))bays.push([cx,z]);}
    court.stripes.push([cx,z1]);
   }
   bays.forEach(([x,z],k)=>{
    if(k%2)return;const c=COLORS[k%4];
    if(drivers.length<3&&k%4===0){
     const door:Pt=[x,z+(z<e.z?.2:-.2)],walkPts:Pt[]=[[e.x,e.z],[east,e.z],[east+.1,door[1]],door];
     const ex=nearestStreet(graph,[sx,0,z]),drivePts:Pt3[]=[[x,0,z],[sx-.25,0,z]];
     if(ex.d<1){drivePts.push(ex.q);const far=farEnd(ex.q,ex.seg);if(far)drivePts.push(far);}
     drivers.push({walk:commuterRoute(walkPts.map(flat)),drive:commuterRoute(drivePts),car:{x,z,yaw:Math.PI/2,c},offset:drivers.length*23,wait:28+drivers.length*6,backOut:false});
    }else court!.cars.push({x,z,c});
   });
  }
 }
 if(g.parking){
  const pk=g.parking,exitStreet=nearestStreet(graph,[east,0,pk.aisle]),out:Pt=[east+.2,pk.aisle];
  pk.driven.forEach((c,i)=>{
   const side=c.z<pk.aisle?-1:1,door:Pt=[c.x-.18,c.z-side*.05];
   const walkPts:Pt[]=[[e.x,e.z],[e.x,f.z+f.d+.15],[door[0],f.z+f.d+.15],door];
   const drivePts:Pt3[]=[[c.x,0,c.z],[c.x,0,pk.aisle],[out[0],0,out[1]]];
   if(exitStreet.d<L.maxStreet){drivePts.push(exitStreet.q);const far=farEnd(exitStreet.q,exitStreet.seg);if(far)drivePts.push(far);}
   drivers.push({walk:commuterRoute(walkPts.map(flat)),drive:commuterRoute(drivePts),car:{x:c.x,z:c.z,yaw:0,c:c.c},offset:i*23,wait:28+i*6,backOut:true});
  });
 }
 return {walk,lamps,walkers,drivers,court};
}

/** A shopper or stroller at time t. Shoppers walk in, stay inside a while, then walk back out. */
export function walkerAt(w:GalleriaWalker,t:number):LifePose{
 const len=w.route.length;if(!len)return {visible:false};
 if(w.loop){const p=along(w.route,((t*w.pace+w.phase*w.pace)%len+len)%len,w.lane);return {visible:true,x:p.x,z:p.z,yaw:p.yaw};}
 const leg=len/w.pace,period=2*(leg+w.rest),u=((t+w.phase)%period+period)%period;
 if(u<leg){const p=along(w.route,u*w.pace,w.lane);return {visible:true,x:p.x,z:p.z,yaw:p.yaw};}
 if(u<leg+w.rest)return {visible:false};
 if(u<2*leg+w.rest){const p=along(w.route,len-(u-leg-w.rest)*w.pace,-w.lane);return {visible:true,x:p.x,z:p.z,yaw:p.yaw+Math.PI};}
 return {visible:false};
}

/** One driver's whole cycle: walk out, drive off, away, drive back, park, walk in, inside. */
export function driverAt(d:GalleriaDriver,t:number):{person:LifePose;car:LifePose&{moving?:boolean}}{
 const L=GALLERIA_LIFE,walk=d.walk.length/L.pace,drive=d.drive.length/L.drive,inside=d.wait;
 const period=2*walk+2*drive+d.wait+inside,u=((t+d.offset)%period+period)%period;
 const parked={visible:true as const,x:d.car.x,z:d.car.z,yaw:d.car.yaw};
 const at=(r:CommuterRoute,dd:number,flip=false)=>{const p=along(r,dd,0);return {visible:true as const,x:p.x,z:p.z,yaw:p.yaw+(flip?Math.PI:0)};};
 let s=u;
 if(s<walk)return {person:at(d.walk,s*L.pace),car:parked};s-=walk;
 // Backing out of the bay faces the car the way it parked; once in the aisle it drives forwards.
 if(s<drive){const dd=s*L.drive,first=d.drive.lengths[1]??0;return {person:{visible:false},car:{...at(d.drive,dd,d.backOut&&dd<first),moving:true}};}s-=drive;
 if(s<d.wait)return {person:{visible:false},car:{visible:false}};s-=d.wait;
 if(s<drive){const dd=d.drive.length-s*L.drive,first=d.drive.lengths[1]??0;return {person:{visible:false},car:{...at(d.drive,dd,dd>first),moving:true}};}s-=drive;
 if(s<walk)return {person:at(d.walk,d.walk.length-s*L.pace,true),car:parked};
 return {person:{visible:false},car:parked};
}
