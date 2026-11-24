import type {Pt} from '../map3d/roads';
import {COMMERCE,isCommerceTower,ribbonWindow,teardrop} from '../map3d/commerceTowerPlan';

/**
 * The wave tower inside (Khaneil, 2026-11-24: "build the interior fully now use the screenshot
 * images as reference"). Plain numbers, no three.js.
 *
 * Every floor plate is the tower's teardrop, fitted round the office floor so the agents' desks
 * keep their places, in a clear curtain wall that turns gold where the ribbon wraps that storey.
 * The ground floor follows the reference's ground-floor plan of a bank headquarters: the main hall
 * at the doors, a long transaction counter with waiting seats in front of it, the accounting
 * back office behind it in four-desk crosses, a client lounge in the pointed end, a café in the
 * round end, a glass meeting room, the vault, and two stone cores, all on a column grid.
 *
 * Coordinates are the office scene's: x across, z toward the open front (the doors), y up.
 */
export const COMMERCE_INTERIOR={
 /** Glass keeps at least this far outside the office floor. */
 margin:.7,
 height:2.7,
 /** The lobby's glass runs up to the floor above: a double-height hall, as in the section. */
 lobbyHeight:3.3,
 sill:.34,
 /** Storeys the gold ribbon is read at: the interior's five floors are the tower's lowest. */
 storeys:24,
 /** Column grid spacing, the reference's 10 m bays at interior scale. */
 bay:4,
 columnR:.17,
} as const;

export const isCommerceInterior=isCommerceTower;

/** True when p is inside the closed outline. */
export function inside(p:Pt,poly:Pt[]){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>p[1])!==(zj>p[1])&&p[0]<(xj-xi)*(p[1]-zi)/(zj-zi)+xi)c=!c;}return c;}

/**
 * The teardrop fitted round a w by d office floor: its long axis across (x), the round end to +x
 * and the point to -x, as small as it can be while the floor and its margin stay inside.
 * Uniform scale, so the plate keeps the tower's proportions.
 */
export function commerceOutline(w:number,d:number):Pt[]{
 const raw=teardrop(),xs=raw.map(p=>p[0]),zs=raw.map(p=>p[1]);
 // Round end to +x: mirror, and centre on the shape's middle.
 const cx=(Math.max(...xs)+Math.min(...xs))/2,cz=(Math.max(...zs)+Math.min(...zs))/2;
 const base=raw.map(([x,z]):Pt=>[-(x-cx),z-cz]).reverse();
 const m=COMMERCE_INTERIOR.margin,a=w/2+m,b=d/2+m;
 const test:Pt[]=[[-a,-b],[a,-b],[a,b],[-a,b],[0,-b],[0,b],[-a,0],[a,0]];
 let best:Pt[]|undefined,area=Infinity;
 // Slide the floor toward the round end, where the plate is widest, and keep the smallest fit.
 for(let off=0;off<=.3;off+=.02){
  for(let s=1;s<80;s*=1.02){
   const pts=base.map(([x,z]):Pt=>[x*s-off*s,z*s]);
   if(test.every(p=>inside(p,pts))){if(s<area){area=s;best=pts;}break;}
  }
 }
 return best!;
}

/** Outline index i, mapped back to the tower's own numbering (point first), for the ribbon. */
const towerIndex=(i:number,n:number)=>((n-1-i)%n+n)%n;
/** Is this stretch of glass gold on this floor: the ribbon's window read at the floor's height. */
export function goldAt(i:number,level:number,n:number=COMMERCE.ring){
 const t=(level+.5)/COMMERCE_INTERIOR.storeys;return ribbonWindow(t,n).includes(towerIndex(i,n));
}

/** The plate's extent. */
export function extent(pts:Pt[]){const xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]);return {x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};}
/** Where the front glass crosses x (the largest z on the outline there). */
export function frontZ(pts:Pt[],x:number){
 let best=-Infinity;const n=pts.length;
 for(let i=0;i<n;i++){const [ax,az]=pts[i],[bx,bz]=pts[(i+1)%n];if((ax-x)*(bx-x)<=0&&ax!==bx){const z=az+(bz-az)*(x-ax)/(bx-ax);if(z>best)best=z;}}
 return best;
}

/** The plate's own grid: u runs 0 at the point to 1 at the round end, v -1 at the back to 1 at the front. */
function grid(w:number,d:number){const pts=commerceOutline(w,d),E=extent(pts),L=E.x1-E.x0,D=E.z1-E.z0;return {pts,E,X:(u:number)=>E.x0+u*L,Z:(v:number)=>v*D/2};}

/**
 * The two stone cores (lifts, stairs, washrooms), outside the office floor so no desk moves: the
 * main one in the strip behind it, the second in the pointed end, as the reference plan's two.
 */
export function cores(w:number,d:number){
 const {X,Z}=grid(w,d);return [{x:X(.62),z:Z(-.82),w:3,d:1.6},{x:X(.12),z:0,w:1.6,d:1.8}];
}

