import type {Pt} from './roads';
import {TRANSPORT} from './transportScale';

/**
 * Commerce Pipeline's headquarters, the teardrop tower (Khaneil, 2026-11-01): a glass tower on a
 * teardrop plan, round at one end and drawn to a soft point at the other, that twists as it
 * rises. A silver curtain wall of vertical fins wraps it, and a warm gold glass ribbon winds up
 * one face in an S. The roof is cut on a slope, high at the point, and the fins run on past it
 * as a screen. It stands on a four-storey podium that is the full teardrop of the site, as in the
 * concept's floor plans (podium about 72 x 50 m, tower 48 x 40 m on its round end): the podium
 * runs out past the tower toward the point, about half as wide again, with a gold glass lobby
 * under a sweeping canopy, and its roof beyond the tower is a garden with a pool and olive trees
 * (Khaneil, 2026-11-01: "expand the lower end of the building ... to realistic width").
 * An original stylized Atlas building after a Behance concept board: no reference signage.
 *
 * Plain numbers only, in coordinates local to the tower (x across, z toward the viewer, y up
 * from the floor base), at the tower's footprint `refSize`. Everything stays inside the plinth,
 * so the plaza, tool offices, roads and links around it stay put.
 */
export const COMMERCE={
 projectId:'commerce-pipeline',
 /** The headquarters' footprint in the widened Commerce district (see DISTRICT_MIN_SIZE and DISTRICT_HQ_SHARE in mapLayout). */
 refSize:2.944,
 /** Plinth half-size: nothing may stand outside it. Same share of the footprint as Benjaire HQ's. */
 plinth:1.67,
 /** Points round every plan outline (fine enough for the gold valley's curved walls). */
 ring:112,
 /** Teardrop: the round end's radius, the point's radius, and how far apart their centres are. */
 round:.8,tip:.6,length:.7,
 /** The way the point faces (radians, 0 = +x, turning toward +z); the round end's centre sits
  * inside the podium's round end, touching it at the back (see podium.offset). */
 heading:-.62,
 /** How far the plan turns from bottom to top, and how much it eases in and out (an S). */
 twist:0,
 /** The plan narrows toward the top by this share. */
 taper:.04,
 /** Reference drawing height, used before the scene matches it to the Financial District. */
 height:6.6,
 /** The roof's cut: the round end's roof stands this share of the height below the point's. */
 slope:.12,
 /** Fins stand out this far and run on above the glass by this much at the top. */
 finDepth:.04,
 /** Headroom over the roof for the roof garden's trees (was the fin screen): the nameplate sits above it, where it always has. */
 screen:.22,
 /** Floor bands every this much of the height, as thin ledges. */
 floor:.32,
 /**
  * The gold ribbon (realism pass, 2026-11-24): no longer a stripe painted on the skin but a
  * valley cut into the tower, splitting it into two silver blades with warm gold glass curving
  * between them, as on the reference board. How many outline points wide, how far it winds
  * round the plan, how deep the valley is cut, and how far the lip trims stand out. Business District
  * pass (2026-11-25): narrower and in restrained bronze, with bronze lips.
  */
 ribbon:{width:4,wind:.09,depth:0,lip:0},
 /**
  * Photo pass (Khaneil, 2026-11-25: "looks nothing like the photo"): the ribbon is no longer a
  * valley in the glass but a sculpture in front of it, a few polished bronze rods standing off the
  * front face and winding down it in a tall S from the roof edge to the podium terrace. How many,
  * how far they stand off the glass, their radius, and how far apart (outline points) they run.
  */
 rods:{count:3,standOff:.09,radius:.02,spread:2,samples:64},
 podium:{
  /** Storey heights bottom up: a grand clear-glass lobby (realism pass, 2026-11-24: taller, about two and a half storeys), then three office floors. */
  floors:[.56,.3,.3,.3] as number[],
  /** The podium's teardrop, same heading as the tower's base: half as wide again and longer. */
  round:1.1,tip:.7,length:1.7,
  /** The podium's round-end centre, local to the tower. */
  centre:[-.56,.4] as Pt,
  /** Roof garden parapet, glass. */
  rail:.08,
  /**
   * Business District pass (Khaneil, 2026-11-25): the podium steps back as it rises, storey by
   * storey, so its upper floors sit behind planted ledges. How far each storey's round end and
   * sides are pulled in, bottom up; the point end is pulled in a quarter as much, so the roof pool
   * keeps its place. The lobby storey keeps the full teardrop.
   */
  setback:[0,0,.2,.38] as number[],
  /** A planted ledge on each step: its width inside the lower storey's edge and its kerb height. */
  ledge:{inset:.012,kerb:.05},
 },
 /** The pool on the podium roof beyond the tower, along the axis toward the point: share of the podium's length, and radii. */
 pool:{at:1.15,rx:.2,rz:.15},
 /** The entrance canopy: a thin sweep over the lobby round the podium's front, as a share of its outline. */
 canopy:{span:.22,depth:.26,y:.58},
 /**
  * The lobby inside the clear glass (2026-11-24): a stone floor, the tower's core carried down
  * as a warm stone wall (grown in from the tower's base outline), a reception desk facing the
  * doors, slim white columns inside the glass line every this many podium points, and a lit soffit.
  */
 /**
  * The grounds round the podium, after the reference site plan (Khaneil, 2026-11-24: "add the
  * area surround from the pictures"): a pale stone forecourt following the teardrop, a drop-off
  * lane curving past the entrance, striped car-park ramps down the long side, and the square
  * plinth's open corners planted as lawns with trees. Widths are offsets from the podium's
  * outline; `edge` is how far inside the plinth's rim everything stops (negative: the grounds run
  * a little past it onto the level district plaza, which is wider than the plinth).
  */
 site:{forecourt:.16,lane:.15,laneSpan:20,ramp:[13,6] as [number,number],grid:.2,treeEvery:2,edge:0},
 lobby:{core:-.16,desk:[.42,.075,.09] as [number,number,number],deskBack:.42,columnEvery:2,columnInset:.13,column:.045,soffit:.035},
} as const;

