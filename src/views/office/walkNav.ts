import type {Part,Parts} from "./circaInteriorParts";
import {LIFT_STOP_SECONDS,elevatorAt} from "./circulation";

/**
 * Walking inside a building, shared by Circa and the Financial District interiors. A floor gets a walk grid (10 cm
 * cells) built from the same part lists that draw it, plus any extra footprints. Agents walk smoothed A* paths on that
 * grid between named stops, and ride lifts on the shared lift timeline (elevatorAt), boarding and leaving only while
 * the doors are open. Everything here is pure, so tests can prove every stop is reachable.
 */
export const WALK={cell:.1,radius:.14,speed:1.1,dwell:2.6};

export type Rect={x:number;z:number;w:number;d:number;r?:number};
export type Circle={x:number;z:number;rad:number};
export type Stop={id:string;label:string;x:number;z:number};
export const stop=(id:string,label:string,x:number,z:number):Stop=>({id,label,x,z});

/** A lift landing (BuildingCirculation), in its own frame: side walls and back. Its sliding doors are left open. */
export const LIFT_WALLS:Rect[]=[{x:8.5,z:1.15,w:2.3,d:.1},{x:8.5,z:-1.15,w:2.3,d:.1},{x:9.6,z:0,w:.13,d:2.4}];
/** In front of a lift's doors, and inside the car where a rider leaves the floor, in the landing's frame. */
export const LIFT_STOP=stop("lift","Lift",6.9,0),LIFT_CAR=stop("car","Lift car",8.5,0);

/** A walk grid: `hx`/`hz` half extents, centred on the origin. */
export type Grid={w:number;h:number;hx:number;hz:number;free:Uint8Array};
/** The walkable outline of a floor: half extents and an inside test (with a margin in from the edge). */
export type Plate={hx:number;hz:number;inside:(x:number,z:number,margin:number)=>boolean};
export const rectPlate=(w:number,d:number):Plate=>({hx:w/2,hz:d/2,inside:(x,z,m)=>Math.abs(x)<=w/2-m&&Math.abs(z)<=d/2-m});

const toCell=(g:{hx:number;hz:number},x:number,z:number):[number,number]=>[Math.floor((x+g.hx)/WALK.cell),Math.floor((z+g.hz)/WALK.cell)];
const cellCentre=(g:{hx:number;hz:number},i:number,j:number):[number,number]=>[(i+.5)*WALK.cell-g.hx,(j+.5)*WALK.cell-g.hz];

/** Parts that stand in the way: taller than a rug or floor light, and not hung overhead. */
const blocking=(p:Part)=>p.p[1]+p.s[1]/2>.15&&p.p[1]-p.s[1]/2<1.9;

