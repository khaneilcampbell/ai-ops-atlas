import type {Rect,Slab} from './scene';
import type {Box,Pt} from './roads';
import {uncoveredLand} from './neighborhoodLinks';
import {distanceToRoad} from './highway';

/**
 * Benjaire Marketing Agency, on new land in the open bay between Benjaire HQ, Benjaire Dashboard
 * and the Financial District (KC, 2026-10-31). An original Atlas building: a monolithic cream
 * mass cut by a diagonal glazed slot, a perforated diamond screen that fades from dense to sparse,
 * and a copper-framed sweep of glass over a reflecting-pool plaza.
 *
 * Plan proportions follow a 96 m by 48 m footprint at one map unit to ten metres. Museum storeys
 * are about 5 m, 1.5 times an office storey, so a storey here is three office floors (FLOOR_H .32).
 */
export const AGENCY_KEY='service:benjaire-marketing';
export const AGENCY_NAME='Benjaire Marketing Agency';
export const AGENCY={
 length:9.6,depth:4.8,storeys:4,
 /** Three of the original office floors (0.32), about 5 m, the height of a gallery storey. */
 storey:.96,
 /** West block roof, and the east block's roof rising toward the river corner. */
 westH:3.1,eastLow:3.1,eastHigh:3.84,
 /** The diagonal slot: centre line as a share of the length at the north and south faces, and width. */
 cutNorth:.37,cutSouth:.25,cutW:.5,cutH:2.96,
 /** Copper sweep on the south face, and the pointed arch on the east face. */
 sweep:{from:.3,pier:.32,apex:.86,h:2.78},
 arch:{centre:.56,half:1.25,h:2.85},
 inset:.28,frame:.13,
 /** The Benjaire sign on the west block's south face (local centre x, y, size), centred between the
  *  west corner and the slot (face 0 to 2.15) and set in a plain panel of the screen. */
 word:{x:1.075,y:2.36,w:1.75,h:.62},
 /** Lot needs at least this much open water; the building sits this far from the north shore. */
 minLot:{w:12.5,d:8.6},northSetback:.95,
 /** Plaza in front of the building: the reflecting pool and the causeway to the entrance. */
 pool:{d:2.5,gap:.55,causeway:1.1},
} as const;

export interface AgencyPlan {
 /** New meadow land filling the bay, and the raised ground the building and plaza stand on. */
 land:Rect[];plinth:Rect[];
 /** Building footprint (minimum corner, long side along x). */
 x:number;z:number;w:number;d:number;cx:number;cz:number;
 /** Reflecting pool halves either side of the entrance causeway. */
 pools:Rect[];
 paving:Slab[];
 /** Pedestrian routes onto the plaza from the neighbouring districts. */
 walks:Pt[][];
 trees:Pt[];
 /** The entrance, under the copper sweep. */
 entry:Pt;
}

/**
 * Largest open rectangle along the city's north edge (the shore facing the Financial District),
 * on a 0.1 grid, clear of every parcel and road given. Returns undefined when nothing that big
 * is open, so other groupings without the bay simply leave the building out.
 */
