import {CIRCA_DOOR_Z,CIRCA_PLATE,CIRCA_PODIUM,circaLevelKind,circaUnits,mirrorX,onCircaPlate,onCircaPodium,towerToPodium,CIRCA_UPPER_LEVELS,type CircaLevel,type CircaTower} from "./circaFloors";
import {circaApartmentParts,circaLobbyParts,circaPoolDeckParts,type Part,type Parts} from "./circaInteriorParts";
import {LIFT_STOP_SECONDS,elevatorAt} from "./circulation";

/**
 * Walking routes inside Circa. Each floor kind gets a walk grid (10 cm cells) built from the same part lists that draw
 * the floor, plus the lift landings and the lobby furniture (which CircaLobby draws as JSX). The lobby and pool deck
 * grids cover the rectangular podium, in podium coordinates, with both towers' lifts at the middle. The apartment grid
 * covers one oval tower in tower-local coordinates; the east tower is the same plan drawn mirrored, so one grid serves
 * both. Agents walk A* paths between named stops: every room of every apartment, the lobby's desk, lounges, lockers
 * and work table, and the pool deck's amenities. Pure and memoized, so tests prove every stop is reachable from a lift.
 */
export const WALK={cell:.1,radius:.14,speed:1.1,dwell:2.6,ride:5};

type Rect={x:number;z:number;w:number;d:number;r?:number};
type Circle={x:number;z:number;rad:number};

/** A tower's lift landing (BuildingCirculation), tower-local: side walls and back. Its sliding doors are left open. */
const LIFT_WALLS:Rect[]=[{x:8.5,z:1.15,w:2.3,d:.1},{x:8.5,z:-1.15,w:2.3,d:.1},{x:9.6,z:0,w:.13,d:2.4}];
/** Both towers' lift landings, placed on the podium. */
const PODIUM_LIFT_WALLS:Rect[]=(["west","east"] as const).flatMap(t=>LIFT_WALLS.map(r=>{const [x,z]=towerToPodium(t,r.x,r.z);return {...r,x,z};}));
/** Lobby furniture drawn in CircaLobby.tsx; keep in step with it. */
const LOBBY_RECTS:Rect[]=[
  {x:3.6,z:-2.5,w:3,d:1},                                      // reception desk
  {x:-5.75,z:3,w:1.05,d:.9},{x:-3.45,z:3,w:1.05,d:.9},{x:-4.6,z:3,w:.9,d:.6}, // west lounge chairs and glass table
  {x:4.4,z:4.25,w:2.4,d:1.2},{x:4.4,z:3.2,w:1.2,d:.6},          // east lounge sofa and table
  {x:3.75,z:2.12,w:.7,d:.8},{x:5.05,z:2.12,w:.7,d:.8},          // cognac chairs
  {x:-1.22,z:CIRCA_DOOR_Z,w:.12,d:.15},{x:1.22,z:CIRCA_DOOR_Z,w:.12,d:.15}, // street door posts
];
const LOBBY_CIRCLES:Circle[]=[
  {x:-3.6,z:-3.9,rad:.4},{x:3.6,z:-3.9,rad:.4},{x:-3,z:-2.3,rad:.75},{x:3.6,z:-3.2,rad:.2},
  {x:6.6,z:4.3,rad:.25},{x:-5.2,z:5.2,rad:.35},{x:5.2,z:5.2,rad:.35},
];
/** The two people who stay put on the pool deck (CircaUpperFloors). */
export const POOL_PEOPLE:[number,number][]=[[-8.5,3],[8.5,-3]];
const POOL_CIRCLES:Circle[]=POOL_PEOPLE.map(([x,z])=>({x,z,rad:.2}));

/** A walk grid: `hx`/`hz` half extents, centred on the origin. */
export type Grid={w:number;h:number;hx:number;hz:number;free:Uint8Array};
const toCell=(g:{hx:number;hz:number},x:number,z:number):[number,number]=>[Math.floor((x+g.hx)/WALK.cell),Math.floor((z+g.hz)/WALK.cell)];
const cellCentre=(g:{hx:number;hz:number},i:number,j:number):[number,number]=>[(i+.5)*WALK.cell-g.hx,(j+.5)*WALK.cell-g.hz];