export const isCommerceTower=(projectId:string)=>projectId===COMMERCE.projectId;
/**
 * Floor level (Khaneil, 2026-11-24: "integrated with Atlas street design and flooring level"): the
 * tower's forecourt is a thin slab this thick on the district plaza, not the 0.15 plinth the plain
 * towers stand on, so the lobby floor, forecourt and drop-off lane sit level with the city's
 * plaza paving and sidewalks and people walk straight in. World units above TERRACE_H.
 */
export const COMMERCE_FLOOR=.035;
/**
 * With the district's tool offices gone there is open plaza round the plinth, so the whole
 * building, plinth included, stands this much bigger than its lot size (Khaneil, 2026-11-24:
 * "expand the size"). Kept here, not in the district layout, so no street or neighbour moves.
 */
export const COMMERCE_GROW=1.35;
/** Drawing scale for a Commerce tower of lot size `size`. */
export const commerceScale=(size:number)=>size/COMMERCE.refSize*COMMERCE_GROW;
/**
 * The street ring round the tower (Khaneil, 2026-11-24, option A): once the building grew, the
 * standard ring (half the tower's lot plus a lane) ran under the podium. The ring's centre line now
 * runs a sidewalk and half a street outside the plinth's rim, so the kerb meets the forecourt.
 * The kerb gap is set so the ring's west side falls on the avenue down from the Financial District
 * (x 9.277 in the district view), so that avenue runs straight on along the ring. Half-widths from
 * the tower's centre, in world units.
 */
export const COMMERCE_RING_KERB=.077;
export const commerceRingHalf=(size:number)=>Math.floor((COMMERCE.plinth*commerceScale(size)+COMMERCE_RING_KERB+TRANSPORT.cityWidth/2)*1000)/1000;
/** The plaza paving reaches past the ring by half a street and a kerb, the same edge the other plazas keep. */
export const commercePlazaHalf=(size:number)=>commerceRingHalf(size)+TRANSPORT.cityWidth/2+.1;
/** Roof height at the point: the reference drawing's, or the height the scene gives it. */
export const commerceTop=(k=1,height?:number)=>height??COMMERCE.height*k;

const rot=([x,z]:Pt,a:number):Pt=>[x*Math.cos(a)-z*Math.sin(a),x*Math.sin(a)+z*Math.cos(a)];
/** Shoelace over x and z; the map's outlines run with a negative sum (see ribbonTowerPlan's blob). */
export const signedArea=(pts:Pt[])=>pts.reduce((s,[x,z],i)=>{const [x2,z2]=pts[(i+1)%pts.length];return s+x*z2-x2*z;},0)/2;

