import type {Pt} from './roads';

/**
 * Commerce Pipeline's headquarters, the teardrop tower (KC, 2026-11-01): a glass tower on a
 * teardrop plan, round at one end and drawn to a soft point at the other, that twists as it
 * rises. A silver curtain wall of vertical fins wraps it, and a warm gold glass ribbon winds up
 * one face in an S. The roof is cut on a slope, high at the point, and the fins run on past it
 * as a screen. A low curved podium wraps the round end with a lobby of gold glass under a
 * sweeping canopy, and its roof is a garden with a free-form pool and olive trees.
 * An original stylized Atlas building after a Behance concept board: no reference signage.
 *
 * Plain numbers only, in coordinates local to the tower (x across, z toward the viewer, y up
 * from the floor base), at the tower's footprint `refSize`. Everything stays inside the plinth,
 * so the plaza, tool offices, roads and links around it stay put.
 */
export const COMMERCE={
 projectId:'commerce-pipeline',
 /** The tower's footprint in the widened Commerce district (see DISTRICT_MIN_SIZE in mapLayout). */
 refSize:2.392,
 /** Plinth half-size: nothing may stand outside it. Same share of the footprint as Benjaire HQ's. */
 plinth:1.36,
 /** Points round every plan outline. */
 ring:56,
 /** Teardrop: the round end's radius, the point's radius, and how far apart their centres are. */
 round:.54,tip:.15,length:1.06,
 /** The round end's centre, and the way the point faces (radians, 0 = +x, turning toward +z). */
 centre:[-.24,.16] as Pt,
 heading:-.62,
 /** How far the plan turns from bottom to top, and how much it eases in and out (an S). */
 twist:.62,
 /** The plan narrows toward the top by this share. */
 taper:.08,
 /** Reference drawing height, used before the scene matches it to the Financial District. */
 height:6.6,
 /** The roof's cut: the round end's roof stands this share of the height below the point's. */
 slope:.1,
 /** Fins stand out this far and run on above the glass by this much at the top. */
 finDepth:.05,finEvery:2,screen:.22,
 /** Floor bands every this much of the height, as thin ledges. */
 floor:.24,
 /** The gold ribbon: how many outline points wide, and how far it winds round the plan. */
 ribbon:{width:7,wind:.07},
 podium:{
  /** Storey heights bottom up: a double-height lobby, then two office floors. */
  floors:[.4,.2,.2] as number[],
  centre:[-.02,.36] as Pt,half:[.96,.86] as Pt,
  /** Roof garden parapet, glass. */
  rail:.08,
 },
 /** The pool on the podium roof, toward the front corner. */
 pool:{x:.48,z:.9,rx:.3,rz:.13,turn:-.35},
 /** The entrance canopy: a thin sweep over the lobby along the podium's front. */
 canopy:{from:.63,to:.87,depth:.24,y:.42},
} as const;

export const isCommerceTower=(projectId:string)=>projectId===COMMERCE.projectId;
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

/** The tower's plan at height t, local to the tower, scaled by k; `grow` pushes it outward. */
export function planAt(t:number,k=1,grow=0):Pt[]{
 const c=COMMERCE,s=1-c.taper*t;
 const base=teardrop(c.round*s+grow,c.tip*s+grow,c.length*s);
 // Turn about the shape's middle, not the round end, so the tower twists in place.
 const mid=c.length*s*.42;
 return base.map(([x,z])=>{const [rx,rz]=rot([x-mid,z],c.heading+twistAt(t));return [(rx+c.centre[0]+mid*Math.cos(c.heading))*k,(rz+c.centre[1]+mid*Math.sin(c.heading))*k] as Pt;});
}

/**
 * Roof height over each outline point, as a share of the point's height: the point stands
 * full height and the roof falls toward the round end.
 */
export function roofShare(i:number,n:number=COMMERCE.ring){
 const f=Math.min(i,n-i)/(n/2);
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

/** Floor band heights up the tower. */
export function floorHeights(k=1,height=COMMERCE.height*k){
 const step=COMMERCE.floor*k,n=Math.floor(height*(1-COMMERCE.slope)/step);
 return Array.from({length:n},(_,i)=>(i+1)*step);
}

/** Podium storey tops, bottom up. */
export const podiumTop=(level:number,k=1)=>COMMERCE.podium.floors.slice(0,level+1).reduce((a,b)=>a+b,0)*k;
export const podiumHeight=(k=1)=>podiumTop(COMMERCE.podium.floors.length-1,k);

/** The podium's outline: a soft rounded square swelling toward the front corner, round the tower's base. */
export function podiumRing(k=1,inset=1):Pt[]{
 const {centre:[cx,cz],half:[hx,hz]}=COMMERCE.podium,n=COMMERCE.ring,pts:Pt[]=[];
 for(let i=0;i<n;i++){
  const th=-i/n*Math.PI*2,c=Math.cos(th),s=Math.sin(th),e=2/3.2;
  const swell=1+.06*Math.cos(th-Math.PI/4);
  pts.push([(cx+hx*inset*Math.sign(c)*Math.abs(c)**e*swell)*k,(cz+hz*inset*Math.sign(s)*Math.abs(s)**e*swell)*k]);
 }
 return pts;
}

/** The pool's outline on the podium roof. */
export function poolRing(k=1,n=28):Pt[]{
 const {x,z,rx,rz,turn}=COMMERCE.pool;
 return Array.from({length:n},(_,i)=>{const th=-i/n*Math.PI*2,w=1+.12*Math.sin(3*th);return rot([rx*Math.cos(th)*w,rz*Math.sin(th)*w],turn);}).map(([a,b])=>[(x+a)*k,(z+b)*k] as Pt);
}

/** Olive trees on the podium roof: along its open edge, clear of the tower and the pool. */
export function roofTrees(k=1){
 const ring=podiumRing(1,.84),tower=planAt(0,1,.1),pool=poolRing(1);
 const inside=(p:Pt,poly:Pt[])=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>p[1])!==(zj>p[1])&&p[0]<(xj-xi)*(p[1]-zi)/(zj-zi)+xi)c=!c;}return c;};
 const near=(p:Pt,poly:Pt[],d:number)=>poly.some(([x,z])=>Math.hypot(x-p[0],z-p[1])<d);
 return ring.filter((p,i)=>i%5===0&&!inside(p,tower)&&!near(p,tower,.16)&&!near(p,pool,.12)).map(([x,z])=>({x:x*k,z:z*k,y:podiumHeight(k)}));
}

/** Every outline on the ground plan, for clearance checks. */
export function footprint(k=1):Pt[]{
 const tower=[0,.25,.5,.75,1].flatMap(t=>planAt(t,k,COMMERCE.finDepth));
 return [...tower,...podiumRing(k)];
}

/** The podium's front at the entrance, local to the tower: where the canopy's middle reaches. */
export function commerceFront(k=1){
 const ring=podiumRing(k),i=Math.round((COMMERCE.canopy.from+COMMERCE.canopy.to)/2*ring.length)%ring.length;
 return {x:ring[i][0],z:ring[i][1]+COMMERCE.canopy.depth*k+.005*k,door:podiumTop(0,k)};
}