/** Parts that stand in the way: taller than a rug or floor light, and not hung overhead. */
const blocking=(p:Part)=>p.p[1]+p.s[1]/2>.15&&p.p[1]-p.s[1]/2<1.9;

export function buildGrid(parts:Parts,rects:Rect[],circles:Circle[],podium:boolean):Grid{
  const hx=podium?CIRCA_PODIUM.w/2:CIRCA_PLATE.rx,hz=podium?CIRCA_PODIUM.d/2:CIRCA_PLATE.rz,W=Math.ceil(hx*2/WALK.cell),H=Math.ceil(hz*2/WALK.cell),g={hx,hz};
  const free=new Uint8Array(W*H),R=WALK.radius,on=podium?onCircaPodium:onCircaPlate;
  for(let j=0;j<H;j++)for(let i=0;i<W;i++){const [x,z]=cellCentre(g,i,j);free[j*W+i]=on(x,z,R+.08)?1:0;}
  const fill=(x0:number,x1:number,z0:number,z1:number,hit:(x:number,z:number)=>boolean)=>{
    const [i0,j0]=toCell(g,x0,z0),[i1,j1]=toCell(g,x1,z1);
    for(let j=Math.max(0,j0);j<=Math.min(H-1,j1);j++)for(let i=Math.max(0,i0);i<=Math.min(W-1,i1);i++){const [x,z]=cellCentre(g,i,j);if(hit(x,z))free[j*W+i]=0;}
  };
  const rect=(o:Rect)=>{
    const c=Math.cos(o.r??0),s=Math.sin(o.r??0),hx=o.w/2+R,hz=o.d/2+R,ext=Math.abs(hx*c)+Math.abs(hz*s),ezt=Math.abs(hx*s)+Math.abs(hz*c);
    // Part rotation turns local x toward -z (Three's y rotation): local = (dx·c - dz·s, dx·s + dz·c).
    fill(o.x-ext,o.x+ext,o.z-ezt,o.z+ezt,(x,z)=>{const dx=x-o.x,dz=z-o.z;return Math.abs(dx*c-dz*s)<=hx&&Math.abs(dx*s+dz*c)<=hz;});
  };
  const ellipse=(x:number,z:number,a:number,b:number)=>fill(x-a-R,x+a+R,z-b-R,z+b+R,(px,pz)=>((px-x)/(a+R))**2+((pz-z)/(b+R))**2<=1);
  for(const p of [...parts.box,...parts.glass,...parts.waterBox,...parts.glow])if(blocking(p))rect({x:p.p[0],z:p.p[2],w:p.s[0],d:p.s[2],...(p.r?{r:p.r}:{})});
  for(const p of [...parts.round,...parts.waterRound])if(blocking(p)&&p.s[0]<CIRCA_PLATE.rx*2-.01)ellipse(p.p[0],p.p[2],p.s[0]/2,p.s[2]/2);
  for(const o of [...(podium?PODIUM_LIFT_WALLS:LIFT_WALLS),...rects])rect(o);
  for(const c of circles)ellipse(c.x,c.z,c.rad,c.rad);
  return {w:W,h:H,hx,hz,free};
}

export type Stop={id:string;label:string;x:number;z:number};
const stop=(id:string,label:string,x:number,z:number):Stop=>({id,label,x,z});
/** In front of a tower's lift doors, and inside the car where a rider leaves the floor (tower-local). */
export const LIFT_STOP=stop("lift","Lift",6.9,0),LIFT_CAR=stop("car","Lift car",8.5,0);
/** The same two points for a tower's lift, on the podium. */
export const podiumLift=(tower:CircaTower)=>{const [sx,sz]=towerToPodium(tower,LIFT_STOP.x,LIFT_STOP.z),[cx,cz]=towerToPodium(tower,LIFT_CAR.x,LIFT_CAR.z);return {stop:stop("lift",`${tower} lift`,sx,sz),car:stop("car",`${tower} lift car`,cx,cz)};};

