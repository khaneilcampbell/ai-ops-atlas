import * as THREE from 'three';
import {mergeGeometries,mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {Pt} from './roads';
import {HQ,core,entrance,hqTop,outline,storey,trees,type Pt3} from './atlasHqPlan';

/**
 * Atlas HQ geometry, built once into a few merged meshes. Levels are closed outlines with the
 * same number of points, counter-clockwise seen from above, so the outward side is edge × up.
 */

/**
 * Shrink a finished mesh for the GPU: drop the UVs where none were laid out (all zero, so no
 * texture reads them anyway) and share the vertices that triangles repeat. Normals stay as they
 * were, so it looks the same; it holds about a third of the memory.
 */
export function compactGeometry(g:THREE.BufferGeometry){
 const uv=g.getAttribute('uv');
 if(uv&&(uv.array as ArrayLike<number>).length&&Array.prototype.every.call(uv.array,(x:number)=>x===0))g.deleteAttribute('uv');
 const out=mergeVertices(g,1e-4);
 if(out!==g)g.dispose();
 return out;
}
/** compactGeometry over every geometry in a set of parts, leaving the rest as it is. */
export function compact<T extends object>(parts:T):T{
 const out={...parts} as Record<string,unknown>;
 for(const [k,v] of Object.entries(out))if(v instanceof THREE.BufferGeometry)out[k]=compactGeometry(v);
 return out as T;
}

function mesh(pos:number[],uv?:number[]){
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv??new Array(pos.length/3*2).fill(0),2));
 g.computeVertexNormals();
 return g;
}
const quad=(out:number[],a:Pt3,b:Pt3,c:Pt3,d:Pt3)=>out.push(...a,...b,...c,...a,...c,...d);

/** Outward unit normal at each outline point (average of its two edges). */
function normals(pts:Pt[]):Pt[]{
 const n=pts.length;
 return pts.map((_,i)=>{
  const [ax,az]=pts[(i+n-1)%n],[bx,bz]=pts[(i+1)%n];
  // For this winding, the edge (dx, dz) crossed with up points outward: (-dz, dx).
  const dx=bx-ax,dz=bz-az,l=Math.hypot(dx,dz)||1;
  return [-dz/l,dx/l];
 });
}

/**
 * Glass skin between levels. UVs run along the outline in bays and up in floors, so the facade
 * texture puts a mullion every bay and a spandrel every floor on any curve. With `perPoint` set, u
 * steps that much at every outline point instead, so mullions stand on the points; `tile` is the
 * height one texture tile (four floors) covers.
 */
export function skin(levels:Pt3[][],perPoint=0,tile=HQ.floor*4){
 const pos:number[]=[],uv:number[]=[],n=levels[0].length;
 const run=[0];for(let i=1;i<=n;i++){const [ax,,az]=levels[0][i-1],[bx,,bz]=levels[0][i%n];run.push(run[i-1]+Math.hypot(bx-ax,bz-az));}
 const U=(i:number)=>perPoint?i*perPoint:run[i]/(HQ.bay*4),V=(y:number)=>y/tile;
 for(let l=0;l<levels.length-1;l++)for(let i=0;i<n;i++){
  const j=(i+1)%n,a=levels[l][i],b=levels[l][j],c=levels[l+1][j],d=levels[l+1][i];
  quad(pos,a,b,c,d);
  uv.push(U(i),V(a[1]),U(i+1),V(b[1]),U(i+1),V(c[1]),U(i),V(a[1]),U(i+1),V(c[1]),U(i),V(d[1]));
 }
 return mesh(pos,uv);
}

/** A flat-ish lid over a closed outline (a fan from its centre, following each point's height). */
export function lid(pts:Pt3[],lift=0){
 const pos:number[]=[],n=pts.length,c:Pt3=[0,0,0];
 for(const p of pts){c[0]+=p[0]/n;c[1]+=p[1]/n;c[2]+=p[2]/n;}
 c[1]+=lift;
 for(let i=0;i<n;i++){const a=pts[i],b=pts[(i+1)%n];pos.push(...c,...a,...b);}
 return mesh(pos);
}

/**
 * Vertical fins standing out of a skin: one thin strip per chosen outline point, following the
 * point up every level, so on the wing they sway with it. Blade points stand out further.
 */