export function buildGrid(parts:Parts,plate:Plate,rects:Rect[],circles:Circle[]):Grid{
  const {hx,hz}=plate,W=Math.ceil(hx*2/WALK.cell),H=Math.ceil(hz*2/WALK.cell),g={hx,hz};
  const free=new Uint8Array(W*H),R=WALK.radius;
  for(let j=0;j<H;j++)for(let i=0;i<W;i++){const [x,z]=cellCentre(g,i,j);free[j*W+i]=plate.inside(x,z,R+.08)?1:0;}
  const fill=(x0:number,x1:number,z0:number,z1:number,hit:(x:number,z:number)=>boolean)=>{
    const [i0,j0]=toCell(g,x0,z0),[i1,j1]=toCell(g,x1,z1);
    for(let j=Math.max(0,j0);j<=Math.min(H-1,j1);j++)for(let i=Math.max(0,i0);i<=Math.min(W-1,i1);i++){const [x,z]=cellCentre(g,i,j);if(hit(x,z))free[j*W+i]=0;}
  };
  const rect=(o:Rect)=>{
    const c=Math.cos(o.r??0),s=Math.sin(o.r??0),ex=o.w/2+R,ez=o.d/2+R,ext=Math.abs(ex*c)+Math.abs(ez*s),ezt=Math.abs(ex*s)+Math.abs(ez*c);
    // Part rotation turns local x toward -z (Three's y rotation): local = (dx·c - dz·s, dx·s + dz·c).
    fill(o.x-ext,o.x+ext,o.z-ezt,o.z+ezt,(x,z)=>{const dx=x-o.x,dz=z-o.z;return Math.abs(dx*c-dz*s)<=ex&&Math.abs(dx*s+dz*c)<=ez;});
  };
  const ellipse=(x:number,z:number,a:number,b:number)=>fill(x-a-R,x+a+R,z-b-R,z+b+R,(px,pz)=>((px-x)/(a+R))**2+((pz-z)/(b+R))**2<=1);
  for(const p of [...parts.box,...parts.glass,...parts.waterBox,...parts.glow])if(blocking(p))rect({x:p.p[0],z:p.p[2],w:p.s[0],d:p.s[2],...(p.r?{r:p.r}:{})});
  for(const p of [...parts.round,...parts.waterRound])if(blocking(p))ellipse(p.p[0],p.p[2],p.s[0]/2,p.s[2]/2);
  for(const o of rects)rect(o);
  for(const c of circles)ellipse(c.x,c.z,c.rad,c.rad);
  return {w:W,h:H,hx,hz,free};
}
/** A lift landing's walls moved into a floor's frame. */
export const placeLiftWalls=(place:(x:number,z:number)=>[number,number]):Rect[]=>LIFT_WALLS.map(r=>{const [x,z]=place(r.x,r.z);return {...r,x,z};});

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
/** A smoothed walk on a grid from one point to another, as corner points; null when there's no way through. */
export function findPath(g:Grid,from:{x:number;z:number},to:{x:number;z:number}):Path|null{
  const a=snap(g,from.x,from.z),b=snap(g,to.x,to.z),cells=a&&b?astar(g,a,b):null;
  if(!cells)return null;
  const pts=cells.map(k=>cellCentre(g,k%g.w,Math.floor(k/g.w)));
  // Pull the string: keep only the corners the walker can't see past.
  const out:Path=[pts[0]];let i=0;
  while(i<pts.length-1){let j=pts.length-1;while(j>i+1&&!clearLine(g,pts[i],pts[j]))j--;out.push(pts[j]);i=j;}
  return out;
}
export const pathLength=(p:Path)=>p.slice(1).reduce((n,q,i)=>n+Math.hypot(q[0]-p[i][0],q[1]-p[i][1]),0);

/** A lift on the shared timeline: the car runs from the lobby to `top` and back; `offset` shifts it. */
export type Lift={top:number;offset:number};
const landingAt=(l:Lift,t:number)=>elevatorAt(t,l.top,l.offset).landing;
const stopStart=(l:Lift,t:number)=>Math.floor((t+l.offset)/LIFT_STOP_SECONDS)*LIFT_STOP_SECONDS-l.offset;
export const liftCycle=(l:Lift)=>l.top*2*LIFT_STOP_SECONDS;
/** Seconds a rider needs to step into or out of the car while the doors are open. */
const STEP=1.6;
/** Earliest time from t when the car stands open at `level` with time left to step in. */
export function boardingTime(l:Lift,level:number,t:number){
  for(let s=stopStart(l,t),k=0;k<4*l.top+2;k++,s+=LIFT_STOP_SECONDS)if(landingAt(l,s+.01)===level&&t<=s+5-STEP-.2)return Math.max(t,s);
  throw new Error(`lift never reaches ${level}`);
}
/** When the car, having left after boarding at `boarded`, next opens at `level`. */
export function arrivalTime(l:Lift,level:number,boarded:number){
  for(let s=stopStart(l,boarded)+LIFT_STOP_SECONDS,k=0;k<4*l.top+2;k++,s+=LIFT_STOP_SECONDS)if(landingAt(l,s+.01)===level)return s;
  throw new Error(`lift never reaches ${level}`);
}

