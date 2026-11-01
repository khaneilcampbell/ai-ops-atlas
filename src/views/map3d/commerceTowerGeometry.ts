import * as THREE from 'three';
import {mergeGeometries,mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {Pt} from './roads';
import {compact,fins,lid,skin} from './atlasHqGeometry';
import type {Pt3} from './atlasHqPlan';
import {annulus,slab} from './ribbonTowerGeometry';
import {COMMERCE,along,canopySpan,floorHeights,planAt,podiumRing,podiumTop,poolCentre,poolRing,ribbonCentre,ribbonWindow,roofShare,roofTrees} from './commerceTowerPlan';

/** Commerce Pipeline's teardrop tower: a few merged meshes, built once. See commerceTowerPlan for the design. */

const quad=(o:number[],a:Pt3,b:Pt3,c:Pt3,d:Pt3)=>o.push(...a,...b,...c,...a,...c,...d);
function geo(pos:number[],uv?:number[]){
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv??new Array(pos.length/3*2).fill(0),2));
 g.computeVertexNormals();return g;
}
const merge=(gs:THREE.BufferGeometry[])=>{const m=gs.length?mergeGeometries(gs.map(g=>g.index?g.toNonIndexed():g)):geo([]);if(!m)throw new Error('Commerce tower: parts could not be merged');return m;};
/**
 * Curved glass shares its corners: drop the flat normals, weld matching corners into an indexed
 * mesh and shade it smooth. A fraction of the memory of a flat-shaded strip, and rounder.
 */
function smooth(g:THREE.BufferGeometry){g.deleteAttribute('normal');const out=mergeVertices(g,1e-4);if(out!==g)g.dispose();out.computeVertexNormals();return out;}
/** A ledge round an outline: its top and outer face only (the underside is never seen from above). */
function ledge(inner:Pt[],outer:Pt[],y:number,t:number){
 const pos:number[]=[],n=outer.length;
 for(let i=0;i<n;i++){const j=(i+1)%n,up=(p:Pt):Pt3=>[p[0],y+t,p[1]],dn=(p:Pt):Pt3=>[p[0],y,p[1]];
  quad(pos,up(inner[i]),up(outer[i]),up(outer[j]),up(inner[j]));quad(pos,dn(outer[i]),dn(outer[j]),up(outer[j]),up(outer[i]));}
 return geo(pos);
}
const at=(pts:Pt[],y:number|((i:number)=>number)):Pt3[]=>pts.map(([x,z],i)=>[x,typeof y==='number'?y:y(i),z]);

/** Outward unit normals of a closed outline running the map's way round. */
function normals(pts:Pt[]):Pt[]{
 const n=pts.length;
 return pts.map((_,i)=>{const [ax,az]=pts[(i+n-1)%n],[bx,bz]=pts[(i+1)%n],dx=bx-ax,dz=bz-az,l=Math.hypot(dx,dz)||1;return [-dz/l,dx/l];});
}

/** The tower's silver skin. UVs run along the outline in bays and up in floors, for the facade texture. */
function towerSkin(levels:Pt3[][]){
 const pos:number[]=[],uv:number[]=[],n=levels[0].length,bay=.11,floor=COMMERCE.floor;
 const run=[0];for(let i=1;i<=n;i++){const [ax,,az]=levels[0][i-1],[bx,,bz]=levels[0][i%n];run.push(run[i-1]+Math.hypot(bx-ax,bz-az));}
 const U=(i:number)=>run[i]/(bay*4),V=(y:number)=>y/(floor*4);
 for(let l=0;l<levels.length-1;l++)for(let i=0;i<n;i++){
  const j=(i+1)%n,a=levels[l][i],b=levels[l][j],c=levels[l+1][j],d=levels[l+1][i];
  quad(pos,a,b,c,d);uv.push(U(i),V(a[1]),U(i+1),V(b[1]),U(i+1),V(c[1]),U(i),V(a[1]),U(i+1),V(c[1]),U(i),V(d[1]));
 }
 return geo(pos,uv);
}