/** Rooms of each apartment, in the order a resident walks them. Unit 03 mirrors 02 about the party wall. */
const ONE_BED=[stop("door","Front door",-1.72,1),stop("kitchen","Kitchen",-3.9,1.9),stop("bath","Bathroom",-6.8,2.05),stop("bedroom","Bedroom",-5.7,4),stop("living","Living room",-2.2,4),stop("dining","Dining",-1.9,3)];
const TWO_BED=[stop("door","Front door",.65,-1),stop("kitchen","Kitchen",-1.6,-1.89),stop("dining","Dining",-3.4,-3.4),stop("master","Main bedroom",-4.25,-3.5),stop("master-bath","Main bathroom",-6.9,-1.89),stop("living","Living room",.7,-3.7),stop("bedroom","Second bedroom",4,-4.4),stop("bath","Second bathroom",6,-1.88)];
export function unitStops(suffix:string):Stop[]{
  if(suffix==="01")return TWO_BED;
  if(suffix==="02")return ONE_BED;
  return ONE_BED.map(s=>({...s,x:mirrorX(s.x)}));
}
export const LOBBY_STOPS=[stop("desk","Front desk",3.6,-1.55),stop("lockers","Parcel lockers",-13,-6.7),stop("residents-lounge","Residents' lounge",-15.6,4.6),stop("lounge-west","West lounge",-4.6,1.95),stop("entrance","Main entrance",0,7.6),stop("lounge-east","East lounge",4.4,1.25),stop("reading","Reading corner",13,3),stop("work-table","Work table",13,-3.2)];
export const POOL_STOPS=[stop("poolside","Pool",0,2.1),stop("cabana","Cabanas",13,3.9),stop("spa","Spa",13,-2.9),stop("lap-pool","Lap pool",0,-4.3),stop("sun-lawn","Sun lawn",-13,-3),stop("fire-pit","Fire pit",-13,2.7)];

const grids=new Map<CircaLevel,Grid>();
export function circaGrid(kind:CircaLevel):Grid{
  let g=grids.get(kind);
  if(!g){g=kind==="lobby"?buildGrid(circaLobbyParts(),LOBBY_RECTS,LOBBY_CIRCLES,true):kind==="pool"?buildGrid(circaPoolDeckParts(),[],POOL_CIRCLES,true):buildGrid(circaApartmentParts(2),[],[],false);grids.set(kind,g);}
  return g;
}

/** Nearest free cell within `reach` metres of (x, z), or null. */
export function snap(g:Grid,x:number,z:number,reach=.5):[number,number]|null{
  const [ci,cj]=toCell(g,x,z),n=Math.ceil(reach/WALK.cell);let best:[number,number]|null=null,bd=Infinity;
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
  for(let s=0;s<=n;s++){const [i,j]=toCell(g,p[0]+(q[0]-p[0])*s/n,p[1]+(q[1]-p[1])*s/n);if(i<0||j<0||i>=g.w||j>=g.h||!g.free[j*g.w+i])return false;}
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
    const pts=cells.map(k=>cellCentre(g,k%g.w,Math.floor(k/g.w)));
    // Pull the string: keep only the corners the walker can't see past.
    out=[pts[0]];let i=0;
    while(i<pts.length-1){let j=pts.length-1;while(j>i+1&&!clearLine(g,pts[i],pts[j]))j--;out.push(pts[j]);i=j;}
  }
  paths.set(key,out);return out;
}
export const pathLength=(p:Path)=>p.slice(1).reduce((n,q,i)=>n+Math.hypot(q[0]-p[i][0],q[1]-p[i][1]),0);