export type Item={kind:'counter'|'teller'|'bench'|'desk'|'chair'|'sofa'|'table'|'roundTable'|'stool'|'glassRoom'|'meetingTable'|'vault'|'atm'|'planter'|'reception'|'screen'|'partition'|'cafeBar';x:number;z:number;w:number;d:number;h:number;r?:number;
 /** A sofa's back: -1 on its -x side, 1 on its +x side. */
 back?:number};

/**
 * The ground floor's furniture, zone by zone, from the reference plan, placed on the plate's own
 * grid so it fills the whole teardrop. Every piece stays inside the glass and out of the cores.
 */
export function groundFloor(w:number,d:number):Item[]{
 const {pts,X,Z}=grid(w,d),out:Item[]=[],add=(it:Item)=>out.push(it);
 // Banking hall: the long transaction counter, tellers' screens on it and their stools behind.
 const cx0=X(.36),cx1=X(.64),cw=cx1-cx0,cz=Z(-.26);
 add({kind:'counter',x:(cx0+cx1)/2,z:cz,w:cw,d:.7,h:1.05});
 for(let i=0;i<5;i++){const x=cx0+cw*(i+.5)/5;add({kind:'teller',x,z:cz-.05,w:.5,d:.05,h:.32});add({kind:'stool',x,z:cz-.75,w:.4,d:.4,h:.5});}
 // Waiting seats in two rows facing the counter.
 for(const v of [0,.18])for(let c=0;c<3;c++)add({kind:'bench',x:cx0+cw*(c+.5)/3,z:Z(v),w:cw/3-.5,d:.5,h:.45});
 // Back office behind the counter: four-desk crosses with low screens, as on the plan.
 for(const u of [.42,.53])for(const r of [0,Math.PI/2])add({kind:'desk',x:X(u),z:Z(-.6),w:1.9,d:.6,h:.74,r});
 // Client lounge in the pointed end: two sofas round a low table.
 const lx=X(.27),lz=Z(.22);add({kind:'table',x:lx,z:lz,w:.8,d:.8,h:.4});add({kind:'sofa',x:lx-1,z:lz,w:.75,d:1.6,h:.75,back:-1});add({kind:'sofa',x:lx+1,z:lz,w:.75,d:1.6,h:.75,back:1});
 // A glass meeting room behind it.
 const mx=X(.3),mz=Z(-.3);add({kind:'glassRoom',x:mx,z:mz,w:2.4,d:1.8,h:2.5});add({kind:'meetingTable',x:mx,z:mz,w:1.4,d:.6,h:.74});
 // Café in the round end: a bar and round tables.
 add({kind:'cafeBar',x:X(.78),z:0,w:.5,d:2.2,h:1.05});
 for(const x of [X(.85),X(.93)])for(const z of [Z(-.26),0,Z(.26)])add({kind:'roundTable',x,z,w:.7,d:.7,h:.74});
 // The vault behind the café, the reception desk by the doors, ATMs and planters on the front glass.
 add({kind:'vault',x:X(.78),z:Z(-.68),w:1.4,d:1,h:2.2});
 add({kind:'reception',x:X(.74),z:Z(.55),w:2,d:.6,h:1.05});
 for(let i=0;i<3;i++){const x=X(.44)+i*.7;add({kind:'atm',x,z:frontZ(pts,x)-.55,w:.5,d:.4,h:1.6});}
 for(const x of [X(.55),X(.7)])add({kind:'planter',x,z:frontZ(pts,x)-.7,w:.6,d:.6,h:.5});
 const cs=cores(w,d),pad=(it:Item)=>(it.r?Math.max(it.w,it.d):it.w)/2;
 return out.filter(it=>[[-1,-1],[1,-1],[1,1],[-1,1]].every(([sx,sz])=>inside([it.x+sx*pad(it),it.z+sz*(it.r?pad(it):it.d/2)],pts))
  &&cs.every(c=>Math.abs(it.x-c.x)>c.w/2+pad(it)||Math.abs(it.z-c.z)>c.d/2+it.d/2));
}

/** Columns on the reference's grid, inside the glass, clear of cores, furniture and the doors' path. */
export function columns(w:number,d:number,items:Item[]=[]):Pt[]{
 const pts=commerceOutline(w,d),E=extent(pts),B=COMMERCE_INTERIOR.bay,out:Pt[]=[];
 const clear=(x:number,z:number,r:number)=>[...cores(w,d),...items.map(i=>({x:i.x,z:i.z,w:i.r?Math.max(i.w,i.d):i.w,d:i.r?Math.max(i.w,i.d):i.d}))].every(c=>Math.abs(x-c.x)>c.w/2+r||Math.abs(z-c.z)>c.d/2+r);
 for(let x=Math.ceil(E.x0/B)*B;x<=E.x1;x+=B)for(let z=Math.ceil(E.z0/B)*B;z<=E.z1;z+=B){
  if(Math.abs(x)<1.4&&z>0)continue;
  const near=[[1,0],[-1,0],[0,1],[0,-1]].every(([dx,dz])=>inside([x+dx*.8,z+dz*.8],pts));
  if(near&&clear(x,z,.45))out.push([x,z]);
 }
 return out;
}

/** Glass height at an outline point: full on the lobby (double height), a storey above. */
export const glassTop=(level:number)=>level===0?COMMERCE_INTERIOR.lobbyHeight:COMMERCE_INTERIOR.height;