/**
 * The teardrop's outline, unturned, with its round end at the origin and its point along +x.
 * Two circles and the straight lines touching both, sampled evenly by length, starting at the
 * point so every level lines up point for point.
 */
export function teardrop(round:number=COMMERCE.round,tip:number=COMMERCE.tip,length:number=COMMERCE.length,n:number=COMMERCE.ring):Pt[]{
 const a=Math.acos((round-tip)/length);
 const tipArc=2*a*tip,side=Math.sqrt(length**2-(round-tip)**2),roundArc=(2*Math.PI-2*a)*round,total=tipArc+2*side+roundArc;
 const pts:Pt[]=[];
 for(let i=0;i<n;i++){
  let s=i/n*total;
  // Round the point, down the far side, round the back, up the near side.
  if(s<tipArc/2){const th=s/tip;pts.push([length+tip*Math.cos(th),tip*Math.sin(th)]);continue;}
  s-=tipArc/2;
  const A:Pt=[length+tip*Math.cos(a),tip*Math.sin(a)],B:Pt=[round*Math.cos(a),round*Math.sin(a)];
  if(s<side){const f=s/side;pts.push([A[0]+(B[0]-A[0])*f,A[1]+(B[1]-A[1])*f]);continue;}
  s-=side;
  if(s<roundArc){const th=a+s/round;pts.push([round*Math.cos(th),round*Math.sin(th)]);continue;}
  s-=roundArc;
  const C:Pt=[round*Math.cos(a),-round*Math.sin(a)],D:Pt=[length+tip*Math.cos(a),-tip*Math.sin(a)];
  if(s<side){const f=s/side;pts.push([C[0]+(D[0]-C[0])*f,C[1]+(D[1]-C[1])*f]);continue;}
  s-=side;const th=-a+s/tip;pts.push([length+tip*Math.cos(th),tip*Math.sin(th)]);
 }
 // Run the same way as the map's other outlines, so edge × up points outward.
 return signedArea(pts)>0?[pts[0],...pts.slice(1).reverse()]:pts;
}

/** How far the plan has turned at height t (0 base, 1 top): eased, so the twist reads as an S. */
export const twistAt=(t:number)=>COMMERCE.twist*(t-Math.sin(2*Math.PI*t)/(2*Math.PI));

/** The tower's round-end centre: inside the podium's round end, touching it at the back, so the tower rises flush on that side. */
export function towerCentre():Pt{
 const p=COMMERCE.podium,d=p.round-COMMERCE.round;
 return [p.centre[0]+d*Math.cos(COMMERCE.heading),p.centre[1]+d*Math.sin(COMMERCE.heading)];
}

/** The tower's plan at height t, local to the tower, scaled by k; `grow` pushes it outward. */
export function planAt(t:number,k=1,grow=0):Pt[]{
 const c=COMMERCE,s=1-c.taper*t;
 const base=teardrop(c.round*s+grow,c.tip*s+grow,c.length*s);
 // Turn about the shape's middle, not the round end, so the tower twists in place.
 const mid=c.length*s*.42,[ox,oz]=towerCentre();
 return base.map(([x,z])=>{const [rx,rz]=rot([x-mid,z],c.heading+twistAt(t));return [(rx+ox+mid*Math.cos(c.heading))*k,(rz+oz+mid*Math.sin(c.heading))*k] as Pt;});
}

/**
 * Roof height over each outline point, as a share of the point's height: the point stands
 * full height and the roof falls toward the round end.
 */
export function roofShare(i:number,n:number=COMMERCE.ring){
 const w=((i%n)+n)%n,f=Math.min(w,n-w)/(n/2);
 return 1-COMMERCE.slope*Math.sin(f*Math.PI/2)**1.5;
}

/**
 * Where the gold ribbon runs at height t, as a fractional outline index: on the face toward the
 * map's camera (which looks from +x, +z), swinging to either side of it as the tower rises, so
 * it reads as an S. Fractional, so the ribbon's edges stay smooth instead of stepping.
 */
