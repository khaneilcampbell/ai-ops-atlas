import {TRANSPORT} from "./transportScale";
import type {Pt} from "./roads";
export const HIGHWAY={width:TRANSPORT.highwayWidth,turnWidth:TRANSPORT.highwayTurnWidth,laneOffset:TRANSPORT.highwayLaneOffset,cornerRadius:2.4,shoulder:TRANSPORT.highwayShoulder,barrier:TRANSPORT.highwayBarrier,junctionRadius:1.5,railHeight:.34,supportSpacing:8} as const;
/** Sample gentle bends once; road surfaces and vehicle routes use the same centerline. */
export function roundedRoad(points:Pt[],radius:number,closed=false):Pt[]{
 const source=closed?points.slice(0,-1):points,result:Pt[]=[];
 for(let i=0;i<source.length;i++){
 const p=source[i],before=source[(i+source.length-1)%source.length],after=source[(i+1)%source.length];
 if(!closed&&(i===0||i===source.length-1)){result.push(p);continue;}
 const l0=Math.hypot(p[0]-before[0],p[1]-before[1]),l1=Math.hypot(after[0]-p[0],after[1]-p[1]);
 if(l0<1e-6||l1<1e-6)continue;
 const distance=Math.min(radius,l0*.49,l1*.49);
 const start:Pt=[p[0]+(before[0]-p[0])*distance/l0,p[1]+(before[1]-p[1])*distance/l0],end:Pt=[p[0]+(after[0]-p[0])*distance/l1,p[1]+(after[1]-p[1])*distance/l1];
 for(let j=0;j<=8;j++){const t=j/8,v=1-t;result.push([v*v*start[0]+2*v*t*p[0]+t*t*end[0],v*v*start[1]+2*v*t*p[1]+t*t*end[1]]);}
 }
 if(closed&&result.length)result.push(result[0]);return result;
}
export function distanceToRoad(p:Pt,path:Pt[]):number{
 let closest=Infinity;
 for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));closest=Math.min(closest,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz));}
 return closest;
}

/** Shortest continuous arc on a closed centerline; no assumptions about its corner count. */
export function closedRoadArc(path:Pt[],from:Pt,to:Pt):Pt[]{
 if(path.length<3)return [];
 const lengths=[0];for(let i=1;i<path.length;i++)lengths.push(lengths[i-1]+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));
 const total=lengths[lengths.length-1];if(total<.001)return [];
 const at=(p:Pt)=>{let best=Infinity,distance=0;
  for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1))),gap=Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);if(gap<best){best=gap;distance=lengths[i-1]+(lengths[i]-lengths[i-1])*t;}}
  return {distance,gap:best};
 };
 const a=at(from),b=at(to);if(a.gap>.001||b.gap>.001)return [];
 const forward=(start:Pt,end:Pt,s:number,e:number)=>{const distance=(e-s+total)%total,vertices=path.slice(0,-1).map((p,i)=>({p,d:(lengths[i]-s+total)%total})).filter(v=>v.d>.001&&v.d<distance-.001).sort((a,b)=>a.d-b.d);return {distance,points:[start,...vertices.map(v=>v.p),end]};};
 const first=forward(from,to,a.distance,b.distance),second=forward(to,from,b.distance,a.distance);
 return first.distance<=second.distance?first.points:second.points.reverse();
}

/** Shared mitered offsets for lanes, edges and barriers; closed loops retain their seam. */
export function offsetRoad(path:Pt[],offset:number|number[],taper=false):Pt[]{
 if(path.length<2)return path;
 const closed=Math.hypot(path[0][0]-path[path.length-1][0],path[0][1]-path[path.length-1][1])<1e-6;
 const points=closed?path.slice(0,-1):path;
 const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
 const total=lengths[lengths.length-1];
 const normal=(a:Pt,b:Pt):Pt=>{const d=Math.hypot(b[0]-a[0],b[1]-a[1])||1;return [-(b[1]-a[1])/d,(b[0]-a[0])/d];};
 const out=points.map((p,i):Pt=>{
  const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];
  const n0=normal(!closed&&i===0?p:a,!closed&&i===0?b:p),n1=normal(!closed&&i===points.length-1?a:p,!closed&&i===points.length-1?p:b);
  const fade=taper&&!closed?Math.min(1,lengths[i]/2.5,(total-lengths[i])/2.5):1;
  const scale=(typeof offset==="number"?offset:offset[i])*fade/Math.max(1,1+n0[0]*n1[0]+n0[1]*n1[1]);
  return [p[0]+(n0[0]+n1[0])*scale,p[1]+(n0[1]+n1[1])*scale];
 });
 if(closed)out.push(out[0]);return out;
}
export function lanePath(path:Pt[],offset:number|number[]=HIGHWAY.laneOffset):Pt[]{return offsetRoad(path,offset,true);}
export interface RoadStrip {a:Pt;b:Pt}
/** Split exact offset lines at junction mouths instead of dropping entire long segments. */
export function roadStrips(path:Pt[],offset:number,junctions:Pt[]=[]):RoadStrip[]{
 const profile=roadProfile(path);
 const offsets=profile.widths.map(w=>Math.abs(offset)<.1?offset:Math.sign(offset)*(Math.abs(offset)+ (w-HIGHWAY.width)/2));
 const line=offsetRoad(profile.points,offsets),out:RoadStrip[]=[];
 for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(length/.3));
  const at=(t:number):Pt=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  for(let j=0;j<n;j++){const start=at(j/n),end=at((j+1)/n);if(junctions.some(p=>distanceToRoad(p,[start,end])<HIGHWAY.junctionRadius))continue;out.push({a:start,b:end});}
 }
 return out;
}

