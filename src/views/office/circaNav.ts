import {CIRCA_PLATE,circaFloorNumber,circaLevelKind,mirrorX,onCircaPlate,CIRCA_UPPER_LEVELS,type CircaLevel} from "./circaFloors";
import {circaApartmentParts,circaLobbyParts,circaPoolDeckParts,type Part,type Parts} from "./circaInteriorParts";

/**
 * Walking routes inside Circa. Each floor kind gets a walk grid (10 cm cells) built from the same part lists that draw
 * the floor, plus the lift landing and the lobby furniture (which CircaLobby draws as JSX). Agents walk A* paths on
 * that grid between named stops: every room of every apartment, the lobby's front desk, lounges and elevators, and the
 * pool deck's amenities. Pure and memoized, so tests prove every stop is reachable from the lift.
 */
export const WALK={cell:.1,radius:.14,speed:1.1,dwell:2.6,ride:5};

type Rect={x:number;z:number;w:number;d:number;r?:number};
type Circle={x:number;z:number;rad:number};

/** The shared lift landing (BuildingCirculation): side walls and back. Its sliding doors are left open to walk through. */
const LIFT_WALLS:Rect[]=[{x:8.5,z:1.15,w:2.3,d:.1},{x:8.5,z:-1.15,w:2.3,d:.1},{x:9.6,z:0,w:.13,d:2.4}];
/** Lobby furniture drawn in CircaLobby.tsx; keep in step with it. */
const LOBBY_RECTS:Rect[]=[
  {x:3.6,z:-2.5,w:3,d:1},                                      // reception desk
  {x:-5.75,z:3,w:1.05,d:.9},{x:-3.45,z:3,w:1.05,d:.9},{x:-4.6,z:3,w:.9,d:.6}, // west lounge chairs and glass table
  {x:4.4,z:4.25,w:2.4,d:1.2},{x:4.4,z:3.2,w:1.2,d:.6},          // east lounge sofa and table
  {x:3.75,z:2.12,w:.7,d:.8},{x:5.05,z:2.12,w:.7,d:.8},          // cognac chairs
  {x:-1.22,z:CIRCA_PLATE.rz-.1,w:.12,d:.15},{x:1.22,z:CIRCA_PLATE.rz-.1,w:.12,d:.15}, // street door posts
];
const LOBBY_CIRCLES:Circle[]=[
  {x:-3.6,z:-3.9,rad:.4},{x:3.6,z:-3.9,rad:.4},{x:-3,z:-2.3,rad:.75},{x:3.6,z:-3.2,rad:.2},
  {x:6.6,z:4.3,rad:.25},{x:-5.2,z:5.2,rad:.35},{x:5.2,z:5.2,rad:.35},
];
/** The two people who stay put on the pool deck (CircaUpperFloors). */
const POOL_CIRCLES:Circle[]=[{x:-3.2,z:4.2,rad:.2},{x:3.3,z:-1.6,rad:.2}];

export type Grid={w:number;h:number;free:Uint8Array};
const W=Math.ceil(CIRCA_PLATE.rx*2/WALK.cell),H=Math.ceil(CIRCA_PLATE.rz*2/WALK.cell);
const toCell=(x:number,z:number):[number,number]=>[Math.floor((x+CIRCA_PLATE.rx)/WALK.cell),Math.floor((z+CIRCA_PLATE.rz)/WALK.cell)];
const cellCentre=(i:number,j:number):[number,number]=>[(i+.5)*WALK.cell-CIRCA_PLATE.rx,(j+.5)*WALK.cell-CIRCA_PLATE.rz];

/** Parts that stand in the way: taller than a rug or floor light, and not hung overhead. */
const blocking=(p:Part)=>p.p[1]+p.s[1]/2>.15&&p.p[1]-p.s[1]/2<1.9;