export function findBayLot(city:Rect[],land:Rect[],roads:Pt[][],min:{w:number;d:number}):Rect|undefined{
 const big=city.filter(r=>r.w*r.d>=4);if(!big.length)return;
 const x0=Math.min(...big.map(r=>r.x)),z0=Math.min(...big.map(r=>r.z)),x1=Math.max(...big.map(r=>r.x+r.w)),z1=Math.max(...big.map(r=>r.z+r.d));
 // Only a band along the north shore is searched: the lot never needs to reach deeper than this.
 const step=.1,cols=Math.floor((x1-x0)/step),rows=Math.min(Math.floor((z1-z0)/step),Math.ceil((min.d+4)/step));
 // Rasterise every parcel and road once (roads with a 0.6 margin), then read free runs off the grid.
 const busy=new Uint8Array(cols*rows),mark=(c0:number,c1:number,r0:number,r1:number)=>{for(let r=Math.max(0,r0);r<=Math.min(rows-1,r1);r++)busy.fill(1,r*cols+Math.max(0,c0),r*cols+Math.min(cols-1,c1)+1);};
 const cell=(x:number)=>Math.floor((x-x0)/step),rowOf=(z:number)=>Math.floor((z-z0)/step);
 for(const r of land){if(r.x>x1||r.x+r.w<x0||r.z>z1||r.z+r.d<z0)continue;mark(cell(r.x+.001),Math.ceil((r.x+r.w-.001-x0)/step)-1,rowOf(r.z+.001),Math.ceil((r.z+r.d-.001-z0)/step)-1);}
 const pad=.6;
 for(const p of roads)for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));
  for(let k=0;k<=n;k++){const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;if(x<x0-pad||x>x1+pad||z<z0-pad||z>z1+pad)continue;mark(cell(x-pad),cell(x+pad),rowOf(z-pad),rowOf(z+pad));}}
 // Free run down from the north edge, per column.
 const run:number[]=[];
 for(let c=0;c<cols;c++){let n=0;while(n<rows&&!busy[n*cols+c])n++;run.push(n);}
 let best:{c0:number;c1:number;h:number}|undefined;
 const stack:number[]=[];
 for(let c=0;c<=cols;c++){
  const h=c<cols?run[c]:0;
  while(stack.length&&run[stack[stack.length-1]]>=h){
   const top=stack.pop()!,height=run[top],left=stack.length?stack[stack.length-1]+1:0,width=c-left;
   if(width*step>=min.w&&height*step>=min.d&&(!best||width*height>(best.c1-best.c0)*best.h))best={c0:left,c1:c,h:height};
  }
  stack.push(c);
 }
 if(!best)return;
 return {x:x0+best.c0*step,z:z0,w:(best.c1-best.c0)*step,d:best.h*step};
}

/** Whether a road passes within pad of a rectangle (sampled every 0.1 along the road). */
export function roadCrosses(road:Pt[],r:Rect,pad:number){
 for(let i=1;i<road.length;i++){const a=road[i-1],b=road[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.1));
  for(let k=0;k<=n;k++){const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;if(x>r.x-pad&&x<r.x+r.w+pad&&z>r.z-pad&&z<r.z+r.d+pad)return true;}}
 return false;
}
const slab=(r:Rect,y:number,h=.03):Slab=>({...r,y,h});
function pathStrip(a:Pt,b:Pt,w:number,y:number):Slab{
 const x=Math.min(a[0],b[0])-(a[0]===b[0]?w/2:0),z=Math.min(a[1],b[1])-(a[1]===b[1]?w/2:0);
 return {x,z,w:a[0]===b[0]?w:Math.abs(b[0]-a[0]),d:a[1]===b[1]?w:Math.abs(b[1]-a[1]),y,h:.03};
}

export interface AgencyInput {
 /** The city's own district land, before any outer parcels. */
 city:Rect[];
 /** Every parcel planned so far (city, airport, stadium, BMW, Financial District, links...). */
 land:Rect[];
 /** Roads and rails that may cross the water, so the lot never covers them. */
 roads:Pt[][];
 /** Terrace-height paving the plaza paths may join. */
 paving:Slab[];
 /** Buildings to keep paths and trees clear of. */
 obstacles:Box[];
 /** District terraces, already at terrace height. */
 terraces:Rect[];
 top:number;
}

/**
 * How far past the agency's land the south path may look for the next district's paving. Wide
 * enough to reach Benjaire Dashboard when a widened district (Commerce, #176) pushes it a street further south.
 */
