import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {Pt} from './roads';
import {lid,skin} from './atlasHqGeometry';
import type {Pt3} from './atlasHqPlan';
import {RIBBON,podiumDetails,podiumRing,ribbonHeights,ringsAt} from './ribbonTowerPlan';

/** Benjaire HQ geometry: a few merged meshes, built once. See ribbonTowerPlan for the design. */

const at=(pts:Pt[],y:number):Pt3[]=>pts.map(([x,z])=>[x,y,z]);
const quad=(o:number[],a:Pt3,b:Pt3,c:Pt3,d:Pt3)=>o.push(...a,...b,...c,...a,...c,...d);
function geo(pos:number[]){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Array(pos.length/3*2).fill(0),2));g.computeVertexNormals();return g;}
const merge=(gs:THREE.BufferGeometry[])=>{const m=gs.length?mergeGeometries(gs):geo([]);if(!m)throw new Error("Benjaire HQ: parts could not be merged");return m;};

/** A horizontal ring band between an inner and outer outline (same point count), thick t. */
export function annulus(inner:Pt[],outer:Pt[],y:number,t:number){
 const pos:number[]=[],n=outer.length;
 for(let i=0;i<n;i++){
  const j=(i+1)%n,oi=outer[i],oj=outer[j],ii=inner[i],ij=inner[j];
  const up=(p:Pt):Pt3=>[p[0],y+t,p[1]],dn=(p:Pt):Pt3=>[p[0],y,p[1]];
  quad(pos,up(ii),up(oi),up(oj),up(ij));
  quad(pos,dn(ii),dn(ij),dn(oj),dn(oi));
  quad(pos,dn(oi),dn(oj),up(oj),up(oi));
 }
 return geo(pos);
}
/** A solid slab over an outline, top at y. */
export function slab(pts:Pt[],y:number,depth:number){
 const s=new THREE.Shape();s.moveTo(pts[0][0],-pts[0][1]);for(const [x,z] of pts.slice(1))s.lineTo(x,-z);s.closePath();
 const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);g.translate(0,y-depth,0);g.deleteAttribute('uv');
 g.setAttribute('uv',new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count*2).fill(0),2));
 return g;
}
const toward=(pts:Pt[],k:number):Pt[]=>{const cx=pts.reduce((s,p)=>s+p[0],0)/pts.length,cz=pts.reduce((s,p)=>s+p[1],0)/pts.length;return pts.map(([x,z])=>[cx+(x-cx)*k,cz+(z-cz)*k]);};

export function ribbonGeometry(k=1){
 const H=RIBBON.height*k,step=RIBBON.ribbonGap*k,{from,to}=RIBBON.portal,gi=RIBBON.glassInset;
 const samples=(t0:number,t1:number)=>{const n=Math.max(2,Math.ceil((t1-t0)*H/step));return Array.from({length:n+1},(_,i)=>t0+(t1-t0)*i/n);};
 // Dark glass: the body below and above the opening, and two legs through it.
 const body=(t0:number,t1:number)=>skin(samples(t0,t1).map(t=>at(ringsAt(t,k,gi)[0],t*H)));
 const leg=(side:number)=>skin(samples(from,to).map(t=>at(ringsAt(t,k,gi,true)[side],t*H)));
 const glass=merge([body(0,from),leg(0),leg(1),body(to,1)]);
 // Ribbons: even and odd sets, so the lightest quality can keep only every other one.
 const even:THREE.BufferGeometry[]=[],odd:THREE.BufferGeometry[]=[];
 ribbonHeights(k).forEach((y,i)=>{
  const t=y/H;if(t>=1)return;
  const inner=ringsAt(t,k,gi),outer=ringsAt(t,k,1+RIBBON.ribbonDepth/RIBBON.half);
  inner.forEach((r,j)=>(i%2?odd:even).push(annulus(r,outer[j],y-RIBBON.ribbonThick*k/2,RIBBON.ribbonThick*k)));
 });
 // Crown: a thick lip round a hollow oculus, its inner wall, and the roof garden down inside.
 const top=ringsAt(1,k,1+RIBBON.ribbonDepth/RIBBON.half)[0],eye=ringsAt(1,k,RIBBON.oculus)[0],well=.35*k;
 const crown=merge([annulus(eye,top,H-.05*k,.06*k),skin([at(eye,H-well),at(eye,H)].map(l=>[...l].reverse())),annulus(ringsAt(1,k,RIBBON.oculus*.98)[0],ringsAt(1,k,gi)[0],H-well,.02*k)]);
 const garden=lid(at(eye,H-well+.02*k));
 // Podium terraces: white slab edges over recessed glass, planters along each edge.
 const slabs:THREE.BufferGeometry[]=[],pglass:THREE.BufferGeometry[]=[],planters:THREE.BufferGeometry[]=[];
 const F=RIBBON.podium.floor*k;
 for(let l=0;l<RIBBON.podium.levels;l++){
  const ring=podiumRing(l,k),y=(l+1)*F;
  slabs.push(slab(ring,y,.07*k));
  pglass.push(skin([at(toward(ring,.94),l*F),at(toward(ring,.94),y-.07*k)]));
  planters.push(annulus(toward(ring,.9),toward(ring,.975),y,.035*k));
 }
 const d=podiumDetails(k);
 const sky=new THREE.CylinderGeometry(d.skylight.r,d.skylight.r,.012*k,28).translate(d.skylight.x,d.skylight.y+.006*k,d.skylight.z);
 const skyRing=new THREE.TorusGeometry(d.skylight.r,.018*k,6,28).rotateX(Math.PI/2).translate(d.skylight.x,d.skylight.y+.02*k,d.skylight.z).toNonIndexed();
 return {glass,ribbonsEven:merge(even),ribbonsOdd:merge(odd),crown,garden,slabs:merge([...slabs,skyRing]),podiumGlass:merge(pglass),planters:merge(planters),skylight:sky,details:d};
}
export type RibbonGeometry=ReturnType<typeof ribbonGeometry>;
export const ribbonTriangles=(g:RibbonGeometry)=>Object.values(g).reduce((n,v)=>n+(v instanceof THREE.BufferGeometry?(v.index?v.index.count:v.getAttribute('position').count)/3:0),0);