export function buildGrid(parts:Parts,rects:Rect[],circles:Circle[]):Grid{
  const free=new Uint8Array(W*H),R=WALK.radius;
  for(let j=0;j<H;j++)for(let i=0;i<W;i++){const [x,z]=cellCentre(i,j);free[j*W+i]=onCircaPlate(x,z,R+.08)?1:0;}
  const fill=(x0:number,x1:number,z0:number,z1:number,hit:(x:number,z:number)=>boolean)=>{
    const [i0,j0]=toCell(x0,z0),[i1,j1]=toCell(x1,z1);
    for(let j=Math.max(0,j0);j<=Math.min(H-1,j1);j++)for(let i=Math.max(0,i0);i<=Math.min(W-1,i1);i++){const [x,z]=cellCentre(i,j);if(hit(x,z))free[j*W+i]=0;}
  };
  const rect=(o:Rect)=>{
    const c=Math.cos(o.r??0),s=Math.sin(o.r??0),hx=o.w/2+R,hz=o.d/2+R,ext=Math.abs(hx*c)+Math.abs(hz*s),ezt=Math.abs(hx*s)+Math.abs(hz*c);
    // Part rotation turns local x toward -z (Three's y rotation): local = (dx·c - dz·s, dx·s + dz·c).
    fill(o.x-ext,o.x+ext,o.z-ezt,o.z+ezt,(x,z)=>{const dx=x-o.x,dz=z-o.z;return Math.abs(dx*c-dz*s)<=hx&&Math.abs(dx*s+dz*c)<=hz;});
  };
  const ellipse=(x:number,z:number,a:number,b:number)=>fill(x-a-R,x+a+R,z-b-R,z+b+R,(px,pz)=>((px-x)/(a+R))**2+((pz-z)/(b+R))**2<=1);
  for(const p of [...parts.box,...parts.glass,...parts.waterBox,...parts.glow])if(blocking(p))rect({x:p.p[0],z:p.p[2],w:p.s[0],d:p.s[2],...(p.r?{r:p.r}:{})});
  for(const p of [...parts.round,...parts.waterRound])if(blocking(p)&&p.s[0]<CIRCA_PLATE.rx*2-.01)ellipse(p.p[0],p.p[2],p.s[0]/2,p.s[2]/2);
  for(const o of [...LIFT_WALLS,...rects])rect(o);
  for(const c of circles)ellipse(c.x,c.z,c.rad,c.rad);
  return {w:W,h:H,free};
}

export type Stop={id:string;label:string;x:number;z:number};
const stop=(id:string,label:string,x:number,z:number):Stop=>({id,label,x,z});
/** In front of the lift doors, and inside the car where a rider leaves the floor. */
export const LIFT_STOP=stop("lift","Lift",6.9,0),LIFT_CAR=stop("car","Lift car",8.5,0);

/** Rooms of each apartment, in the order a resident walks them. Unit 03 mirrors 02 about the party wall. */
const ONE_BED=[stop("door","Front door",-1.72,1),stop("kitchen","Kitchen",-3.9,1.9),stop("bath","Bathroom",-6.8,2.05),stop("bedroom","Bedroom",-5.7,4),stop("living","Living room",-2.2,4),stop("dining","Dining",-1.9,3)];
const TWO_BED=[stop("door","Front door",.65,-1),stop("kitchen","Kitchen",-1.6,-1.89),stop("dining","Dining",-3.4,-3.4),stop("master","Main bedroom",-4.25,-3.5),stop("master-bath","Main bathroom",-6.9,-1.89),stop("living","Living room",.7,-3.7),stop("bedroom","Second bedroom",4,-4.4),stop("bath","Second bathroom",6,-1.88)];
export function unitStops(suffix:string):Stop[]{
  if(suffix==="01")return TWO_BED;
  if(suffix==="02")return ONE_BED;
  return ONE_BED.map(s=>({...s,x:mirrorX(s.x)}));
}
export const LOBBY_STOPS=[stop("desk","Front desk",3.6,-1.55),stop("elevators","Elevator hall",0,-6.3),stop("lounge-west","West lounge",-4.6,1.95),stop("entrance","Main entrance",0,6.6),stop("lounge-east","East lounge",4.4,1.25)];
export const POOL_STOPS=[stop("poolside","Pool",1,.7),stop("cabana","Cabanas",4.85,3.25),stop("fire-pit","Fire pit",-4.6,1.25),stop("lap-pool","Lap pool",-2.2,-2.95),stop("spa","Spa",4.3,-1.9)];