/**
 * The gold ribbon: a band of warm glass laid just proud of the skin, following its fractional
 * centre up the tower, so it winds in a smooth S.
 */
function goldRibbon(ts:number[],H:number,k:number){
 const w=COMMERCE.ribbon.width,cols=w*2,lift=.008*k,rows:Pt3[][]=[];
 for(const t of ts){
  const plan=planAt(t,k),out=planAt(t,k,.04),c=ribbonCentre(t);
  rows.push(Array.from({length:cols+1},(_,j)=>{const f=c-w/2+j*w/cols,[x,z]=along(plan,f),[ox,oz]=along(out,f),l=Math.hypot(ox-x,oz-z)||1;return [x+(ox-x)/l*lift,Math.min(t*H,H*(1-COMMERCE.slope)),z+(oz-z)/l*lift] as Pt3;}));
 }
 const pos:number[]=[],uv:number[]=[],V=(y:number)=>y/(COMMERCE.floor*4);
 for(let r=0;r<rows.length-1;r++)for(let j=0;j<cols;j++){
  const a=rows[r][j],b=rows[r][j+1],c=rows[r+1][j+1],d=rows[r+1][j];
  quad(pos,a,b,c,d);uv.push(j/4,V(a[1]),(j+1)/4,V(b[1]),(j+1)/4,V(c[1]),j/4,V(a[1]),(j+1)/4,V(c[1]),j/4,V(d[1]));
 }
 return geo(pos,uv);
}

/** Vertical fins out of the tower skin, skipping the gold ribbon, running on above the roof as a screen. */
function towerFins(levels:Pt3[][],windows:Set<number>[],k:number,top:number[]){
 const pos:number[]=[],n=levels[0].length,d=COMMERCE.finDepth*k,norms=levels.map(l=>normals(l.map(([x,,z])=>[x,z])));
 for(let i=0;i<n;i+=COMMERCE.finEvery){
  for(let l=0;l<levels.length-1;l++){
   if(windows[l].has(i)&&windows[l+1].has(i))continue;
   const p=levels[l][i],q=levels[l+1][i],np=norms[l][i],nq=norms[l+1][i];
   const po:Pt3=[p[0]+np[0]*d,p[1],p[2]+np[1]*d],qo:Pt3=[q[0]+nq[0]*d,q[1],q[2]+nq[1]*d];
   quad(pos,p,po,qo,q);
  }
  // The screen: the fin runs on past the glass, tallest at the point.
  const l=levels.length-1,p=levels[l][i],np=norms[l][i],up=top[i];
  const a:Pt3=[p[0],p[1],p[2]],b:Pt3=[p[0]+np[0]*d,p[1],p[2]+np[1]*d],c:Pt3=[b[0],up,b[2]],e:Pt3=[a[0],up,a[2]];
  quad(pos,a,b,c,e);
 }
 // One face per fin; the fin material is double-sided.
 return geo(pos);
}

/** The canopy: a thin sweep following the podium's front, with a fascia strip, lifted at its middle. */
function canopy(k:number){
 const {depth,y}=COMMERCE.canopy,ring=podiumRing(k),ns=normals(ring),n=ring.length,pos:number[]=[],T=.035*k;
 const [i0,i1]=canopySpan(n),rows:{back:Pt3;front:Pt3}[]=[];
 for(let i=i0;i<=i1;i++){
  const f=(i-i0)/(i1-i0),lift=.06*k*Math.sin(Math.PI*f),reach=depth*k*(.55+.45*Math.sin(Math.PI*f));
  const w=((i%n)+n)%n,[x,z]=ring[w],[nx,nz]=ns[w],h=y*k+lift;
  rows.push({back:[x,h,z],front:[x+nx*reach,h+.02*k,z+nz*reach]});
 }
 const dn=(p:Pt3):Pt3=>[p[0],p[1]-T,p[2]];
 for(let r=0;r<rows.length-1;r++){
  const A=rows[r].back,B=rows[r+1].back,C=rows[r+1].front,D=rows[r].front;
  quad(pos,A,D,C,B);quad(pos,dn(A),dn(B),dn(C),dn(D));quad(pos,dn(D),dn(C),C,D);
 }
 return geo(pos);
}