/** Extra swept-path space on short bends; straight highway lanes retain the standard width. */
export function roadWidthAt(path:Pt[],i:number):number{
 const a=path[i-1],b=path[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
 const turns=(p:Pt,q:Pt,r:Pt)=>Math.abs((q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]))>.00001;
 return length<3.6&&((i>1&&turns(path[i-2],a,b))||(i+1<path.length&&turns(a,b,path[i+1])))?HIGHWAY.turnWidth:HIGHWAY.width;
}
export function onRoad(p:Pt,path:Pt[]):boolean{
 return path.slice(1).some((b,i)=>distanceToRoad(p,[path[i],b])<=roadWidthAt(path,i+1)/2+.01);
}

/** Taper swept-path widening into straights instead of changing width at a segment seam. */
export function roadProfile(path:Pt[]):{points:Pt[];widths:number[]}{
 const points:Pt[]=[],widths:number[]=[];
 const closed=path.length>2&&Math.hypot(path[0][0]-path[path.length-1][0],path[0][1]-path[path.length-1][1])<1e-6;
 for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-8)continue;
  const w=roadWidthAt(path,i),wa=Math.max(w,i>1?roadWidthAt(path,i-1):closed?roadWidthAt(path,path.length-1):w),wb=Math.max(w,i+1<path.length?roadWidthAt(path,i+1):closed?roadWidthAt(path,1):w);
  const n=Math.max(1,Math.ceil(length/.3));
  for(let j=points.length?1:0;j<=n;j++){
   const t=j/n;points.push(j===n?b:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
   widths.push(Math.max(w,wa-(wa-w)*Math.min(1,t*length/2),wb-(wb-w)*Math.min(1,(1-t)*length/2)));
  }
 }
 return {points,widths};
}

/** Actual centerline intersections, shared by junction openings on both crossing roads. */
export function roadIntersections(a:Pt[],b:Pt[]):Pt[]{
 const out:Pt[]=[];
 for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++){
  const p=a[i-1],q=b[j-1],rx=a[i][0]-p[0],rz=a[i][1]-p[1],sx=b[j][0]-q[0],sz=b[j][1]-q[1],cross=rx*sz-rz*sx;
  if(Math.abs(cross)<1e-9)continue;
  const dx=q[0]-p[0],dz=q[1]-p[1],t=(dx*sz-dz*sx)/cross,u=(dx*rz-dz*rx)/cross;
  if(t>=-1e-8&&t<=1+1e-8&&u>=-1e-8&&u<=1+1e-8){const v:Pt=[p[0]+rx*t,p[1]+rz*t];if(!out.some(o=>Math.hypot(o[0]-v[0],o[1]-v[1])<.01))out.push(v);}
 }
 return out;
}

/**
 * How much of the highway standard applies along a road: 0 at street level on land, 1 on the
 * highway deck or over water, blending over TRANSPORT.streetToHighway along the road. Ground
 * roads (freight route, collectors) use it so they are drawn and driven as city streets in town.
 */
export function highwayShare(points:Pt[],land:{x:number;z:number;w:number;d:number}[],highway:Pt[]):number[]{
 // Canal crossings between districts stay street bridges; only water out by the highway (the
 // ramps' side of the city edge) takes highway size.
 const elevated=points.map(p=>{const d=distanceToRoad(p,highway);return d<HIGHWAY.width||(d<TRANSPORT.highwayReach&&!land.some(r=>p[0]>r.x&&p[0]<r.x+r.w&&p[1]>r.z&&p[1]<r.z+r.d));});
 const along=[0];for(let i=1;i<points.length;i++)along.push(along[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
 const gap=points.map(()=>Infinity);
 for(let i=0,last=-Infinity;i<points.length;i++){if(elevated[i])last=along[i];gap[i]=along[i]-last;}
 for(let i=points.length-1,next=Infinity;i>=0;i--){if(elevated[i])next=along[i];gap[i]=Math.min(gap[i],next-along[i]);}
 return gap.map(g=>Math.max(0,Math.min(1,1-g/TRANSPORT.streetToHighway)));
}
/** Blend a highway-sized value toward the city street value where the road runs at street level. */
export function streetBlend(city:number,highwayValue:number,share:number):number{return city+(highwayValue-city)*share;}