const grids=new Map<CircaLevel,Grid>();
export function circaGrid(kind:CircaLevel):Grid{
  let g=grids.get(kind);
  if(!g){g=kind==="lobby"?buildGrid(circaLobbyParts(),LOBBY_RECTS,LOBBY_CIRCLES):kind==="pool"?buildGrid(circaPoolDeckParts(),[],POOL_CIRCLES):buildGrid(circaApartmentParts(2),[],[]);grids.set(kind,g);}
  return g;
}

/** Nearest free cell within `reach` metres of (x, z), or null. */
export function snap(g:Grid,x:number,z:number,reach=.5):[number,number]|null{
  const [ci,cj]=toCell(x,z),n=Math.ceil(reach/WALK.cell);let best:[number,number]|null=null,bd=Infinity;
  for(let dj=-n;dj<=n;dj++)for(let di=-n;di<=n;di++){const i=ci+di,j=cj+dj;if(i<0||j<0||i>=g.w||j>=g.h||!g.free[j*g.w+i])continue;const d=di*di+dj*dj;if(d<bd&&d<=n*n){bd=d;best=[i,j];}}
  return best;
}

/** Shortest 8-connected path on the grid (no corner cutting), as cell indices; null when unreachable. */
function astar(g:Grid,a:[number,number],b:[number,number]):number[]|null{
  const N=g.w*g.h,start=a[1]*g.w+a[0],goal=b[1]*g.w+b[0],cost=new Float64Array(N).fill(Infinity),from=new Int32Array(N).fill(-1),closed=new Uint8Array(N);
  const h=(k:number)=>{const dx=Math.abs(k%g.w-b[0]),dz=Math.abs(Math.floor(k/g.w)-b[1]);return Math.max(dx,dz)+.4142*Math.min(dx,dz);};
  // Binary heap of [f, cell].
  const heap:number[][]=[];const push=(f:number,k:number)=>{heap.push([f,k]);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p][0]<=heap[i][0])break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}};
  const pop=()=>{const top=heap[0],last=heap.pop()!;if(heap.length){heap[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===i)break;[heap[m],heap[i]]=[heap[i],heap[m]];i=m;}}return top;};
  cost[start]=0;push(h(start),start);
  while(heap.length){
    const k=pop()[1];if(k===goal)break;if(closed[k])continue;closed[k]=1;
    const i=k%g.w,j=Math.floor(k/g.w);
    for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){
      if(!di&&!dj)continue;const ni=i+di,nj=j+dj;if(ni<0||nj<0||ni>=g.w||nj>=g.h)continue;const n=nj*g.w+ni;if(!g.free[n])continue;
      if(di&&dj&&(!g.free[j*g.w+ni]||!g.free[nj*g.w+i]))continue;
      const c=cost[k]+(di&&dj?1.4142:1);if(c<cost[n]){cost[n]=c;from[n]=k;push(c+h(n),n);}
    }
  }
  if(from[goal]<0&&goal!==start)return null;
  const out=[goal];while(out[out.length-1]!==start)out.push(from[out[out.length-1]]);return out.reverse();
}

/** Every grid cell the straight walk from p to q crosses is free. */
export function clearLine(g:Grid,p:[number,number],q:[number,number]){
  const len=Math.hypot(q[0]-p[0],q[1]-p[1]),n=Math.max(1,Math.ceil(len/(WALK.cell/3)));
  for(let s=0;s<=n;s++){const [i,j]=toCell(p[0]+(q[0]-p[0])*s/n,p[1]+(q[1]-p[1])*s/n);if(i<0||j<0||i>=g.w||j>=g.h||!g.free[j*g.w+i])return false;}
  return true;
}

export type Path=[number,number][];
const paths=new Map<string,Path|null>();
/** A smoothed walk from one point to another on a floor kind, as corner points; null when no way through. */
export function circaPath(kind:CircaLevel,from:{x:number;z:number},to:{x:number;z:number}):Path|null{
  const key=`${kind}:${from.x},${from.z}>${to.x},${to.z}`;if(paths.has(key))return paths.get(key)!;
  const g=circaGrid(kind),a=snap(g,from.x,from.z),b=snap(g,to.x,to.z);
  let out:Path|null=null;
  const cells=a&&b?astar(g,a,b):null;
  if(cells){
    const pts=cells.map(k=>cellCentre(k%g.w,Math.floor(k/g.w)));
    // Pull the string: keep only the corners the walker can't see past.
    out=[pts[0]];let i=0;
    while(i<pts.length-1){let j=pts.length-1;while(j>i+1&&!clearLine(g,pts[i],pts[j]))j--;out.push(pts[j]);i=j;}
  }
  paths.set(key,out);return out;
}
export const pathLength=(p:Path)=>p.slice(1).reduce((n,q,i)=>n+Math.hypot(q[0]-p[i][0],q[1]-p[i][1]),0);

