import {TRANSPORT} from './transportScale';
import type {Pt} from './roads';

/** Where side roads meet a straight east-west street: one clear span of the street per junction. */
export interface JunctionSpan {
 /** World x range of the junction along the street. */
 lo:number;hi:number;
 /** Side roads leave toward -z (north) and/or +z (south). */
 north:boolean;south:boolean;
}

/**
 * Where roads cross the east-west line z, as x ranges a road's width wide; at an angle a road takes
 * more of the line, so its range widens with it. Overlapping ranges merge.
 */
export function crossingsAt(c:number,x0:number,x1:number,roads:Pt[][],half=TRANSPORT.cityWidth/2):[number,number][]{
 const hits:[number,number][]=[];
 for(const road of roads)for(let i=1;i<road.length;i++){
  const a=road[i-1],b=road[i];if((a[1]-c)*(b[1]-c)>0||Math.abs(a[1]-b[1])<1e-9)continue;
  const t=(c-a[1])/(b[1]-a[1]),x=a[0]+(b[0]-a[0])*t;if(t<0||t>1||x<x0||x>x1)continue;
  const sin=Math.abs(b[1]-a[1])/Math.hypot(b[0]-a[0],b[1]-a[1]),w=Math.min(3*half,half/Math.max(sin,.3));
  hits.push([x-w,x+w]);
 }
 hits.sort((p,q)=>p[0]-q[0]);
 const out:[number,number][]=[];
 for(const h of hits){const last=out[out.length-1];if(last&&h[0]<=last[1])last[1]=Math.max(last[1],h[1]);else out.push([...h]);}
 return out;
}

/**
 * Junctions along a straight east-west street at z, from the roads that meet or cross it at right
 * angles. Side roads closer together than a curb's length share one span, so a staggered pair reads
 * as one intersection rather than two overlapping ones.
 */
export function junctionSpans(z:number,x0:number,x1:number,roads:Pt[][],half=TRANSPORT.cityWidth/2,join=.4):JunctionSpan[]{
 const hits=[-1,1].flatMap(side=>crossingsAt(z+side*half,x0,x1,roads,half).map(([lo,hi])=>({lo,hi,north:side<0,south:side>0})));
 hits.sort((p,q)=>p.lo-q.lo);
 const out:JunctionSpan[]=[];
 for(const h of hits){
  const last=out[out.length-1];
  if(last&&h.lo<=last.hi+join){last.hi=Math.max(last.hi,h.hi);last.north||=h.north;last.south||=h.south;continue;}
  out.push({...h});
 }
 return out;
}

/** The junctions on the financial district's main street, and where side roads cross its walks, from every road that can meet it. */
export function financialJunctions(s:{financial?:{x:number;z:number;w:number;street:Pt[];road:Pt[]};freight?:{route:Pt[];access:{collector:Pt[]}[]};transportConnections?:{road:Pt[]}[];carBridges?:{roads:Pt[][]}[]},walkZ:Record<'north'|'south',number>):{spans:JunctionSpan[];walks:Record<'north'|'south',[number,number][]>}{
 const f=s.financial;if(!f?.street.length)return {spans:[],walks:{north:[],south:[]}};
 const roads=[f.road,...(s.freight?[s.freight.route,...s.freight.access.map(a=>a.collector)]:[]),...(s.transportConnections??[]).map(c=>c.road),...(s.carBridges??[]).flatMap(b=>b.roads)];
 return {spans:junctionSpans(f.street[0][1],f.x,f.x+f.w,roads),walks:{north:crossingsAt(f.z+walkZ.north,f.x,f.x+f.w,roads),south:crossingsAt(f.z+walkZ.south,f.x,f.x+f.w,roads)}};
}

type Side='north'|'south';
/** Everything along a straight street that a junction interrupts, in the street's own coordinates. */
export interface IntersectionParts {
 /** Center-line dash positions, none inside a junction or a pedestrian crossing. */
 dashes:number[];
 /** Curb and walk runs on each side, open where a side road leaves that side. */
 curbs:Record<Side,[number,number][]>;
 walks:Record<Side,[number,number][]>;
 /** One flat asphalt patch per junction over the street and its curb line, asphalt where it crosses a walk, and a zebra there. */
 patches:{x:number;y:number;z:number;w:number;h:number;d:number;c:string}[];
}
const ASPHALT='#424b50',ZEBRA='#f7f7f0';
const minus=(x0:number,x1:number,gaps:[number,number][]):[number,number][]=>{
 const out:[number,number][]=[];let at=x0;
 for(const [lo,hi] of [...gaps].sort((p,q)=>p[0]-q[0])){if(lo>at)out.push([at,Math.min(lo,x1)]);at=Math.max(at,hi);if(at>=x1)break;}
 if(at<x1)out.push([at,x1]);
 return out.filter(([lo,hi])=>hi-lo>.05);
};
/**
 * The street's dashes, curbs and walks with each junction cut out, and one patch per junction.
 * Patches lie a millimetre above the street, so nothing beneath them shows through or flickers.
 */
export function intersectionParts(z:number,x0:number,x1:number,crossings:readonly number[],spans:JunctionSpan[],walkZ:Record<Side,number>,walkW:Record<Side,number>,walkCrossings:Record<Side,[number,number][]>,half=TRANSPORT.cityWidth/2):IntersectionParts{
 const dashes:number[]=[];
 for(let x=x0+.8;x<x1-.8;x+=.7)if(!crossings.some(c=>Math.abs(c-x)<.45)&&!spans.some(j=>x>j.lo-.2&&x<j.hi+.2))dashes.push(x);
 const crossingGaps=crossings.map(c=>[c-.35,c+.35] as [number,number]);
 const open=(side:Side,pad:number)=>spans.filter(j=>j[side]).map(j=>[j.lo-pad,j.hi+pad] as [number,number]);
 const curbs={north:minus(x0,x1,[...crossingGaps,...open('north',.04)]),south:minus(x0,x1,[...crossingGaps,...open('south',.04)])};
 const walks={north:minus(x0,x1,walkCrossings.north),south:minus(x0,x1,walkCrossings.south)};
 const patches:IntersectionParts['patches']=[];
 for(const j of spans){
  const zn=z-half-(j.north?.08:0),zs=z+half+(j.south?.08:0),w=j.hi-j.lo,x=(j.lo+j.hi)/2;
  patches.push({x,y:.025,z:(zn+zs)/2,w,h:.036,d:zs-zn,c:ASPHALT});
 }
 // Where a side road crosses a walk: asphalt through the gap and a zebra for the people on it.
 for(const side of ['north','south'] as const)for(const [lo,hi] of walkCrossings[side]){
  patches.push({x:(lo+hi)/2,y:.025,z:walkZ[side],w:hi-lo,h:.06,d:walkW[side],c:ASPHALT});
  for(let s=lo+.1;s<hi-.06;s+=.12)patches.push({x:s,y:.086,z:walkZ[side],w:.055,h:.008,d:walkW[side]*.9,c:ZEBRA});
 }
 return {dashes,curbs,walks,patches};
}
