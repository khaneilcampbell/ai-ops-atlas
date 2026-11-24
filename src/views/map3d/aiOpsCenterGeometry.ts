import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {compactGeometry} from './atlasHqGeometry';
import type {Pt3} from './atlasHqPlan';
import type {Pt} from './roads';
import {slab} from './ribbonTowerGeometry';
import {AIOPS,PODIUM_H,crownAt,podiumRing,podiumTop,ribbonSpan,towerNormal,towerPhi,towerPoint,towerRing} from './aiOpsCenterPlan';

/** Atlas AI Operations Center geometry: a handful of merged meshes, built once. See aiOpsCenterPlan. */

const quad=(o:number[],a:Pt3,b:Pt3,c:Pt3,d:Pt3)=>o.push(...a,...b,...c,...a,...c,...d);
/** Flat-shaded triangles, then welded and indexed; untextured parts carry no UVs (map geometry budget). */
function mesh(pos:number[],uv?:number[]){
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 if(uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 g.computeVertexNormals();return compactGeometry(g);
}
const merge=(gs:THREE.BufferGeometry[])=>{const m=gs.length?mergeGeometries(gs.map(g=>g.index?g.toNonIndexed():g)):mesh([],[]);if(!m)throw new Error('AI Operations Center: parts could not be merged');return compactGeometry(m);};

/**
 * A wall through closed outlines (same point count, counter-clockwise from above). UVs run one
 * texture tile per four bays across and four floors up, so the glass texture lines up with the floors.
 */
export function wall(levels:Pt3[][],bay:number,floor:number){
 const pos:number[]=[],uv:number[]=[],n=levels[0].length;
 const run=[0];for(let i=1;i<=n;i++){const [ax,,az]=levels[0][i-1],[bx,,bz]=levels[0][i%n];run.push(run[i-1]+Math.hypot(bx-ax,bz-az));}
 const U=(i:number)=>run[i]/(bay*4),V=(y:number)=>y/(floor*4);
 for(let l=0;l<levels.length-1;l++)for(let i=0;i<n;i++){
  const j=(i+1)%n,a=levels[l][i],b=levels[l][j],c=levels[l+1][j],d=levels[l+1][i];
  quad(pos,a,b,c,d);uv.push(U(i),V(a[1]),U(i+1),V(b[1]),U(i+1),V(c[1]),U(i),V(a[1]),U(i+1),V(c[1]),U(i),V(d[1]));
 }
 return mesh(pos,uv);
}
/** A flat band between an inner and an outer outline at height y, thick t, with its outer edge. */
function band(inner:Pt[],outer:Pt[],y:number,t:number,pos:number[]){
 const n=outer.length;
 for(let i=0;i<n;i++){
  const j=(i+1)%n,up=(p:Pt):Pt3=>[p[0],y+t,p[1]],dn=(p:Pt):Pt3=>[p[0],y,p[1]];
  quad(pos,up(inner[i]),up(outer[i]),up(outer[j]),up(inner[j]));
  quad(pos,dn(inner[i]),dn(inner[j]),dn(outer[j]),dn(outer[i]));
  quad(pos,dn(outer[i]),dn(outer[j]),up(outer[j]),up(outer[i]));
 }
}
const at=(pts:Pt[],y:number):Pt3[]=>pts.map(([x,z])=>[x,y,z]);
const scaleAbout=(pts:Pt[],k:number):Pt[]=>{const cx=pts.reduce((s,p)=>s+p[0],0)/pts.length,cz=pts.reduce((s,p)=>s+p[1],0)/pts.length;return pts.map(([x,z])=>[cx+(x-cx)*k,cz+(z-cz)*k]);};
/** A fan over an outline whose points may sit at different heights (the sloped crown). */
function fan(pts:Pt3[],pos:number[]){const n=pts.length,c:Pt3=[0,0,0];for(const p of pts){c[0]+=p[0]/n;c[1]+=p[1]/n;c[2]+=p[2]/n;}for(let i=0;i<n;i++)pos.push(...c,...pts[i],...pts[(i+1)%n]);}

export function aiOpsGeometry(height:number){
 const T=AIOPS.tower,n=T.ring,P=AIOPS.palette;void P;
 // Tower levels: one per floor from just under the podium roof to just under the crown, then the crown itself.
 const ys:number[]=[];for(let y=Math.floor((PODIUM_H-.1)/T.floor)*T.floor;y<height-AIOPS.crownSlope-.15;y+=T.floor)ys.push(y);
 const crown=Array.from({length:n},(_,i)=>{const phi=towerPhi(i);const y=crownAt(phi,height);const [x,z]=towerPoint(phi,y,height);return [x,y,z] as Pt3;});
 const levels=[...ys.map(y=>at(towerRing(y,height),y)),crown];
 const glass=wall(levels,T.floor,T.floor);
 // Mullion fins every other ring point (one face, drawn double-sided) and a floor ledge every second floor.
 const fin:number[]=[];
 for(let i=0;i<n;i+=2){const nrm=towerNormal(towerPhi(i)),d=.035;for(let l=0;l<levels.length-1;l++){const p=levels[l][i],q=levels[l+1][i];if(q[1]<PODIUM_H)continue;const po:Pt3=[p[0]+nrm[0]*d,p[1],p[2]+nrm[1]*d],qo:Pt3=[q[0]+nrm[0]*d,q[1],q[2]+nrm[1]*d];quad(fin,p,po,qo,q);}}
 const ledges:number[]=[];
 for(const y of ys.filter((y,k)=>k%2===0&&y>PODIUM_H+.3))band(towerRing(y,height),towerRing(y,height,1.022),y,.03,ledges);
 // Crown: a white rim standing proud of the glass, a pale roof inside it, and plant room boxes.
 const rim:number[]=[],roof:number[]=[];
 const rimOut=crown.map(([,y],i)=>{const phi=towerPhi(i),[x,z]=towerPoint(phi,y,height,1.03);return {x,z,y};});
 const rimIn=crown.map(([,y],i)=>{const phi=towerPhi(i),[x,z]=towerPoint(phi,y,height,.985);return {x,z,y};});
 for(let i=0;i<n;i++){const j=(i+1)%n,o=rimOut,u=rimIn,lo=-.22,hi=.12;
  quad(rim,[o[i].x,o[i].y+lo,o[i].z],[o[j].x,o[j].y+lo,o[j].z],[o[j].x,o[j].y+hi,o[j].z],[o[i].x,o[i].y+hi,o[i].z]);
  quad(rim,[u[i].x,u[i].y+hi,u[i].z],[o[i].x,o[i].y+hi,o[i].z],[o[j].x,o[j].y+hi,o[j].z],[u[j].x,u[j].y+hi,u[j].z]);
  quad(rim,[u[j].x,u[j].y+.02,u[j].z],[u[j].x,u[j].y+hi,u[j].z],[u[i].x,u[i].y+hi,u[i].z],[u[i].x,u[i].y+.02,u[i].z]);}
 fan(rimIn.map(p=>[p.x,p.y+.02,p.z] as Pt3),roof);
 // Bronze ribbon: a continuous backing band with edge fascias, and a louvre every half floor proud of it.
 const back:number[]=[],louvres:number[]=[],S=AIOPS.ribbon.samples,R=AIOPS.ribbon;
 const rows:{y:number;span:NonNullable<ReturnType<typeof ribbonSpan>>}[]=[];
 for(let y=PODIUM_H+AIOPS.step.rise;y<height+AIOPS.crownSlope;y+=R.gap){const span=ribbonSpan(y,height);if(span)rows.push({y,span});}
 // Cut each row at the crown so the ribbon ends cleanly under the rim.
 const top=(phi:number)=>crownAt(phi,height)-.2;
 const across=(r:typeof rows[number],s:number)=>Array.from({length:S+1},(_,k)=>r.span.from+(r.span.to-r.span.from)*k/S).map(phi=>({phi,p:towerPoint(phi,r.y,height,s)}));
 for(let k=0;k<rows.length-1;k++){
  const a=across(rows[k],R.back),b=across(rows[k+1],R.back);
  for(let i=0;i<S;i++){if(rows[k+1].y>Math.min(top(a[i].phi),top(a[i+1].phi)))continue;
   // Counter-clockwise rings run with decreasing phi, so walk the span from `to` back to `from`.
   const A=a[S-i],B=a[S-i-1],C=b[S-i-1],D=b[S-i];quad(back,[A.p[0],rows[k].y,A.p[1]],[B.p[0],rows[k].y,B.p[1]],[C.p[0],rows[k+1].y,C.p[1]],[D.p[0],rows[k+1].y,D.p[1]]);}
  // Edge fascias: from the glass out past the louvres on both sides.
  for(const side of [0,S]){const ia=across(rows[k],1)[side],oa=across(rows[k],1+R.depth/1.6)[side],ib=across(rows[k+1],1)[side],ob=across(rows[k+1],1+R.depth/1.6)[side];if(rows[k+1].y>top(ia.phi))continue;
   const y0=rows[k].y,y1=rows[k+1].y;quad(back,[ia.p[0],y0,ia.p[1]],[oa.p[0],y0,oa.p[1]],[ob.p[0],y1,ob.p[1]],[ib.p[0],y1,ib.p[1]]);quad(back,[oa.p[0],y0,oa.p[1]],[ia.p[0],y0,ia.p[1]],[ib.p[0],y1,ib.p[1]],[ob.p[0],y1,ob.p[1]]);}
 }
 for(const r of rows){const inner=across(r,R.back),outer=across(r,1+R.depth/1.6);if(r.y>top(r.span.mid))continue;
  for(let i=0;i<S;i++){const a=inner[S-i],b=inner[S-i-1],c=outer[S-i-1],d=outer[S-i],y=r.y,t=R.thick;
   quad(louvres,[a.p[0],y+t,a.p[1]],[d.p[0],y+t,d.p[1]],[c.p[0],y+t,c.p[1]],[b.p[0],y+t,b.p[1]]);
   quad(louvres,[a.p[0],y,a.p[1]],[b.p[0],y,b.p[1]],[c.p[0],y,c.p[1]],[d.p[0],y,d.p[1]]);
   quad(louvres,[d.p[0],y,d.p[1]],[c.p[0],y,c.p[1]],[c.p[0],y+t,c.p[1]],[d.p[0],y+t,d.p[1]]);}}
 // Podium: three glazed storeys between white slab edges, the top one pulled in; planters on the step.
 const L=AIOPS.podium.floors.length,slabs:THREE.BufferGeometry[]=[],lobbyGlass:THREE.BufferGeometry[]=[],podGlass:THREE.BufferGeometry[]=[],planters:number[]=[];
 for(let l=0;l<L;l++){
  const ring=podiumRing(l),y0=l?podiumTop(l-1):0,y1=podiumTop(l);
  slabs.push(slab(ring,y1,AIOPS.podium.slab));
  const g=wall([at(scaleAbout(ring,.975),y0),at(scaleAbout(ring,.975),y1-AIOPS.podium.slab)],T.floor*.8,(y1-y0)/4);
  (l===0?lobbyGlass:podGlass).push(g);
 }
 band(scaleAbout(podiumRing(1),.93),scaleAbout(podiumRing(1),.995),podiumTop(1),.06,planters);
 band(scaleAbout(podiumRing(2),.9),scaleAbout(podiumRing(2),.99),PODIUM_H,.05,planters);
 // Terrace lawn on the podium roof, and the planted step that rises round the tower's foot.
 const lawn:number[]=[];fan(at(scaleAbout(podiumRing(2),.92),PODIUM_H+.012),lawn);
 const stepOuter=towerRing(PODIUM_H,height,AIOPS.step.scale);
 slabs.push(slab(stepOuter,PODIUM_H+AIOPS.step.rise,AIOPS.step.rise));
 fan(at(towerRing(PODIUM_H,height,AIOPS.step.scale*.97),PODIUM_H+AIOPS.step.rise+.012),lawn);
 // Atrium drum: a glass cylinder over the entrance, a white crown ring, a lit oculus and a bronze canopy.
 const A=AIOPS.atrium,drumH=PODIUM_H+A.above;
 const drum=new THREE.CylinderGeometry(A.r,A.r,drumH,A.ring,4,true).translate(A.x,drumH/2,A.z);
 const crownRing=new THREE.CylinderGeometry(A.r+.06,A.r+.06,.12,A.ring,1,false).translate(A.x,drumH+.04,A.z);
 const sky=new THREE.CylinderGeometry(A.r*.62,A.r*.62,.03,A.ring).translate(A.x,drumH+.1,A.z);
 const canopy=new THREE.CylinderGeometry(A.r+.55,A.r+.55,.05,A.ring,1,false,0,Math.PI).rotateY(-Math.PI/2).translate(A.x,.62,A.z);
 const halo=new THREE.TorusGeometry(A.r*.6,.035,6,A.ring).rotateX(Math.PI/2).translate(A.x,podiumTop(0)+.25,A.z);
 // Drum mullions: thin posts round the glass.
 const posts:THREE.BufferGeometry[]=[];for(let i=0;i<16;i++){const t=i/16*Math.PI*2;posts.push(new THREE.BoxGeometry(.03,drumH,.03).translate(A.x+Math.cos(t)*(A.r+.012),drumH/2,A.z+Math.sin(t)*(A.r+.012)));}
 return {
  glass,fins:mesh(fin),ledges:mesh(ledges),rim:mesh(rim),roof:mesh(roof),
  ribbonBack:mesh(back),ribbonLouvres:mesh(louvres),
  slabs:merge([...slabs,crownRing]),lobbyGlass:merge(lobbyGlass),podiumGlass:merge(podGlass),planters:mesh(planters),lawn:mesh(lawn),
  drum,drumPosts:merge(posts),sky,canopy,halo,
 };
}
export type AiOpsGeometry=ReturnType<typeof aiOpsGeometry>;
export const aiOpsTriangles=(g:AiOpsGeometry)=>Object.values(g).reduce((s,v)=>s+(v instanceof THREE.BufferGeometry?(v.index?v.index.count:v.getAttribute('position').count)/3:0),0);