/** One stretch of an agent's day: walking a path on a level, pausing at a stop, or riding the lift (hidden). */
export type Leg={level:number;t0:number;t1:number;path?:Path;at?:Stop;ride?:true};
export type Itinerary={legs:Leg[];period:number;home:{level:number;unit:string}};

/** The twelve apartments, Floors 3 to 6, as level and unit number. */
export function circaApartments(){const out:{level:number;unit:string;suffix:string}[]=[];for(let level=2;level<=CIRCA_UPPER_LEVELS;level++)for(const s of ["01","02","03"])out.push({level,unit:`${circaFloorNumber(level)}${s}`,suffix:s});return out;}

/**
 * An agent's looping day inside Circa: walk every room of its apartment, take the lift down to the lobby and stop at
 * the desk, lounges, elevators and front door, ride up to the pool deck and do its amenities, then ride home.
 */
export function circaItinerary(homeIndex:number):Itinerary{
  const apts=circaApartments(),home=apts[((homeIndex%apts.length)+apts.length)%apts.length];
  const legs:Leg[]=[];let t=0;
  const tour=(level:number,stops:Stop[])=>{
    const kind=circaLevelKind(level);let prev:Stop=LIFT_CAR;
    for(const s of [LIFT_STOP,...stops,LIFT_STOP,LIFT_CAR]){
      const path=circaPath(kind,prev,s);
      if(path&&path.length>1){const d=pathLength(path)/WALK.speed;legs.push({level,t0:t,t1:t+d,path});t+=d;}
      if(s!==LIFT_STOP&&s!==LIFT_CAR){legs.push({level,t0:t,t1:t+WALK.dwell,at:s});t+=WALK.dwell;}
      prev=s;
    }
    legs.push({level,t0:t,t1:t+WALK.ride,ride:true});t+=WALK.ride;
  };
  tour(home.level,unitStops(home.suffix));
  tour(0,LOBBY_STOPS);
  tour(1,POOL_STOPS);
  return {legs,period:t,home:{level:home.level,unit:home.unit}};
}

/** Where an agent is at time `t` (seconds, looping): its level and position, or riding the lift. */
export function walkerAt(it:Itinerary,t:number):{level:number;x:number;z:number;heading:number;riding:boolean;stop?:Stop}{
  const tt=((t%it.period)+it.period)%it.period;
  let lo=0,hi=it.legs.length-1;while(lo<hi){const m=(lo+hi)>>1;if(it.legs[m].t1<=tt)lo=m+1;else hi=m;}
  const leg=it.legs[lo];
  if(leg.ride)return {level:leg.level,x:LIFT_CAR.x,z:LIFT_CAR.z,heading:0,riding:true};
  if(leg.at){
    // Face the way it last walked: look back to the previous walking leg.
    const prev=it.legs[lo-1]?.path;const h=prev&&prev.length>1?heading(prev[prev.length-2],prev[prev.length-1]):0;
    return {level:leg.level,x:leg.at.x,z:leg.at.z,heading:h,riding:false,stop:leg.at};
  }
  const p=leg.path!;let d=(tt-leg.t0)*WALK.speed;
  for(let i=1;i<p.length;i++){const seg=Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]);
    if(d<=seg||i===p.length-1){const f=seg?Math.min(1,d/seg):1;return {level:leg.level,x:p[i-1][0]+(p[i][0]-p[i-1][0])*f,z:p[i-1][1]+(p[i][1]-p[i-1][1])*f,heading:heading(p[i-1],p[i]),riding:false};}
    d-=seg;}
  const end=p[p.length-1];return {level:leg.level,x:end[0],z:end[1],heading:0,riding:false};
}
const heading=(a:[number,number],b:[number,number])=>Math.atan2(b[0]-a[0],b[1]-a[1]);