/** Circa's two lifts run the shared timeline (elevatorAt) to the top floor; the east car runs half a cycle behind. */
export const CIRCA_LIFT_TOP=CIRCA_UPPER_LEVELS;
export const CIRCA_LIFT_OFFSET:Record<CircaTower,number>={west:0,east:CIRCA_UPPER_LEVELS*LIFT_STOP_SECONDS};
const liftLanding=(tower:CircaTower,t:number)=>elevatorAt(t,CIRCA_LIFT_TOP,CIRCA_LIFT_OFFSET[tower]).landing;
/** Start of the lift stop that contains time t, in the same clock as t. */
const stopStart=(tower:CircaTower,t:number)=>{const o=CIRCA_LIFT_OFFSET[tower];return Math.floor((t+o)/LIFT_STOP_SECONDS)*LIFT_STOP_SECONDS-o;};
/** Seconds a rider needs to step into or out of the car while the doors are open. */
const STEP=1.6;
/** Earliest time from t when the tower's car stands open at `level` with time left to step in. */
export function boardingTime(tower:CircaTower,level:number,t:number){
  for(let s=stopStart(tower,t),k=0;k<4*CIRCA_LIFT_TOP;k++,s+=LIFT_STOP_SECONDS)
    if(liftLanding(tower,s+.01)===level&&t<=s+5-STEP-.2)return Math.max(t,s);
  throw new Error(`lift never reaches ${level}`);
}
/** When the car, having left after boarding at `boarded`, next opens at `level`. */
export function arrivalTime(tower:CircaTower,level:number,boarded:number){
  for(let s=stopStart(tower,boarded)+LIFT_STOP_SECONDS,k=0;k<4*CIRCA_LIFT_TOP;k++,s+=LIFT_STOP_SECONDS)if(liftLanding(tower,s+.01)===level)return s;
  throw new Error(`lift never reaches ${level}`);
}

/**
 * One stretch of an agent's day: walking a path on a level, standing at a stop (a room, or waiting for the lift), or
 * hidden (riding the lift, or out of the building). `tower` is set on apartment floors, where positions are
 * tower-local; on the podium floors it is unset.
 */
export type Leg={level:number;tower?:CircaTower;t0:number;t1:number;path?:Path;at?:Stop;hidden?:"ride"|"away"};
/** A looping day in absolute seconds: legs run from `start` to `start + period`, and `period` is whole lift cycles. */
export type Itinerary={legs:Leg[];start:number;period:number;home:{level:number;tower:CircaTower;unit:string;layout:"01"|"02"|"03"}};

/** The twenty-four apartments, Floors 3 to 6, west tower then east tower on each floor. */
export function circaApartments(){
  const out:{level:number;tower:CircaTower;unit:string;layout:"01"|"02"|"03"}[]=[];
  for(let level=2;level<=CIRCA_UPPER_LEVELS;level++)for(const tower of ["west","east"] as const)for(const u of circaUnits(level,tower))out.push({level,tower,unit:u.id,layout:u.layout});
  return out;
}

const rotate=<T,>(list:T[],k:number)=>list.map((_,i)=>list[(i+k)%list.length]);
export const ENTRANCE_STOP=stop("entrance","Main entrance",0,CIRCA_DOOR_Z-.7);
/** How long an agent lingers: longer in the living room and bedroom, a short look elsewhere. */
const linger=(s:Stop)=>s.id==="living"||s.id==="bedroom"||s.id==="master"?7:s.id==="door"?.8:WALK.dwell+1;

/**
 * An agent's day inside Circa, timed to the real lifts:
 * 1. It comes in the front door, walks to its tower's lift and waits until the car opens at the lobby, steps in,
 *    rides (hidden) until the car opens at its floor, steps out and walks to its apartment.
 * 2. It moves between some of its rooms, then makes two outings by lift: one to the pool deck and one to the lobby
 *    (which comes first varies by agent), visiting a few amenities each time and coming home in between.
 * 3. It ends the day leaving through the front door, and is out of the building until its loop starts again.
 * Every room of its apartment is visited during the day. `start` spreads agents across the lift cycle.
 */
