import {TRANSPORT} from "./transportScale";
import {pathClear,type Box,type Pt} from './roads';
import {routeAround} from './routing';
import {roundedRoad,distanceToRoad,roadProfile} from './highway';
export const ACCESS={setback:6,cornerRadius:4,mergeLength:4,collectorSetback:3.5,radius:2.5} as const;
export interface HighwayAccess {id:string;collector:Pt[];ramps:Pt[][];mouths:Pt[];junction:Pt}
/** Pure planning: paired tangential ramps connect a local collector to a straight perimeter section. */
export function planHighwayAccess(highway:Pt[],links:{id?:string;road:Pt[];frontage?:Pt[]}[],boxes:Box[]):HighwayAccess[]{
 const left=Math.min(...highway.map(p=>p[0])),right=Math.max(...highway.map(p=>p[0])),top=Math.min(...highway.map(p=>p[1])),bottom=Math.max(...highway.map(p=>p[1]));
 const out:HighwayAccess[]=[];
 const bezier=(a:Pt,b:Pt,c:Pt,d:Pt)=>Array.from({length:25},(_,i):Pt=>{const t=i/24,u=1-t;return [u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]];});
 for(const link of links){
  // BMW shares the Financial District street (and its ramp) since moving beside the district.
  if(!['skyline-airport','financial-district','profile-stadium'].includes(link.id??'')||!link.road.length)continue;
  const anchors=link.road.flatMap((p,i)=>{if(!i)return [p];const a=link.road[i-1],n=Math.max(1,Math.ceil(Math.hypot(p[0]-a[0],p[1]-a[1])/2));return Array.from({length:n},(_,j):Pt=>[a[0]+(p[0]-a[0])*(j+1)/n,a[1]+(p[1]-a[1])*(j+1)/n]);});
  // Compare a bounded set of nearby anchors on each side after districts move.
  const candidates=(['left','right','top','bottom'] as const).flatMap(side=>{
   const vertical=side==='right'||side==='left',edge=side==='right'?right:side==='left'?left:side==='top'?top:bottom,sign=side==='top'||side==='left'?-1:1;
   return [...anchors].sort((a,b)=>Math.abs(a[vertical?0:1]-edge)-Math.abs(b[vertical?0:1]-edge)).slice(0,6).map(junction=>{
   const clamp=(v:number)=>Math.max((vertical?top:left)+9,Math.min((vertical?bottom:right)-9,v));
   const base=clamp(junction[vertical?1:0]),separation=ACCESS.mergeLength*2+4;
   const along=[0,separation,-separation,2*separation,-2*separation].map(offset=>clamp(base+offset)).find(at=>[-1,1].every(direction=>{
    const mouth:Pt=vertical?[edge,at+direction*ACCESS.mergeLength]:[at+direction*ACCESS.mergeLength,edge];
    return distanceToRoad(mouth,highway)<.001&&!out.some(a=>a.mouths.some(m=>Math.hypot(m[0]-mouth[0],m[1]-mouth[1])<4));
   }));if(along===undefined)return;
   const node:Pt=vertical?[edge-sign*ACCESS.collectorSetback,along]:[along,edge-sign*ACCESS.collectorSetback];
   const raw=routeAround(junction,node,boxes,.95);if(!raw)return;
   const clean=raw.filter((p,i)=>!i||Math.hypot(p[0]-raw[i-1][0],p[1]-raw[i-1][1])>.001);
   const collector=[ACCESS.radius,1.2,.45].map(r=>roundedRoad(clean,r)).find(p=>pathClear(p,boxes,.73));if(!collector)return;
   const mouths:Pt[]=[],ramps=[-1,1].map(direction=>{
    const mouth:Pt=vertical?[edge,along+direction*ACCESS.mergeLength]:[along+direction*ACCESS.mergeLength,edge];mouths.push(mouth);
    const c1:Pt=vertical?[edge-sign,along]:[along,edge-sign],c2:Pt=vertical?[edge,along+direction*1.8]:[along+direction*1.8,edge];
    return bezier(node,c1,c2,mouth);
   });
   if(!pathClear(collector,boxes,.73)||ramps.some(p=>!pathClear(p,boxes,.73))||mouths.some(p=>distanceToRoad(p,highway)>.001))return;
   const length=collector.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-collector[i][0],p[1]-collector[i][1]),0);
   return {id:link.id!,collector,ramps,mouths,junction,length};
   });
  }).filter((p):p is NonNullable<typeof p>=>!!p);
  // Where the district has a street facing the highway, prefer a straight collector that leaves it
  // at a right angle: one clean T-junction instead of a lane doubled along the street before it turns.
  for(const [a,b] of (link.frontage??[]).slice(1).map((q,i)=>[link.frontage![i],q] as const)){
   if(Math.abs(a[1]-b[1])>1e-6)continue;
   for(const side of ['top','bottom'] as const){
    const edge=side==='top'?top:bottom,sign=side==='top'?-1:1,z0=a[1];if(sign*(edge-z0)<=ACCESS.collectorSetback+2)continue;
    for(let x=Math.min(a[0],b[0])+1;x<=Math.max(a[0],b[0])-1;x+=.25){
     if(x<left+9||x>right-9)continue;
     const mouths:Pt[]=[-1,1].map(d=>[x+d*ACCESS.mergeLength,edge]);
     if(mouths.some(m=>distanceToRoad(m,highway)>.001||out.some(o=>o.mouths.some(n=>Math.hypot(n[0]-m[0],n[1]-m[1])<4))))continue;
     const node:Pt=[x,edge-sign*ACCESS.collectorSetback],collector:Pt[]=[[x,z0],node];
     if(!pathClear(collector,boxes,.95))continue;
     const ramps=[-1,1].map(d=>bezier(node,[x,edge-sign],[x+d*1.8,edge],mouths[(d+1)/2]));
     if(ramps.some(p=>!pathClear(p,boxes,.73)))continue;
     candidates.push({id:link.id!,collector,ramps,mouths,junction:[x,z0],length:Math.abs(node[1]-z0)});
    }
   }
  }
  candidates.sort((a,b)=>a.length-b.length);
  const best=candidates.find(p=>!out.some(a=>a.mouths.some(m=>p.mouths.some(n=>Math.hypot(m[0]-n[0],m[1]-n[1])<4))));if(best)out.push(best);
 }
 return out;
}

/** Collector streets widen gradually toward the interchange instead of changing scale at a seam. */
export function collectorProfile(path:Pt[]){
 const profile=roadProfile(path),distances=[0];
 for(let i=1;i<profile.points.length;i++)distances.push(distances[i-1]+Math.hypot(profile.points[i][0]-profile.points[i-1][0],profile.points[i][1]-profile.points[i-1][1]));
 const taper=Math.min(3,distances[distances.length-1]??0)||1;
 return {...profile,widths:profile.widths.map((w,i)=>TRANSPORT.cityWidth+(w-TRANSPORT.cityWidth)*Math.min(1,distances[i]/taper))};
}