export function fins(levels:Pt3[][],every:number,depth:number,blades:number[]=[],blade=depth){
 const pos:number[]=[],n=levels[0].length,norms=levels.map(l=>normals(l.map(([x,,z])=>[x,z])));
 for(let i=0;i<n;i++){
  const isBlade=blades.includes(i);if(i%every&&!isBlade)continue;
  const d=isBlade?blade:depth;
  for(let l=0;l<levels.length-1;l++){
   const p=levels[l][i],q=levels[l+1][i],np=norms[l][i],nq=norms[l+1][i];
   const po:Pt3=[p[0]+np[0]*d,p[1],p[2]+np[1]*d],qo:Pt3=[q[0]+nq[0]*d,q[1],q[2]+nq[1]*d];
   // Both faces, so the fin catches light from either side without a double-sided material.
   quad(pos,p,po,qo,q);quad(pos,po,p,q,qo);
  }
 }
 return mesh(pos);
}

/** Floor bands: a thin ledge round an outline at each height, clipped to the outline's top. */
export function bands(outline:(y:number)=>Pt3[]|null,heights:number[]){
 const pos:number[]=[],D=HQ.bandDepth,H=HQ.bandHeight;
 for(const y of heights){
  const pts=outline(y);if(!pts)continue;
  const n=pts.length,ns=normals(pts.map(([x,,z])=>[x,z]));
  for(let i=0;i<n;i++){
   const j=(i+1)%n;if(pts[i][1]<y+H||pts[j][1]<y+H)continue;
   const a:Pt3=[pts[i][0],y,pts[i][2]],b:Pt3=[pts[j][0],y,pts[j][2]];
   const ao:Pt3=[a[0]+ns[i][0]*D,y,a[2]+ns[i][1]*D],bo:Pt3=[b[0]+ns[j][0]*D,y,b[2]+ns[j][1]*D];
   const up=(p:Pt3):Pt3=>[p[0],p[1]+H,p[2]];
   quad(pos,ao,bo,up(bo),up(ao));quad(pos,up(a),up(ao),up(bo),up(b));quad(pos,a,b,bo,ao);
  }
 }
 return mesh(pos);
}

/** Everything static, grouped by material. Positions are local to the building centre and floor base. */
export function hqGeometry(k=1){
 const pts=outline(k),h=storey(k),top=hqTop(k),ring=(y:number):Pt3[]=>pts.map(([x,z])=>[x,y,z]);
 const flat=ring(Infinity),lobbyLevels=[ring(0),ring(h)],office=[ring(h),ring(top)];
 // One bay per outline point, like the interior's mullions; one texture tile is four storeys.
 const bay=1/4,tile=h*4;
 const box=(w:number,bh:number,d:number,x:number,y:number,z:number)=>new THREE.BoxGeometry(w,bh,d).translate(x,y+bh/2,z).toNonIndexed();
 const c=core(k),cn=entrance(k),ph=cn.t*1.4;
 return compact({
  lobby:skin(lobbyLevels,bay,tile),
  glass:skin(office,bay,tile),
  // Cream stone: a slab edge at every floor, the parapet, the lift core and the canopy.
  stone:mergeGeometries([
   bands(()=>flat,Array.from({length:HQ.plate.levels-1},(_,i)=>(i+1)*h)),
   bands(()=>flat,[top-HQ.bandHeight]),
   box(c.w,c.h,c.d,c.x,0,c.z),
   box(cn.w,cn.t,cn.z1-cn.z0,0,cn.y,(cn.z0+cn.z1)/2),
  ])!,
  panels:fins(office,HQ.panelEvery,HQ.panelDepth),
  // Brass: the canopy fascia and its two slim posts.
  brass:mergeGeometries([
   box(cn.w+.02*k,ph,.018*k,0,cn.y-(ph-cn.t)/2,cn.z1),
   ...[-1,1].map(s=>box(.022*k,cn.y,.022*k,s*(cn.w/2-.02*k),0,cn.z1-.02*k)),
  ])!,
  roof:lid(ring(top-.005*k)),
  trees:trees(k).map(([x,z])=>({x,z})),
 });
}
export type HqGeometry=ReturnType<typeof hqGeometry>;
export const hqTriangles=(h:HqGeometry)=>Object.values(h).reduce((n,v)=>n+(v instanceof THREE.BufferGeometry?(v.index?v.index.count:v.getAttribute('position').count)/3:0),0);