export function ribbonCentre(t:number,n:number=COMMERCE.ring){
 const plan=planAt(t),cx=plan.reduce((a,p)=>a+p[0],0)/n,cz=plan.reduce((a,p)=>a+p[1],0)/n;
 const score=(i:number)=>{const [x,z]=plan[((i%n)+n)%n];return (x-cx+z-cz)/Math.hypot(x-cx,z-cz);};
 let best=0;for(let i=1;i<n;i++)if(score(i)>score(best))best=i;
 // Refine between the neighbours (a parabola through the three scores).
 const a=score(best-1),b=score(best),c=score(best+1),den=a-2*b+c,off=den?Math.max(-.5,Math.min(.5,(a-c)/(2*den))):0;
 return best+off+COMMERCE.ribbon.wind*n*Math.sin(2*Math.PI*t);
}
/** A point on a closed outline at fractional index f. */
export function along(pts:Pt[],f:number):Pt{
 const n=pts.length,i=Math.floor(f),u=f-i,a=pts[((i%n)+n)%n],b=pts[(((i+1)%n)+n)%n];
 return [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u];
}
/** Whole outline points the ribbon covers at height t (fins skip these). */
export function ribbonWindow(t:number,n:number=COMMERCE.ring){
 const c=ribbonCentre(t,n),h=COMMERCE.ribbon.width/2;
 const out:number[]=[];for(let i=Math.ceil(c-h);i<=Math.floor(c+h);i++)out.push(((i%n)+n)%n);
 return out;
}

/**
 * How far the gold valley is cut in at a point across it: x runs -1..1 lip to lip. A round
 * scoop, so the lips meet the blades square and the gold curves away between them.
 */
export const valleyInset=(x:number)=>COMMERCE.ribbon.depth*Math.sqrt(Math.max(0,1-x*x));

/** Floor band heights up the tower. */
export function floorHeights(k=1,height=COMMERCE.height*k){
 const step=COMMERCE.floor*k,n=Math.floor(height*(1-COMMERCE.slope)/step);
 return Array.from({length:n},(_,i)=>(i+1)*step);
}

/** Podium storey tops, bottom up. */
export const podiumTop=(level:number,k=1)=>COMMERCE.podium.floors.slice(0,level+1).reduce((a,b)=>a+b,0)*k;
export const podiumHeight=(k=1)=>podiumTop(COMMERCE.podium.floors.length-1,k);

/** The podium keeps the coarser outline: its curves are gentle and it is seen from above. */
export const PODIUM_RING=56;
/** The podium's outline: the full teardrop, unturned by the twist; `grow` pushes it out (negative pulls it in). */
export function podiumRing(k=1,grow=0):Pt[]{return podiumStorey(0,k,grow);}
/** One storey's outline: the teardrop pulled in by that storey's setback (the point end a quarter as much). */
export function podiumStorey(level:number,k=1,grow=0):Pt[]{
 const p=COMMERCE.podium,a=COMMERCE.heading,s=p.setback[Math.max(0,Math.min(p.setback.length-1,level))];
 return teardrop(p.round+grow-s,p.tip+grow-s/4,p.length,PODIUM_RING).map(([x,z])=>{const [rx,rz]=rot([x,z],a);return [(rx+p.centre[0])*k,(rz+p.centre[1])*k] as Pt;});
}

/**
 * The roof garden on the tower's sloped top (Business District pass, 2026-11-25): small trees set
 * in from the parapet, standing on the roof's slope. Local, scaled by k; `height` is the roof at the point.
 */
export function crownTrees(k:number,height:number){
 const n=COMMERCE.ring,plan=planAt(1,k),cx=plan.reduce((s,p)=>s+p[0],0)/n,cz=plan.reduce((s,p)=>s+p[1],0)/n;
 const mean=plan.reduce((s,_,i)=>s+roofShare(i,n),0)/n;
 return Array.from({length:7},(_,j)=>Math.round(j*n/7+n/14)).map(i=>{const [x,z]=plan[i],f=.58;return {x:cx+(x-cx)*f,z:cz+(z-cz)*f,y:height*(roofShare(i,n)*f+mean*(1-f))};});
}

