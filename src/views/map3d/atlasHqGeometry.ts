import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {Pt} from './roads';
import {HQ,canopyAt,lobby,podiumHeight,podiumOutline,roofGarden,superellipse,towerLevels,wingLevels,type Pt3} from './atlasHqPlan';

/**
 * Atlas HQ geometry, built once into a few merged meshes. Levels are closed outlines with the
 * same number of points, counter-clockwise seen from above, so the outward side is edge × up.
 */

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
 * texture puts a mullion every bay and a spandrel every floor on any curve.
 */
export function skin(levels:Pt3[][]){
 const pos:number[]=[],uv:number[]=[],n=levels[0].length;
 const run=[0];for(let i=1;i<=n;i++){const [ax,,az]=levels[0][i-1],[bx,,bz]=levels[0][i%n];run.push(run[i-1]+Math.hypot(bx-ax,bz-az));}
 const U=(i:number)=>run[i]/(HQ.bay*4),V=(y:number)=>y/(HQ.floor*4);
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

/**
 * A level ring at height y, interpolated between the levels around it. Each point carries its
 * own roof height as y, so bands stop where a sloped or curved top cuts them off.
 */
function ringAt(levels:Pt3[][],y:number):Pt3[]|null{
 const n=levels.length,tops=levels[n-1];
 for(let l=0;l<n-1;l++){
  const y0=levels[l][0][1],y1=l+1===n-1?Math.min(...tops.map(p=>p[1])):levels[l+1][0][1];
  if(y<y0||(y>y1&&l<n-2))continue;
  const t=Math.min(1,Math.max(0,(y-y0)/((y1-y0)||1)));
  return levels[l].map((p,i)=>[p[0]+(levels[l+1][i][0]-p[0])*t,tops[i][1],p[2]+(levels[l+1][i][2]-p[2])*t]);
 }
 return null;
}

/** A canopy: a thin wavy lid, front edge rippling, plus a fascia strip along the front. */
export function canopy(k=1){
 const top:number[]=[],steps=24,T=.04*k,rows:{x:number;front:number;back:number;y:number}[]=[];
 for(let i=0;i<=steps;i++)rows.push(canopyAt(i/steps,k));
 for(let i=0;i<steps;i++){
  const a=rows[i],b=rows[i+1];
  const A:Pt3=[a.x,a.y,a.back],B:Pt3=[b.x,b.y,b.back],C:Pt3=[b.x,b.y,b.front],D:Pt3=[a.x,a.y,a.front];
  // Top (faces up), underside (faces down), and the front fascia.
  quad(top,A,D,C,B);
  const dn=(p:Pt3):Pt3=>[p[0],p[1]-T,p[2]];
  quad(top,dn(A),dn(B),dn(C),dn(D));
  quad(top,dn(D),dn(C),C,D);
 }
 return mesh(top);
}

/** Lobby glass: a curved wall across the tower front, bulging a little toward the plaza. */
export function lobbyGlass(k=1){
 const L=lobby(k),pos:number[]=[],uv:number[]=[],steps=16;
 for(let i=0;i<steps;i++){
  const x0=L.x0+(L.x1-L.x0)*i/steps,x1=L.x0+(L.x1-L.x0)*(i+1)/steps;
  const z=(x:number)=>L.z+.05*k*Math.sin((x-L.x0)/(L.x1-L.x0)*Math.PI);
  quad(pos,[x0,0,z(x0)],[x1,0,z(x1)],[x1,L.h,z(x1)],[x0,L.h,z(x0)]);
  const u0=i/steps*3,u1=(i+1)/steps*3;uv.push(u0,0,u1,0,u1,.5,u0,0,u1,.5,u0,.5);
 }
 return mesh(pos,uv);
}

/** Everything static, grouped by material. Positions are local to the tower centre and floor base. */
export function hqGeometry(k=1){
 const tower=towerLevels(k),wing=wingLevels(k);
 const podium=podiumOutline(k),ph=podiumHeight(k),pRing=(y:number):Pt3[]=>podium.map(([x,z])=>[x,y,z]);
 const podiumLevels=[pRing(0),pRing(ph)];
 const floors=Array.from({length:HQ.floors},(_,i)=>(i+1)*HQ.floor*k);
 const podiumFloors=Array.from({length:HQ.podiumLevels},(_,i)=>(i+1)*HQ.podiumFloor*k);
 // Blades: the wing's two narrow tips, where the bright S-curved edges run.
 const blades=[0,HQ.ring/2];
 const garden=roofGarden(k);
 const lawn=lid(superellipse(.4*k,-.24*k,.42*k,.6*k,3.2).map(([x,z])=>[x,garden.y+.012*k,z] as Pt3));
 const pools=mergeGeometries(garden.pools.map(p=>lid(superellipse(p.x,p.z,p.a,p.b,2.2,24,p.turn).map(([x,z])=>[x,garden.y+.02*k,z] as Pt3))))!;
 return {
  towerGlass:skin(tower),
  wingGlass:skin(wing),
  podiumGlass:skin(podiumLevels),
  roofs:mergeGeometries([lid(tower[1],.02*k),lid(wing[wing.length-1]),lid(podiumLevels[1])])!,
  bands:mergeGeometries([
   bands(y=>ringAt(tower,y),floors),
   bands(y=>ringAt(wing,y),floors.filter(y=>y<HQ.wingTop*k)),
   bands(y=>y<=ph?pRing(Infinity):null,podiumFloors),
  ])!,
  fins:mergeGeometries([fins(tower,HQ.finEvery,HQ.finDepth),fins(wing,HQ.finEvery,HQ.finDepth,blades,HQ.bladeDepth)])!,
  podiumFins:podium.flatMap(([x,z],i)=>{
   // Two slim ribs per outline point on the podium, the ribbed glass of the reference.
   const n=normals(podium)[i],next=podium[(i+1)%podium.length];
   return [0,.5].map(t=>({p:[x+(next[0]-x)*t+n[0]*.012*k,0,z+(next[1]-z)*t+n[1]*.012*k] as [number,number,number],r:Math.atan2(n[0],n[1])}));
  }),
  lobby:lobbyGlass(k),
  canopy:canopy(k),
  lawn,pools,
  trees:garden.trees.map(([x,z])=>({x,z,y:garden.y})),
 };
}
export type HqGeometry=ReturnType<typeof hqGeometry>;
export const hqTriangles=(h:HqGeometry)=>Object.values(h).reduce((n,v)=>n+(v instanceof THREE.BufferGeometry?v.getAttribute('position').count/3:0),0);