export function commerceGeometry(k=1,height=COMMERCE.height*k){
 const H=height,c=COMMERCE,n=c.ring;
 // Tower levels: evenly up to where the roof's cut begins, then the sloped top.
 const flat=H*(1-c.slope),steps=Math.max(8,Math.ceil(flat/(c.floor*k*2)));
 const ts=Array.from({length:steps+1},(_,i)=>i/steps*(1-c.slope));
 const roof=(i:number)=>H*roofShare(i,n);
 const levels=[...ts.map(t=>at(planAt(t,k),t*H)),at(planAt(1,k),roof)];
 const windows=[...ts,1].map(t=>new Set(ribbonWindow(t,n)));
 const glass=towerSkin(levels),gold=goldRibbon(Array.from({length:steps*2+1},(_,i)=>i/(steps*2)*(1-c.slope)),H,k);
 const finGeo=towerFins(levels,windows,k,levels[levels.length-1].map((p,i)=>p[1]+c.screen*k*roofShare(i,n)**8));
 const roofLid=lid(levels[levels.length-1].map(([x,y,z])=>[x,y-.01*k,z] as Pt3));
 // Thin silver ledges every third floor, round the curtain wall.
 const bands=floorHeights(k,H).filter((_,i)=>i%3===2).map(y=>{const t=y/H;return ledge(planAt(t,k),planAt(t,k,.02),y-.012*k,.024*k);});
 // Podium: lobby of gold glass, two silver floors, white slab edges, ribs, a garden roof with a glass rail.
 const storeys=c.podium.floors.length,ring=podiumRing(k),inner=podiumRing(k,-.03),top=podiumTop(storeys-1,k);
 const lobbyGlass=skin([at(inner,0),at(inner,podiumTop(0,k)-.03*k)]);
 const podiumGlass=merge(Array.from({length:storeys-1},(_,i)=>i+1).map(l=>skin([at(inner,podiumTop(l-1,k)),at(inner,podiumTop(l,k)-.03*k)])));
 const slabs=merge(c.podium.floors.map((_,l)=>slab(ring,podiumTop(l,k),.04*k)));
 const ribs=fins([at(ring,0),at(ring,top)],2,.035*k);
 const railRing=podiumRing(k,-.012),rail=skin([at(railRing,top),at(railRing,top+c.podium.rail*k)]);
 const lawn=lid(at(podiumRing(k,-.04),top+.004*k));
 const pool=poolRing(k),[pcx,pcz]=poolCentre(k),poolRim=annulus(pool,pool.map(([x,z])=>[x+(x-pcx)*.12,z+(z-pcz)*.12] as Pt),top,.02*k);
 return compact({
  glass:smooth(glass),gold:smooth(gold),fins:smooth(finGeo),roof:roofLid,bands:smooth(merge(bands)),
  lobby:smooth(lobbyGlass),podiumGlass:smooth(podiumGlass),slabs:merge([slabs,poolRim]),ribs,rail:smooth(rail),lawn,
  pool:lid(at(pool,top+.016*k)),canopy:canopy(k),
  trees:roofTrees(k),
 });
}
export type CommerceGeometry=ReturnType<typeof commerceGeometry>;
export const commerceTriangles=(g:CommerceGeometry)=>Object.values(g).reduce((n,v)=>n+(v instanceof THREE.BufferGeometry?(v.index?v.index.count:v.getAttribute('position').count)/3:0),0);