/** The pool's outline on the podium roof, lying along the axis beyond the tower. */
export function poolRing(k=1,n=28):Pt[]{
 const {at,rx,rz}=COMMERCE.pool,p=COMMERCE.podium,a=COMMERCE.heading,d=p.length*at;
 const cx=p.centre[0]+d*Math.cos(a),cz=p.centre[1]+d*Math.sin(a);
 return Array.from({length:n},(_,i)=>{const th=-i/n*Math.PI*2,w=1+.1*Math.sin(3*th);return rot([rx*Math.cos(th)*w,rz*Math.sin(th)*w],a);}).map(([x,z])=>[(cx+x)*k,(cz+z)*k] as Pt);
}
export const poolCentre=(k=1):Pt=>{const r=poolRing(k);return [r.reduce((s,p)=>s+p[0],0)/r.length,r.reduce((s,p)=>s+p[1],0)/r.length];};

const insidePoly=(p:Pt,poly:Pt[])=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>p[1])!==(zj>p[1])&&p[0]<(xj-xi)*(p[1]-zi)/(zj-zi)+xi)c=!c;}return c;};

/** Olive trees on the podium roof: along its open edge, clear of the tower and the pool. */
export function roofTrees(k=1){
 const ring=podiumStorey(COMMERCE.podium.floors.length-1,1,-.08),tower=planAt(0,1,.1),pool=poolRing(1);
 const near=(p:Pt,poly:Pt[],d:number)=>poly.some(([x,z])=>Math.hypot(x-p[0],z-p[1])<d);
 return ring.filter((p,i)=>i%2===0&&!insidePoly(p,tower)&&!near(p,tower,.16)&&!near(p,pool,.2)).map(([x,z])=>({x:x*k,z:z*k,y:podiumHeight(k)}));
}

/** Keeps a ground point inside the plinth's rim. */
const onPlinth=([x,z]:Pt):Pt=>{const e=COMMERCE.plinth-COMMERCE.site.edge;return [Math.max(-e,Math.min(e,x)),Math.max(-e,Math.min(e,z))];};
/** A band of the podium's outline pushed out from `a` to `b`, clamped to the plinth (local, unscaled). */
export function siteBand(a:number,b:number):[Pt[],Pt[]]{return [podiumRing(1,a).map(onPlinth),podiumRing(1,b).map(onPlinth)];}
/** The open corners of the square plinth beyond the forecourt and lane: lawn tiles, with a tree on every other one. */
export function siteLawns(k=1){
 const S=COMMERCE.site,e=COMMERCE.plinth-S.edge,keep=podiumRing(1,S.forecourt+S.lane+.06),out:{x:number;z:number;s:number;tree:boolean}[]=[];
 const n=Math.floor(2*e/S.grid);
 for(let i=0;i<n;i++)for(let j=0;j<n;j++){
  const x=-e+(i+.5)*S.grid,z=-e+(j+.5)*S.grid,h=S.grid/2;
  if([[x-h,z-h],[x+h,z-h],[x-h,z+h],[x+h,z+h],[x,z]].some(p=>insidePoly(p as Pt,keep)))continue;
  out.push({x:x*k,z:z*k,s:S.grid*.92*k,tree:(i+j)%S.treeEvery===0});
 }
 return out;
}

/** The outline point the lobby faces from: the podium's front (largest z), where the canopy is centred. */
export function frontIndex(){
 const ring=podiumRing();let best=0;ring.forEach(([,z],i)=>{if(z>ring[best][1])best=i;});return best;
}
/** The canopy's outline span [first, last] (may run past the ring's end; wrap with modulo). */
export function canopySpan(n:number=PODIUM_RING):[number,number]{
 const c=frontIndex(),h=Math.round(COMMERCE.canopy.span*n/2);return [c-h,c+h];
}

/** Every outline on the ground plan, for clearance checks. */
export function footprint(k=1):Pt[]{
 const tower=[0,.25,.5,.75,1].flatMap(t=>planAt(t,k,COMMERCE.finDepth));
 return [...tower,...podiumRing(k)];
}

/** The podium's front at the entrance, local to the tower: the wall (`wall`) and the canopy's edge (`z`). */
export function commerceFront(k=1){
 const [x,wall]=podiumRing(k)[frontIndex()];
 return {x,wall,z:wall+COMMERCE.canopy.depth*k+.005*k,door:podiumTop(0,k)};
}
