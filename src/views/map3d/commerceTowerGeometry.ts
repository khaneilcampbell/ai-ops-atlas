import * as THREE from 'three';
import {mergeGeometries,mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {Pt} from './roads';
import {compact,fins,lid,skin as skin2} from './atlasHqGeometry';
import type {Pt3} from './atlasHqPlan';
import {annulus,slab} from './ribbonTowerGeometry';
import {COMMERCE,along,canopySpan,floorHeights,planAt,podiumRing,podiumTop,poolCentre,poolRing,ribbonCentre,roofShare,roofTrees,valleyInset} from './commerceTowerPlan';

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
const at=(pts:Pt[],y:number|((i:number)=>number)):Pt3[]=>pts.map(([x,z],i)=>[x,typeof y==='number'?y:y(i),z]);

/** Outward unit normals of a closed outline running the map's way round. */
function normals(pts:Pt[]):Pt[]{
 const n=pts.length;
 return pts.map((_,i)=>{const [ax,az]=pts[(i+n-1)%n],[bx,bz]=pts[(i+1)%n],dx=bx-ax,dz=bz-az,l=Math.hypot(dx,dz)||1;return [-dz/l,dx/l];});
}

/** A tower level: its height share t and the height of each outline position f along it. */
type Level={t:number;y:(f:number)=>number};
/** Skin samples per level, lip to lip the long way round; columns across the gold valley. */
const SKIN=84,VALLEY=14;
const unit=([x,z]:Pt):Pt=>{const l=Math.hypot(x,z)||1;return [x/l,z/l];};

/**
 * The tower's rows, level by level: the silver skin from one lip of the gold valley round the
 * back to the other, and the valley itself, cut in as a round scoop between the two blades. The
 * valley follows the ribbon's fractional centre, so its lips run up the tower as smooth S curves.
 * Both share their lip points, so the tower stays closed.
 */
function towerRows(levels:Level[],k:number){
 const c=COMMERCE,n=c.ring,h=c.ribbon.width/2,skin:Pt3[][]=[],valley:Pt3[][]=[],skinF:number[][]=[],lips:{p:Pt3;out:Pt}[][]=[];
 for(const {t,y} of levels){
  const plan=planAt(t,k),ns=normals(plan),mid=ribbonCentre(t,n);
  const fs=Array.from({length:SKIN+1},(_,j)=>mid+h+j*(n-2*h)/SKIN);
  skinF.push(fs);skin.push(fs.map(f=>{const [x,z]=along(plan,f);return [x,y(f),z] as Pt3;}));
  valley.push(Array.from({length:VALLEY+1},(_,j)=>{
   const x=-1+2*j/VALLEY,f=mid+x*h,[px,pz]=along(plan,f),[nx,nz]=unit(along(ns,f)),d=valleyInset(x)*k;
   return [px-nx*d,y(f),pz-nz*d] as Pt3;
  }));
  lips.push([mid-h,mid+h].map(f=>{const [x,z]=along(plan,f);return {p:[x,y(f),z] as Pt3,out:unit(along(ns,f))};}));
 }
 return {skin,valley,skinF,lips};
}

/** Quads between consecutive rows of points, with optional UVs per point. */
function strip(rows:Pt3[][],uvAt?:(r:number,j:number)=>[number,number]){
 const pos:number[]=[],uv:number[]=[];
 for(let r=0;r<rows.length-1;r++)for(let j=0;j<rows[r].length-1;j++){
  quad(pos,rows[r][j],rows[r][j+1],rows[r+1][j+1],rows[r+1][j]);
  if(uvAt){const a=uvAt(r,j),b=uvAt(r,j+1),cc=uvAt(r+1,j+1),d=uvAt(r+1,j);uv.push(...a,...b,...cc,...a,...cc,...d);}
 }
 return geo(pos,uvAt?uv:undefined);
}

/**
 * Vertical fins out of the blades' skin, clear of the gold valley, running on above the roof
 * as a screen, tallest at the point.
 */
function towerFins(levels:Level[],k:number,top:(i:number)=>number){
 const c=COMMERCE,n=c.ring,h=c.ribbon.width/2+.6,d=c.finDepth*k,pos:number[]=[];
 const rows=levels.map(({t,y})=>{const plan=planAt(t,k);return {plan,ns:normals(plan),mid:ribbonCentre(t,n),y};});
 const inValley=(i:number,mid:number)=>Math.abs((((i-mid)%n)+n*1.5)%n-n/2)<h;
 for(let i=0;i<n;i+=c.finEvery){
  for(let l=0;l<rows.length-1;l++){
   const A=rows[l],B=rows[l+1];if(inValley(i,A.mid)||inValley(i,B.mid))continue;
   const p:Pt3=[A.plan[i][0],A.y(i),A.plan[i][1]],q:Pt3=[B.plan[i][0],B.y(i),B.plan[i][1]];
   quad(pos,p,[p[0]+A.ns[i][0]*d,p[1],p[2]+A.ns[i][1]*d],[q[0]+B.ns[i][0]*d,q[1],q[2]+B.ns[i][1]*d],q);
  }
  const T=rows[rows.length-1];if(inValley(i,T.mid))continue;
  const p:Pt3=[T.plan[i][0],T.y(i),T.plan[i][1]],o:Pt3=[p[0]+T.ns[i][0]*d,p[1],p[2]+T.ns[i][1]*d];
  quad(pos,p,o,[o[0],top(i),o[2]],[p[0],top(i),p[2]]);
 }
 // One face per fin; the fin material is double-sided.
 return geo(pos);
}

/** The white lip trims: two thin blades standing out along the valley's edges, the S curves that frame the gold. */
function lipTrims(lips:{p:Pt3;out:Pt}[][],k:number){
 const pos:number[]=[],d=COMMERCE.ribbon.lip*k;
 for(let s=0;s<2;s++)for(let l=0;l<lips.length-1;l++){
  const a=lips[l][s],b=lips[l+1][s];
  quad(pos,a.p,[a.p[0]+a.out[0]*d,a.p[1],a.p[2]+a.out[1]*d],[b.p[0]+b.out[0]*d,b.p[1],b.p[2]+b.out[1]*d],b.p);
 }
 return geo(pos);
}

/** A ledge along an open run of outline points (the blades' skin), top and outer face. */
function openLedge(row:Pt3[],k:number,y:number,t:number){
 const pos:number[]=[],out=.022*k;
 const ns=row.map((_,i)=>{const a=row[Math.max(0,i-1)],b=row[Math.min(row.length-1,i+1)];return unit([-(b[2]-a[2]),b[0]-a[0]]);});
 for(let i=0;i<row.length-1;i++){
  const A:Pt=[row[i][0],row[i][2]],B:Pt=[row[i+1][0],row[i+1][2]];
  const Ao:Pt=[A[0]+ns[i][0]*out,A[1]+ns[i][1]*out],Bo:Pt=[B[0]+ns[i+1][0]*out,B[1]+ns[i+1][1]*out];
  quad(pos,[A[0],y+t,A[1]],[Ao[0],y+t,Ao[1]],[Bo[0],y+t,Bo[1]],[B[0],y+t,B[1]]);
  quad(pos,[Ao[0],y,Ao[1]],[Bo[0],y,Bo[1]],[Bo[0],y+t,Bo[1]],[Ao[0],y+t,Ao[1]]);
 }
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
 // Tower levels: a level every two floors up to where the roof's cut begins, then the sloped top.
 const flat=H*(1-c.slope),steps=Math.max(12,Math.ceil(flat/(c.floor*k*2)));
 const levels:Level[]=[...Array.from({length:steps+1},(_,i)=>{const t=i/steps*(1-c.slope);return {t,y:()=>t*H};}),{t:1,y:(f:number)=>H*roofShare(f,n)}];
 const {skin,valley,skinF,lips}=towerRows(levels,k);
 // Skin UVs are pinned to the outline (not to the moving valley), in bays along and floors up, so the facade does not slide.
 const perim=planAt(0,k).reduce((s,p,i,a)=>s+Math.hypot(a[(i+1)%n][0]-p[0],a[(i+1)%n][1]-p[1]),0),bay=.11*k;
 const glass=strip(skin,(r,j)=>[skinF[r][j]*perim/n/(bay*4),skin[r][j][1]/(c.floor*k*4)]);
 const gold=strip(valley,(r,j)=>[j/4,valley[r][j][1]/(c.floor*k*4)]);
 const finGeo=merge([towerFins(levels,k,i=>H*roofShare(i,n)+c.screen*k*roofShare(i,n)**8),lipTrims(lips,k)]);
 const top=skin.length-1,roofLid=lid([...skin[top].slice(0,SKIN),...valley[top].slice(0,VALLEY)].map(([x,y,z])=>[x,y-.01*k,z] as Pt3));
 // Thin silver ledges every third floor round the blades (not across the gold).
 const bandAt=floorHeights(k,H).filter((_,i)=>i%3===2);
 const bands=bandAt.map(y=>{const t=y/H/(1-c.slope),r=Math.min(steps-1,Math.floor(t*steps)),u=t*steps-r;
  const row=skin[r].map((p,j)=>{const q=skin[r+1][j];return [p[0]+(q[0]-p[0])*u,y,p[2]+(q[2]-p[2])*u] as Pt3;});
  // Every other sample is plenty for a thin ledge, and halves its memory.
  return openLedge(row.filter((_,j)=>j%2===0||j===row.length-1),k,y-.012*k,.024*k);});
 // Podium: lobby of gold glass, silver floors, white slab edges, ribs, a garden roof with a glass rail.
 const storeys=c.podium.floors.length,ring=podiumRing(k),inner=podiumRing(k,-.03),ptop=podiumTop(storeys-1,k);
 const lobbyGlass=skin2([at(inner,0),at(inner,podiumTop(0,k)-.03*k)]);
 const podiumGlass=merge(Array.from({length:storeys-1},(_,i)=>i+1).map(l=>skin2([at(inner,podiumTop(l-1,k)),at(inner,podiumTop(l,k)-.03*k)])));
 const slabs=merge(c.podium.floors.map((_,l)=>slab(ring,podiumTop(l,k),.04*k)));
 const ribs=fins([at(ring,0),at(ring,ptop)],2,.035*k);
 const railRing=podiumRing(k,-.012),rail=skin2([at(railRing,ptop),at(railRing,ptop+c.podium.rail*k)]);
 const lawn=lid(at(podiumRing(k,-.04),ptop+.004*k));
 const pool=poolRing(k),[pcx,pcz]=poolCentre(k),poolRim=annulus(pool,pool.map(([x,z])=>[x+(x-pcx)*.12,z+(z-pcz)*.12] as Pt),ptop,.02*k);
 return compact({
  glass:smooth(glass),gold:smooth(gold),fins:smooth(finGeo),roof:roofLid,bands:smooth(merge(bands)),
  lobby:smooth(lobbyGlass),podiumGlass:smooth(podiumGlass),slabs:merge([slabs,poolRim]),ribs,rail:smooth(rail),lawn,
  pool:lid(at(pool,ptop+.016*k)),canopy:canopy(k),
  trees:roofTrees(k),
 });
}
export type CommerceGeometry=ReturnType<typeof commerceGeometry>;
export const commerceTriangles=(g:CommerceGeometry)=>Object.values(g).reduce((n,v)=>n+(v instanceof THREE.BufferGeometry?(v.index?v.index.count:v.getAttribute('position').count)/3:0),0);