export function circaItinerary(homeIndex:number,start=0):Itinerary{
  const apts=circaApartments(),home=apts[((homeIndex%apts.length)+apts.length)%apts.length],seed=Math.abs(homeIndex);
  const legs:Leg[]=[];let t=start,level=0,at:Stop=ENTRANCE_STOP;
  const frame=(l:number)=>circaLevelKind(l)==="apartments"?{tower:home.tower as CircaTower}:{};
  const lift=(l:number)=>circaLevelKind(l)==="apartments"?{stop:LIFT_STOP,car:LIFT_CAR}:podiumLift(home.tower);
  const walk=(to:Stop)=>{
    const path=circaPath(circaLevelKind(level),at,to);
    if(path&&path.length>1){const d=pathLength(path)/WALK.speed;legs.push({level,...frame(level),t0:t,t1:t+d,path});t+=d;}
    at=to;
  };
  const stay=(seconds:number,s=at)=>{if(seconds>0){legs.push({level,...frame(level),t0:t,t1:t+seconds,at:s});t+=seconds;}};
  const ride=(to:number)=>{
    const L=lift(level);walk(L.stop);
    const board=boardingTime(home.tower,level,t);
    stay(board-t,{...L.stop,label:"Waiting for the lift"});
    walk(L.car);
    const open=arrivalTime(home.tower,to,board);
    legs.push({level:to,...frame(to),t0:t,t1:open+.3,hidden:"ride"});t=open+.3;
    level=to;at=lift(to).car;walk(lift(to).stop);
  };
  const visit=(stops:Stop[])=>{for(const s of stops){walk(s);stay(linger(s));}};
  const rooms=rotate(unitStops(home.layout).filter(s=>s.id!=="door"&&s.id!=="living"),seed),door=unitStops(home.layout)[0];
  const living=unitStops(home.layout).find(s=>s.id==="living")!,third=Math.ceil(rooms.length/3);
  const lobby=rotate(LOBBY_STOPS.filter(s=>s.id!=="entrance"),seed).slice(0,3),pool=rotate(POOL_STOPS,seed).slice(0,3);
  const goHome=()=>{ride(home.level);visit([door]);};
  // Arrive and settle in.
  stay(1.2);ride(home.level);visit([door,...rooms.slice(0,third),living]);
  // Two outings by lift, in an order that varies by agent, with time at home in between.
  const outings:[number,Stop[]][]=seed%2?[[1,pool],[0,lobby]]:[[0,lobby],[1,pool]];
  outings.forEach(([to,stops],i)=>{ride(to);visit(stops);goHome();visit([...rooms.slice((i+1)*third,(i+2)*third),living]);});
  // Leave through the front door; out of the building until the loop comes round, on a whole lift cycle.
  ride(0);walk(ENTRANCE_STOP);
  const cycle=CIRCA_LIFT_TOP*2*LIFT_STOP_SECONDS,period=Math.ceil((t-start+20)/cycle)*cycle;
  legs.push({level:0,t0:t,t1:start+period,hidden:"away",at:ENTRANCE_STOP});
  return {legs,start,period,home};
}

/** Where an agent is at time `t` (seconds, looping): its level and position, or hidden in the lift or out. */
export function walkerAt(it:Itinerary,t:number):{level:number;tower?:CircaTower;x:number;z:number;heading:number;hidden:boolean;stop?:Stop}{
  const tt=it.start+(((t-it.start)%it.period)+it.period)%it.period;
  let lo=0,hi=it.legs.length-1;while(lo<hi){const m=(lo+hi)>>1;if(it.legs[m].t1<=tt)lo=m+1;else hi=m;}
  const leg=it.legs[lo],where={level:leg.level,...(leg.tower?{tower:leg.tower}:{})};
  if(leg.hidden)return {...where,x:0,z:0,heading:0,hidden:true};
  if(leg.at){
    // Face the way it last walked.
    let prev:Path|undefined;for(let i=lo-1;i>=0&&!prev;i--)prev=it.legs[i].path;
    const h=prev&&prev.length>1?heading(prev[prev.length-2],prev[prev.length-1]):0;
    return {...where,x:leg.at.x,z:leg.at.z,heading:h,hidden:false,stop:leg.at};
  }
  const p=leg.path!;let d=(tt-leg.t0)*WALK.speed;
  for(let i=1;i<p.length;i++){const seg=Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]);
    if(d<=seg||i===p.length-1){const f=seg?Math.min(1,d/seg):1;return {...where,x:p[i-1][0]+(p[i][0]-p[i-1][0])*f,z:p[i-1][1]+(p[i][1]-p[i-1][1])*f,heading:heading(p[i-1],p[i]),hidden:false};}
    d-=seg;}
  const end=p[p.length-1];return {...where,x:end[0],z:end[1],heading:0,hidden:false};
}
const heading=(a:[number,number],b:[number,number])=>Math.atan2(b[0]-a[0],b[1]-a[1]);