const AGENCY_REACH=5.5;
export function planAgency(s:AgencyInput):AgencyPlan|undefined{
 const lot=findBayLot(s.city,s.land,s.roads,AGENCY.minLot);if(!lot)return;
 const {length:w,depth:d}=AGENCY,top=s.top;
 const cx=lot.x+lot.w/2,z=lot.z+AGENCY.northSetback,x=cx-w/2;
 const plazaZ=z+d,pool=AGENCY.pool,poolZ=plazaZ+pool.gap;
 if(poolZ+pool.d>lot.z+lot.d-.6)return;
 // Fill the rest of the inlet south of the lot, where it is open water between the districts. Small
 // headland slivers under it stay as they are; the raised ground simply covers them.
 const bigLand=s.land.filter(r=>r.w*r.d>=4);
 const fill=uncoveredLand({x:lot.x,z:lot.z+lot.d,w:lot.w,d:3},bigLand).filter(r=>r.z<=lot.z+lot.d+.001&&r.w>1&&r.d>.4&&!s.roads.some(p=>roadCrosses(p,r,.6)));
 const land=[lot,...fill.flatMap(r=>uncoveredLand(r,s.land))];
 const plinth=[lot,...fill].map(r=>({...r}));
 const [u0,u1]=sweepSpan(),entryX=x+u0+(u1-u0)*.42;
 const entry:Pt=[entryX,plazaZ+.05];
 const half=pool.causeway/2;
 const pools:Rect[]=[{x:x+.2,z:poolZ,w:entryX-half-x-.2,d:pool.d},{x:entryX+half,z:poolZ,w:x+w-.2-entryX-half,d:pool.d}];
 const paving:Slab[]=[
  // Forecourt along the whole front, the causeway over the pool, and a promenade beyond it.
  slab({x:x-.3,z:plazaZ,w:w+.6,d:pool.gap},top),
  slab({x:entryX-half,z:poolZ,w:pool.causeway,d:pool.d},top),
  slab({x:x-.3,z:poolZ+pool.d,w:w+.6,d:.55},top),
  // Pool coping, a stone kerb all round.
  ...pools.flatMap(p=>[slab({x:p.x-.08,z:p.z-.08,w:p.w+.16,d:.08},top,.05),slab({x:p.x-.08,z:p.z+p.d,w:p.w+.16,d:.08},top,.05),slab({x:p.x-.08,z:p.z,w:.08,d:p.d},top,.05),slab({x:p.x+p.w,z:p.z,w:.08,d:p.d},top,.05)]),
  // A walk round the building, so the screen can be seen up close.
  slab({x:x-.55,z:z-.45,w:.3,d:d+.45},top),slab({x:x+w+.25,z:z-.45,w:.3,d:d+.45},top),slab({x:x-.55,z:z-.45,w:w+1.1,d:.3},top),
 ];
 // Paths out to the nearest terrace paving to the west and to the south, raised across any gap.
 const walks:Pt[][]=[];const promenadeZ=poolZ+pool.d+.27,walkX=x-.4;
 const raised=s.paving.filter(p=>p.y>=top-.001);
 const westTo=raised.filter(p=>p.x+p.w<lot.x+.01&&p.x+p.w>lot.x-4&&p.z+p.d>plazaZ+.2&&p.z<lot.z+lot.d-.3).sort((a,b)=>b.x+b.w-a.x-a.w)[0];
 if(westTo){const zl=Math.max(westTo.z,Math.min(westTo.z+westTo.d,promenadeZ))+(westTo.d<.6?0:0),z1=Math.min(Math.max(zl,westTo.z+westTo.d/2),westTo.z+westTo.d);walks.push([[westTo.x+westTo.w-.05,z1],[walkX,z1],[walkX,promenadeZ]]);}
 const bottom=Math.max(...land.map(r=>r.z+r.d));
 const southTo=raised.filter(p=>p.z>lot.z+lot.d-.01&&p.z<bottom+AGENCY_REACH&&p.x+p.w>x+.3&&p.x<x+w-.3&&p.w>.6).sort((a,b)=>a.z-b.z)[0];
 if(southTo){const xl=Math.max(x+.3,Math.min(x+w-.3,southTo.x+southTo.w/2));walks.push([[xl,promenadeZ],[xl,southTo.z+.05]]);}
 walks.push([entry,[entryX,promenadeZ]],[[walkX,promenadeZ],[x+w+.4,promenadeZ]]);
 const ground=[...land,...s.terraces];
 for(const p of walks)for(let i=1;i<p.length;i++){
  const a=p[i-1],b=p[i];if(Math.hypot(a[0]-b[0],a[1]-b[1])<.01)continue;
  const strip=pathStrip(a,b,.5,top);paving.push(strip);
  // Where the path leaves the new land it crosses the old shoreline at terrace height, as a short causeway.
  plinth.push(...uncoveredLand({x:strip.x-.1,z:strip.z,w:strip.w+.2,d:strip.d},[...land,...s.terraces]).filter(r=>r.w>.05&&r.d>.05));
 }
 void ground;
 // Trees along the lot's edges, clear of the building, paths and pools.
 const trees:Pt[]=[];
 for(let tx=lot.x+.7;tx<lot.x+lot.w-.5;tx+=1.35)for(const tz of [lot.z+.45,lot.z+lot.d-.45]){
  const p:Pt=[tx,tz];
  if(tz<z&&tx>x-.9&&tx<x+w+.9&&tz>z-1)continue;
  if(walks.some(path=>distanceToRoad(p,path)<.65)||paving.some(q=>tx>q.x-.4&&tx<q.x+q.w+.4&&tz>q.z-.4&&tz<q.z+q.d+.4))continue;
  if(s.obstacles.some(b=>Math.abs(tx-b.x)<b.w/2+.6&&Math.abs(tz-b.z)<b.d/2+.6))continue;
  trees.push(p);
 }
 for(const tz of [z+.6,z+d/2,z+d-.4])for(const tx of [lot.x+.6,lot.x+lot.w-.6]){const p:Pt=[tx,tz];if(tx>x-1&&tx<x+w+1)continue;if(walks.some(path=>distanceToRoad(p,path)<.65))continue;trees.push(p);}
 return {land,plinth,x,z,w,d,cx,cz:z+d/2,pools,paving,walks,trees,entry};
}

