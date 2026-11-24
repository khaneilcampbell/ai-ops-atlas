import * as THREE from 'three';
import {mergeGeometries,mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {Pt} from './roads';
import {compact,fins,lid,skin as skin2} from './atlasHqGeometry';
import type {Pt3} from './atlasHqPlan';
import {annulus,slab} from './ribbonTowerGeometry';
import {COMMERCE,along,commerceFront,canopySpan,floorHeights,planAt,podiumRing,podiumTop,poolCentre,poolRing,ribbonCentre,roofShare,roofTrees,siteBand,siteLawns,frontIndex,PODIUM_RING,valleyInset} from './commerceTowerPlan';

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

/** A box with flat vertex colours, for the lobby's furniture: its top and four sides (the floor hides its underside). */
function box(pos:number[],col:number[],[cx,cy,cz]:Pt3,[sx,sy,sz]:Pt3,color:string){
 const x0=cx-sx/2,x1=cx+sx/2,y0=cy,y1=cy+sy,z0=cz-sz/2,z1=cz+sz/2,n=pos.length;
 const v=(x:number,y:number,z:number):Pt3=>[x,y,z];
 quad(pos,v(x0,y1,z0),v(x0,y1,z1),v(x1,y1,z1),v(x1,y1,z0));
 quad(pos,v(x0,y0,z1),v(x1,y0,z1),v(x1,y1,z1),v(x0,y1,z1));quad(pos,v(x1,y0,z0),v(x0,y0,z0),v(x0,y1,z0),v(x1,y1,z0));
 quad(pos,v(x1,y0,z1),v(x1,y0,z0),v(x1,y1,z0),v(x1,y1,z1));quad(pos,v(x0,y0,z0),v(x0,y0,z1),v(x0,y1,z1),v(x0,y1,z0));
 const c=new THREE.Color(color);for(let i=n;i<pos.length;i+=3)col.push(c.r,c.g,c.b);
}
/** A closed outline's floor (fan from its centre, facing up) and its wall, in flat vertex colours. */
function colourFloor(pos:number[],col:number[],ring:Pt[],y:number,color:string){
 const n=pos.length,cx=ring.reduce((a,p)=>a+p[0],0)/ring.length,cz=ring.reduce((a,p)=>a+p[1],0)/ring.length;
 for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];pos.push(cx,y,cz,a[0],y,a[1],b[0],y,b[1]);}
 const c=new THREE.Color(color);for(let i=n;i<pos.length;i+=3)col.push(c.r,c.g,c.b);
}
function colourWall(pos:number[],col:number[],ring:Pt[],y0:number,y1:number,color:string){
 const n=pos.length;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];quad(pos,[a[0],y0,a[1]],[b[0],y0,b[1]],[b[0],y1,b[1]],[a[0],y1,a[1]]);}
 const c=new THREE.Color(color);for(let i=n;i<pos.length;i+=3)col.push(c.r,c.g,c.b);
}

/**
 * The lobby behind the clear glass (realism pass, 2026-11-24): a pale stone floor, the tower's
 * core carried down to the ground as a warm stone wall, a long reception desk facing the doors,
 * and bronze frames round the doors. One mesh in vertex colours.
 */
function lobbyInterior(k:number){
 const c=COMMERCE,L=c.lobby,pos:number[]=[],col:number[]=[],top=podiumTop(0,k)-.03*k;
 colourFloor(pos,col,podiumRing(k,-.035),.004*k,'#d9d3c6');
 colourWall(pos,col,planAt(0,k,L.core),0,top,'#b79a74');
 const f=commerceFront(k),[dw,dh,dd]=L.desk;
 box(pos,col,[f.x,0,f.wall-L.deskBack*k],[dw*k,dh*k,dd*k],'#3c3a36');
 box(pos,col,[f.x,dh*k,f.wall-L.deskBack*k],[dw*k*1.02,.008*k,dd*k*1.1],'#e9e4da');
 // The feature wall behind the desk: a lit gold panel on the core's front.
 box(pos,col,[f.x,.06*k,f.wall-(L.deskBack+.14)*k],[dw*k*1.5,top*.72,.012*k],'#c89a52');
 // The entrance matches the tower (Khaneil, 2026-11-24): two gold-clad fins the full lobby height
 // frame the sliding doors (EntranceDoors, set flush), with a gold glass transom above them and a
 // stone threshold, echoing the gold valley between the blades above.
 const w=.66*k,h=.38*k,fin=.05*k,deep=.16*k,z=f.wall;
 for(const side of [-1,1])box(pos,col,[f.x+side*(w/2+fin/2),0,z-deep*.35],[fin,top,deep],'#c99a4f');
 box(pos,col,[f.x,h,z-.01*k],[w,.022*k,.04*k],'#8a6430');
 box(pos,col,[f.x,h+.022*k,z-.012*k],[w,top-h-.04*k,.01*k],'#d9b06a');
 box(pos,col,[f.x,0,z+.08*k],[w+fin*2.4,.006*k,.2*k],'#cfc8bb');
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.computeVertexNormals();return g;
}
/** Slim white columns standing just inside the lobby glass. */
function lobbyColumns(k:number){
 const L=COMMERCE.lobby,ring=podiumRing(k,-L.columnInset),top=podiumTop(0,k),out:THREE.BufferGeometry[]=[];
 const front=commerceFront(k);
 ring.forEach(([x,z],i)=>{if(i%L.columnEvery||Math.abs(x-front.x)<.5*k&&z>front.wall-.3*k)return;const g=new THREE.CylinderGeometry(L.column*k,L.column*k,top,8,1,true);g.translate(x,top/2,z);out.push(g);});
 return merge(out);
}
/** The lobby's soffit: the underside of the first floor, facing down, lit warm at night with the canopy. */
function soffit(k:number){
 const ring=podiumRing(k,-.035),y=podiumTop(0,k)-COMMERCE.lobby.soffit*k,cx=ring.reduce((a,p)=>a+p[0],0)/ring.length,cz=ring.reduce((a,p)=>a+p[1],0)/ring.length,pos:number[]=[];
 for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];pos.push(cx,y,cz,b[0],y,b[1],a[0],y,a[1]);}
 return geo(pos);
}

