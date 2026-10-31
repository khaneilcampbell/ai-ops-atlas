import type {Scene3D,Rect} from './scene';
import {routeAround} from './routing';
import type {Pt} from './roads';
export const DEALERSHIP_KEY='service:bmw-dealership';
export const DEALERSHIP={width:10,depth:8,showroomX:5,showroomZ:2.1,showroomWidth:7.6,showroomDepth:3.2,height:6.09,floorCount:4,mezzanineY:1.52,stairCount:10,aisleZ:6.5,walkX:5,walkWidth:.6} as const;
export interface DisplayCar {x:number;z:number;kind:'coupe'|'suv';color:string}
export interface DealershipPlan extends Rect {road:Pt[];walk:Pt[];drive:Pt[];promenade:Pt[];cars:DisplayCar[]}
/** A new outer parcel, with exact endpoints on the existing street and sidewalk network. */
export function planDealership(scene:Pick<Scene3D,'land'|'paving'|'carBridges'|'towers'|'kiosks'|'retail'>):DealershipPlan|undefined{
 const streets=scene.carBridges.flatMap(b=>b.roads).flat();if(!streets.length||!scene.paving.length)return;
 const access=streets.reduce((a,b)=>b[0]>a[0]?b:a);
 const x=Math.max(...scene.land.map(r=>r.x+r.w))+1.2,z=access[1]-DEALERSHIP.aisleZ;
 const boxes=[...scene.towers,...scene.kiosks,...scene.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
 const entry:Pt=[x+.7,z+DEALERSHIP.aisleZ];
 const road=routeAround(access,entry,boxes,.3);if(!road)return;
 const paths=scene.paving.map(p=>[p.x+p.w/2,p.z+p.d/2] as Pt).filter(p=>!boxes.some(b=>Math.abs(p[0]-b.x)<b.w/2+.3&&Math.abs(p[1]-b.z)<b.d/2+.3));
 paths.sort((a,b)=>Math.hypot(a[0]-x,a[1]-z-7.6)-Math.hypot(b[0]-x,b[1]-z-7.6));
 const landing:Pt=[x+.4,z+7.6];
 const walk=paths.slice(0,5).map(p=>{
  const approach:Pt=[p[0],landing[1]];
  const first=routeAround(p,approach,boxes,.3),last=routeAround(approach,landing,boxes,.3);
  if(!first||!last)return;
  return [...first,...last.slice(1)];
 }).find((p):p is Pt[]=>!!p);if(!walk)return;
 return {x,z,w:DEALERSHIP.width,d:DEALERSHIP.depth,road,walk,
 drive:[entry,[x+9.3,z+6.5],[x+9.3,z+2.1]],
 promenade:[landing,[x+5,z+7.6],[x+5,z+3.7]],
 cars:[{x:x+2,z:z+4.8,kind:'coupe',color:'#2163ad'},{x:x+3.5,z:z+4.8,kind:'coupe',color:'#e7e9e6'},{x:x+6.5,z:z+4.8,kind:'suv',color:'#a5abb0'},{x:x+8,z:z+4.8,kind:'suv',color:'#202b35'}]};
}

/** Upper showroom decks share the original mezzanine pitch and atrium footprint. */
export const dealershipUpperFloors=()=>Array.from({length:DEALERSHIP.floorCount-1},(_,i)=>(i+1)*DEALERSHIP.mezzanineY);