/** Roof height of the building at a local x (0 at the west end). */
export function agencyRoof(localX:number,eastStart:number):number{
 if(localX<eastStart)return AGENCY.westH;
 const t=(localX-eastStart)/(AGENCY.length-eastStart);
 return AGENCY.eastLow+(AGENCY.eastHigh-AGENCY.eastLow)*Math.max(0,Math.min(1,t));
}

/** Local x of the slot's centre line at a local z (0 north, depth south). */
export const cutAt=(localZ:number)=>AGENCY.length*(AGENCY.cutNorth+(AGENCY.cutSouth-AGENCY.cutNorth)*localZ/AGENCY.depth);

/**
 * Top of the copper sweep on the south face at local x: a quarter ellipse rising from its foot to
 * a high apex near the river corner, then dropping quickly onto a slim corner pier.
 */
export function sweepTop(localX:number):number{
 const {from,apex,pier,h}=AGENCY.sweep,L=AGENCY.length,eastStart=cutAt(AGENCY.depth)+AGENCY.cutW/2;
 const u0=eastStart+(L-eastStart)*from,ua=eastStart+(L-eastStart)*apex,u1=L-pier;
 if(localX<=u0||localX>=u1)return 0;
 const t=localX<ua?(ua-localX)/(ua-u0):(localX-ua)/(u1-ua);
 return h*Math.sqrt(Math.max(0,1-t*t));
}
export function sweepSpan(){const {from,pier}=AGENCY.sweep,L=AGENCY.length,eastStart=cutAt(AGENCY.depth)+AGENCY.cutW/2;return [eastStart+(L-eastStart)*from,L-pier] as const;}

/** Top of the pointed arch on the east face at local z. */
export function archTop(localZ:number):number{
 const {centre,half,h}=AGENCY.arch,t=(localZ-AGENCY.depth*centre)/half;
 if(Math.abs(t)>=1)return 0;
 return h*Math.sqrt(1-t*t)*(1-.32*Math.abs(t));
}
export function archSpan(){const {centre,half}=AGENCY.arch;return [AGENCY.depth*centre-half,AGENCY.depth*centre+half] as const;}