/**
 * The grounds on the plinth (2026-11-24, after the reference site plan): a stone forecourt round
 * the podium with a darker kerb, an asphalt drop-off lane with white edge lines past the entrance,
 * two striped car-park ramps on the long side, and lawns in the plinth's corners. One flat mesh
 * in vertex colours, a hair above the plinth.
 */
function siteGround(k:number){
 const S=COMMERCE.site,pos:number[]=[],col:number[]=[],y=.003,n=PODIUM_RING,f=frontIndex();
 const band=(a:number,b:number,yy:number,from:number,to:number,colour:(i:number)=>string)=>{
  const [inner,outer]=siteBand(a,b);
  for(let s=from;s<to;s++){const i=((s%n)+n)%n,j=(i+1)%n,c=new THREE.Color(colour(s-from)),m=pos.length;
   quad(pos,[inner[i][0]*k,yy,inner[i][1]*k],[outer[i][0]*k,yy,outer[i][1]*k],[outer[j][0]*k,yy,outer[j][1]*k],[inner[j][0]*k,yy,inner[j][1]*k]);
   for(let v=m;v<pos.length;v+=3)col.push(c.r,c.g,c.b);}
 };
 const F=S.forecourt,L=S.lane,h=Math.round(S.laneSpan/2);
 band(0,F,y,0,n,()=>'#dde1dc');
 band(F-.012,F,y*1.4,0,n,()=>'#d9d5c9');
 // The drop-off lane past the entrance, with white lines along both edges.
 band(F,F+L,y,f-h,f+h,()=>'#424b50');
 band(F+.008,F+.018,y*1.6,f-h,f+h,()=>'#f7f2df');
 band(F+L-.018,F+L-.008,y*1.6,f-h,f+h,()=>'#f7f2df');
 // A zebra crossing over the lane to the entrance doors, like the city's junction crossings.
 band(F,F+L,y*1.8,f-2,f+2,i=>i%2?'#424b50':'#f7f2df');
 // Car-park ramps down the long side, striped like the plan's hatching.
 const [r0,len]=S.ramp;
 for(const start of [f+r0,f-r0-len])band(F,F+L*.8,y,start,start+len,i=>i%2?'#efe3bf':'#d4b45e');
 for(const l of siteLawns(k)){const m=pos.length,hs=l.s/2;
  quad(pos,[l.x-hs,y,l.z-hs],[l.x-hs,y,l.z+hs],[l.x+hs,y,l.z+hs],[l.x+hs,y,l.z-hs]);
  const c=new THREE.Color(l.tree?'#7f9f62':'#8aa96c');for(let v=m;v<pos.length;v+=3)col.push(c.r,c.g,c.b);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.computeVertexNormals();return g;
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
 // Lobby mullions: a slim fin every other podium point, only up the lobby's glass.
 const lobbyFins=fins([at(ring,0),at(ring,podiumTop(0,k))],1,.02*k);
 const podiumGlass=merge(Array.from({length:storeys-1},(_,i)=>i+1).map(l=>skin2([at(inner,podiumTop(l-1,k)),at(inner,podiumTop(l,k)-.03*k)])));
 const slabs=merge(c.podium.floors.map((_,l)=>slab(ring,podiumTop(l,k),.04*k)));
 const ribs=merge([fins([at(ring,podiumTop(0,k)),at(ring,ptop)],2,.035*k),lobbyFins]);
 const railRing=podiumRing(k,-.012),rail=skin2([at(railRing,ptop),at(railRing,ptop+c.podium.rail*k)]);
 const lawn=lid(at(podiumRing(k,-.04),ptop+.004*k));
 const pool=poolRing(k),[pcx,pcz]=poolCentre(k),poolRim=annulus(pool,pool.map(([x,z])=>[x+(x-pcx)*.12,z+(z-pcz)*.12] as Pt),ptop,.02*k);
 return compact({
  glass:smooth(glass),gold:smooth(gold),fins:smooth(finGeo),roof:roofLid,bands:smooth(merge(bands)),
  lobby:smooth(lobbyGlass),podiumGlass:smooth(podiumGlass),slabs:merge([slabs,poolRim,lobbyColumns(k)]),interior:lobbyInterior(k),ribs,rail:smooth(rail),lawn,
  pool:lid(at(pool,ptop+.016*k)),canopy:merge([canopy(k),soffit(k)]),
  site:siteGround(k),
  trees:roofTrees(k),siteTrees:siteLawns(k).filter(l=>l.tree),
 });
}
export type CommerceGeometry=ReturnType<typeof commerceGeometry>;
export const commerceTriangles=(g:CommerceGeometry)=>Object.values(g).reduce((n,v)=>n+(v instanceof THREE.BufferGeometry?(v.index?v.index.count:v.getAttribute('position').count)/3:0),0);