/**
 * One stretch of an agent's day: walking a path on a level, standing at a stop (a room, or waiting for the lift), or
 * hidden (riding the lift, or out of the building). `frame` names the local frame on levels drawn in more than one
 * place (Circa's towers); it is unset where a level has one frame.
 */
export type Leg={level:number;frame?:string;t0:number;t1:number;path?:Path;at?:Stop;hidden?:"ride"|"away"};
/** A looping day in absolute seconds: legs run from `start` to `start + period`, and `period` is whole lift cycles. */
export type Day={legs:Leg[];start:number;period:number};

/** How the day builder sees a building: paths per level, the rider's lift and its landing on each level, and frames. */
export type DayWorld={
  path:(level:number,from:Stop,to:Stop)=>Path|null;
  lift:Lift;
  landing:(level:number)=>{stop:Stop;car:Stop};
  frame?:(level:number)=>string|undefined;
};

/**
 * Builds a looping day step by step: walk to stops, linger, ride the lift between levels (waiting until the doors open,
 * stepping in, riding hidden, stepping out on arrival), and finally leave until the loop comes round.
 */
export class DayBuilder{
  legs:Leg[]=[];t:number;level:number;at:Stop;
  constructor(private world:DayWorld,readonly start:number,level:number,at:Stop){this.t=start;this.level=level;this.at=at;}
  private where(level=this.level){const f=this.world.frame?.(level);return {level,...(f?{frame:f}:{})};}
  walk(to:Stop){
    const path=this.world.path(this.level,this.at,to);
    if(path&&path.length>1){const d=pathLength(path)/WALK.speed;this.legs.push({...this.where(),t0:this.t,t1:this.t+d,path});this.t+=d;}
    this.at=to;return this;
  }
  stay(seconds:number,s:Stop=this.at){if(seconds>0){this.legs.push({...this.where(),t0:this.t,t1:this.t+seconds,at:s});this.t+=seconds;}return this;}
  visit(stops:Stop[],linger:(s:Stop)=>number=()=>WALK.dwell){for(const s of stops){this.walk(s);this.stay(linger(s));}return this;}
  ride(to:number){
    if(to===this.level)return this;
    const L=this.world.landing(this.level);this.walk(L.stop);
    const board=boardingTime(this.world.lift,this.level,this.t);
    this.stay(board-this.t,{...L.stop,label:"Waiting for the lift"});
    this.walk(L.car);
    const open=arrivalTime(this.world.lift,to,board);
    this.legs.push({...this.where(to),t0:this.t,t1:open+.3,hidden:"ride"});this.t=open+.3;
    this.level=to;this.at=this.world.landing(to).car;this.walk(this.world.landing(to).stop);
    return this;
  }
  /** Close the loop: out of the building at `at` until the next whole lift cycle, with at least `rest` seconds away. */
  leave(rest=20):Day{
    const cycle=liftCycle(this.world.lift),period=Math.ceil((this.t-this.start+rest)/cycle)*cycle;
    this.legs.push({level:this.level,t0:this.t,t1:this.start+period,hidden:"away",at:this.at});
    return {legs:this.legs,start:this.start,period};
  }
}

/** Where an agent is at time `t` (seconds, looping): its level and position, or hidden in the lift or out. */
export function walkerAt(day:Day,t:number):{level:number;frame?:string;x:number;z:number;heading:number;hidden:boolean;stop?:Stop}{
  const tt=day.start+(((t-day.start)%day.period)+day.period)%day.period;
  let lo=0,hi=day.legs.length-1;while(lo<hi){const m=(lo+hi)>>1;if(day.legs[m].t1<=tt)lo=m+1;else hi=m;}
  const leg=day.legs[lo],where={level:leg.level,...(leg.frame?{frame:leg.frame}:{})};
  if(leg.hidden)return {...where,x:0,z:0,heading:0,hidden:true};
  if(leg.at){
    // Face the way it last walked.
    let prev:Path|undefined;for(let i=lo-1;i>=0&&!prev;i--)prev=day.legs[i].path;
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
export const rotate=<T,>(list:T[],k:number)=>list.map((_,i)=>list[(i+k)%list.length]);
