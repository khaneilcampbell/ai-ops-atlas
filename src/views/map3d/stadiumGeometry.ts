import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {compactGeometry} from './atlasHqGeometry';
import {STADIUM_SCALE,type StadiumPlan} from './stadiumPlan';
export {STADIUM_SCALE};
import type {Pt} from './roads';

/**
 * Atlas Stadium (KC, 2026-11-07: steel-truss sports centre from KC's reference screenshots): two
 * glass halls on a white podium under thin sloping roofs. The main arena hall's roof rises from
 * the entrance (east) to the far end (west) and curls up at the eaves and corners. It sits on
 * planar Warren trusses and a purlin grid, with white zig-zag bracing outside the glass and tree
 * columns at the corners. A lower practice hall stands off the north side, and a wide stair runs
 * on a diagonal from the forecourt up to the podium deck at the main gate.
 *
 * Every size lives here in design units: an 8 x 7 box, measured from its centre (x east, z south)
 * and from the terrace top. The map draws it STADIUM_SCALE times larger (stadiumPlan.ts). The main
 * hall mirrors across its long axis (z = 0). The practice hall and the diagonal stair break that
 * symmetry on purpose, as in the reference.
 */
export const STADIUM={
 /** Main hall glass line: x from x0 to x1, z from -z to z. */
 hall:{x0:-3.4,x1:2.6,z:1.85},
 /** White podium under the main hall, running east past the hall as the entrance deck. */
 podium:{h:.45,slab:.08,x0:-3.55,x1:3.4,z:1.95,inset:.18,column:.5},
 /** Main roof: a thin plane from `low` (east) to `high` (west), `over` past the glass, curling up by `curl` at the eaves. */
 roof:{low:1.75,high:2.45,over:.32,thick:.06,curl:.14,edge:.62,seg:{x:17,z:10}},
 /** Practice hall, north of the main hall (z0 is its far side), and its own podium and roof. */
 practice:{x0:-2,x1:-.4,z0:-2.95,z1:-2.05,low:1.05,high:1.3,over:.25,curl:.08,podium:{x0:-2.1,x1:-.3,z0:-3.08}},
 /** Planar trusses across the short span (Warren web), `panels` per truss, `depth` deep. */
 trusses:{main:14,practice:5,panels:8,depth:.2},
 /** Purlins along the length of each roof, under the sheeting. */
 purlins:{main:9,practice:5},
 /** Zig-zag bracing bays outside the glass: long faces, end faces, practice faces. */
 bracing:{long:10,short:6,practice:4,off:.07},
 /** Tree columns: a concrete pier that splits into `struts` splayed steel arms holding the eave. */
 trees:{struts:5,pier:.32,reach:.42,east:[-.62,.62]},
 /** Mullion spacing on every glass wall, and the transom heights above the podium. */
 mullion:.28,transoms:[.42,.84],
 /** Grand stair: one straight flight square to the entrance, from the gate up to the entrance deck. */
 stair:{steps:7,width:1.7},
 /**
  * Gates: the main gate is the grand stair's foot, `foot` east of the centre, where the roads and
  * walks from Profile Tower, the Financial District, the airport and Stadium Station arrive. Two
  * short side flights come down off the podium's long sides at x = side.x.
  */
 gate:{foot:4.45,width:1.2,side:{x:1.6,run:.45,steps:3,width:.7}},
 /**
  * The ring the grounds keep clear: pools, palms and street lights stay outside it. Its centre sits
  * `cx` west of the box centre, because the main hall grows west toward the ocean (KC, 14:34) while
  * the entrance and the gate stay put.
  */
 ring:{cx:-.25,rx:4.38,rz:3.65},
 /** Slim light poles along the practice hall's north side. */
 poles:4,
} as const;

/** Main roof height at (x, z) above the terrace, before its thickness: the slope plus the curled eaves. */
type RoofSpec={x0:number;x1:number;z0:number;z1:number;low:number;high:number;curl:number;edge:number};
const mainRoof:RoofSpec={x0:STADIUM.hall.x0-STADIUM.roof.over,x1:STADIUM.hall.x1+STADIUM.roof.over,z0:-STADIUM.hall.z-STADIUM.roof.over,z1:STADIUM.hall.z+STADIUM.roof.over,low:STADIUM.roof.low,high:STADIUM.roof.high,curl:STADIUM.roof.curl,edge:STADIUM.roof.edge};
const P=STADIUM.practice;
const practiceRoof:RoofSpec={x0:P.x0-P.over,x1:P.x1+P.over,z0:P.z0-P.over,z1:P.z1+P.over,low:P.low,high:P.high,curl:P.curl,edge:STADIUM.roof.edge};
const ease=(n:number,edge:number)=>{const t=Math.max(0,Math.min(1,(n-edge)/(1-edge)));return t*t;};
function roofAt(r:RoofSpec,x:number,z:number){
 const cx=(r.x0+r.x1)/2,cz=(r.z0+r.z1)/2,hx=(r.x1-r.x0)/2,hz=(r.z1-r.z0)/2;
 const t=Math.max(0,Math.min(1,(r.x1-x)/(r.x1-r.x0))),nx=Math.min(1,Math.abs(x-cx)/hx),nz=Math.min(1,Math.abs(z-cz)/hz);
 // Upswept eaves: most along the long sides, a little at the ends, most of all at the four tips.
 const ex=ease(nx,r.edge),ez=ease(nz,r.edge);
 return r.low+(r.high-r.low)*t**1.2+r.curl*(ez+.5*ex+ex*ez);
}
export const mainRoofAt=(x:number,z:number)=>roofAt(mainRoof,x,z);
export const practiceRoofAt=(x:number,z:number)=>roofAt(practiceRoof,x,z);
/** Highest point of the roof above the terrace: the main roof's curled west tips. */
export const stadiumCrown=()=>(STADIUM.roof.high+2.5*STADIUM.roof.curl)*STADIUM_SCALE;
export const stadiumCentre=(a:Pick<StadiumPlan,'x'|'z'|'w'|'d'>):Pt=>[a.x+a.w/2,a.z+a.d/2];
/** Centre of the grounds' ring, in world units. */
export const stadiumRingCentre=(a:Pick<StadiumPlan,'x'|'z'|'w'|'d'>):Pt=>{const [x,z]=stadiumCentre(a);return [x+STADIUM.ring.cx*STADIUM_SCALE,z];};
/** Street-level point where the grand stair lands: every stadium road and walk ends here. */
export const stadiumGate=(a:Pick<StadiumPlan,'x'|'z'|'w'|'d'>):Pt=>{const [x,z]=stadiumCentre(a);return [x+STADIUM.gate.foot*STADIUM_SCALE,z];};
/** Where the two side flights land, as offsets from the centre, in design units: north, then south. */
export function sideGateFeet():Pt[]{
 const {x,run}=STADIUM.gate.side,z=STADIUM.podium.z+run;
 return [[x,-z],[x,z]];
}
/** Foot and top of the grand stair, in design units: it climbs straight west from the main gate to the deck. */
export function stairLine(){
 const foot:Pt=[STADIUM.gate.foot,0],top:Pt=[STADIUM.podium.x1,0];
 return {foot,top,len:foot[0]-top[0]};
}
/** Tree column piers, in design units: the main hall's four corners and two on the entrance face. */
export function treeColumns():Pt[]{
 const H=STADIUM.hall,o=.18,out:Pt[]=[];
 for(const x of [H.x0-o,H.x1+o])for(const z of [-H.z-o,H.z+o])out.push([x,z]);
 for(const z of STADIUM.trees.east)out.push([H.x1+o,z]);
 return out;
}
/** x of each main-hall truss, evenly across the roof, just inside its ends. */
export const trussXs=(n:number=STADIUM.trusses.main,r:RoofSpec=mainRoof)=>Array.from({length:n},(_,k)=>r.x0+.2+(r.x1-r.x0-.4)*k/(n-1));

type V3=[number,number,number];
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;

/** A grid surface from a point function; winding chosen so normals face `outward`. */
function surface(nu:number,nv:number,at:(u:number,v:number)=>V3,outward:boolean,uvScale?:[number,number]){
 const pos:number[]=[],idx:number[]=[],uv:number[]=[];
 for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){pos.push(...at(i/nu,j/nv));if(uvScale)uv.push(i/nu*uvScale[0],j/nv*uvScale[1]);}
 for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
  const a=j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;
  if(outward)idx.push(a,c,b,b,c,d);else idx.push(a,b,c,b,d,c);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));if(uvScale)g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
const box=(x:number,y:number,z:number,w:number,h:number,d:number,r=0)=>{const g=new THREE.BoxGeometry(w,h,d);g.rotateY(r);g.translate(x,y+h/2,z);g.deleteAttribute('uv');return g;};
const column=(x:number,y:number,z:number,r:number,h:number)=>{const g=new THREE.CylinderGeometry(r,r,h,8,1,true);g.translate(x,y+h/2,z);g.deleteAttribute('uv');return g;};
const Z=new THREE.Vector3(0,0,1);
/**
 * A steel member from a to b: a four-sided tube with no end caps and soft normals, so it reads as
 * a round tube and costs 8 vertices instead of a box's 24 (the map's geometry budget).
 */
function beam(a:V3,b:V3,t=.03){
 const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),len=A.distanceTo(B),h=t/2,pos:number[]=[],nor:number[]=[],idx:number[]=[];
 const ring:[number,number][]=[[h,h],[-h,h],[-h,-h],[h,-h]];
 for(const z of [-len/2,len/2])for(const [x,y] of ring){pos.push(x,y,z);nor.push(x/(h*Math.SQRT2),y/(h*Math.SQRT2),0);}
 for(let k=0;k<4;k++){const i=k,j=(k+1)%4;idx.push(i,j,i+4,j,j+4,i+4);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));g.setIndex(idx);
 g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z,B.clone().sub(A).normalize()));
 g.translate((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);return g;
}
const merge=(parts:THREE.BufferGeometry[],keepUv=false)=>{
 const flat=parts.map(p=>{const g=p.index?p.toNonIndexed():p;if(g!==p)p.dispose();if(!keepUv&&g.getAttribute('uv'))g.deleteAttribute('uv');
  // Pieces without a texture (fascias, rails) get blank uvs so they merge with the sheeting.
  if(keepUv&&!g.getAttribute('uv'))g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count*2),2));return g;});
 const out=mergeGeometries(flat)!;flat.forEach(g=>g.dispose());return compactGeometry(out);
};

export interface StadiumGeometry {
 /** Roof sheeting (top) and fascias: dark standing seam. */
 roof:THREE.BufferGeometry;
 /** Roof undersides: pale soffits, lit warm at night. */
 soffit:THREE.BufferGeometry;
 /** White steel: trusses, purlins, bracing, tree-column arms, mullions, eave ties and light poles. */
 steel:THREE.BufferGeometry;
 /** Curtain walls, the ground-floor glazing and the link between the halls: warm at night. */
 glass:THREE.BufferGeometry;
 /** White concrete: podium slabs, colonnade, ground-floor core, piers, the grand stair and side flights. */
 podium:THREE.BufferGeometry;
}

/** Standing seams across the roof: one texture tile per this many design units along x and z. */
export const ROOF_TILES:[number,number]=[1.5,4];

function roofParts(r:RoofSpec,thick:number,nu:number,nv:number,roof:THREE.BufferGeometry[],soffit:THREE.BufferGeometry[]){
 const top=(u:number,v:number):V3=>{const x=lerp(r.x0,r.x1,u),z=lerp(r.z0,r.z1,v);return [x,roofAt(r,x,z),z];};
 const under=(u:number,v:number):V3=>{const [x,y,z]=top(u,v);return [x,y-thick,z];};
 roof.push(surface(nu,nv,(u,v)=>top(u,v),true,[(r.x1-r.x0)/ROOF_TILES[0],(r.z1-r.z0)/ROOF_TILES[1]]));
 soffit.push(surface(nu,nv,under,false));
 // Fascia strips round the four edges, joining top and underside.
 const edge=(f:(s:number)=>[number,number],out:boolean,n:number)=>surface(n,1,(s,k)=>{const [u,v]=f(s),[x,y,z]=top(u,v);return [x,y-thick*(1-k),z];},out);
 roof.push(edge(s=>[s,0],true,nu),edge(s=>[s,1],false,nu),edge(s=>[0,s],false,nv),edge(s=>[1,s],true,nv));
}

/** A glass wall along a straight line on the podium, its top following a roof's underside. */
function glassWall(a:Pt,b:Pt,y0:number,top:(x:number,z:number)=>number,n:number,out:boolean){
 return surface(n,1,(u,v)=>{const x=lerp(a[0],b[0],u),z=lerp(a[1],b[1],u);return [x,lerp(y0,top(x,z),v),z];},out);
}
/** Mullions and transoms on one glass wall, a little proud of the glass. */
function mullions(a:Pt,b:Pt,y0:number,top:(x:number,z:number)=>number,steel:THREE.BufferGeometry[]){
 const len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(2,Math.round(len/STADIUM.mullion));
 for(let k=0;k<=n;k++){const x=lerp(a[0],b[0],k/n),z=lerp(a[1],b[1],k/n);steel.push(beam([x,y0,z],[x,top(x,z),z],.018));}
 for(const h of STADIUM.transoms){
  const y=y0+h;if(y>Math.min(top(...a),top(...b))-.05)continue;
  steel.push(beam([a[0],y,a[1]],[b[0],y,b[1]],.016));
 }
}
/** Zig-zag bracing along one face: `n` bays between a bottom and a top chord that follows the roof. */
function zigzag(a:Pt,b:Pt,y0:number,top:(x:number,z:number)=>number,n:number,steel:THREE.BufferGeometry[]){
 const at=(k:number,up:boolean):V3=>{const x=lerp(a[0],b[0],k/n),z=lerp(a[1],b[1],k/n);return [x,up?top(x,z):y0,z];};
 for(let k=0;k<n;k++){
  steel.push(beam(at(k,k%2===0),at(k+1,k%2===1),.034));
  steel.push(beam(at(k,true),at(k+1,true),.04),beam(at(k,false),at(k+1,false),.03));
 }
}
/** A planar Warren truss across the roof at x, from z0 to z1, hung under the roof's underside. */
function truss(x:number,z0:number,z1:number,under:(x:number,z:number)=>number,panels:number,depth:number,steel:THREE.BufferGeometry[]){
 const T=(k:number):V3=>{const z=lerp(z0,z1,k/panels);return [x,under(x,z),z];};
 const B=(k:number):V3=>{const [px,py,pz]=T(k),edge=Math.abs(k/panels-.5)*2;return [px,py-depth*(1-.55*edge),pz];};
 for(let k=0;k<panels;k++){
  steel.push(beam(T(k),T(k+1),.03),beam(B(k),B(k+1),.026));
  steel.push(k%2?beam(B(k),T(k+1),.022):beam(T(k),B(k+1),.022));
 }
}

/** Built once per stadium, centred on the box centre at terrace height. */
export function stadiumGeometry():StadiumGeometry{
 const S=STADIUM,H=S.hall,Pd=S.podium,y0=Pd.h,thick=S.roof.thick;
 const roof:THREE.BufferGeometry[]=[],soffit:THREE.BufferGeometry[]=[],steel:THREE.BufferGeometry[]=[],glass:THREE.BufferGeometry[]=[],podium:THREE.BufferGeometry[]=[];
 const mainUnder=(x:number,z:number)=>mainRoofAt(x,z)-thick,practiceUnder=(x:number,z:number)=>practiceRoofAt(x,z)-thick*.8;
 // Roofs.
 roofParts(mainRoof,thick,S.roof.seg.x,S.roof.seg.z,roof,soffit);
 roofParts(practiceRoof,thick*.8,12,10,roof,soffit);
 // Main hall: four glass walls, mullions, zig-zag bracing outside, an eave tie on top.
 const c:[Pt,Pt,Pt,Pt]=[[H.x1,-H.z],[H.x1,H.z],[H.x0,H.z],[H.x0,-H.z]];
 const walls:[Pt,Pt,boolean][]=[[c[0],c[1],false],[c[1],c[2],false],[c[2],c[3],false],[c[3],c[0],false]];
 for(const [a,b] of walls){
  const len=Math.hypot(b[0]-a[0],b[1]-a[1]),top=(x:number,z:number)=>mainUnder(x,z)-.02;
  glass.push(glassWall(a,b,y0,top,Math.max(4,Math.round(len*2)),true));
  mullions(a,b,y0,top,steel);
 }
 const o=S.bracing.off,braceTop=(x:number,z:number)=>mainUnder(x,z)-.03;
 zigzag([H.x0,-H.z-o],[H.x1,-H.z-o],y0+.02,braceTop,S.bracing.long,steel);
 zigzag([H.x0,H.z+o],[H.x1,H.z+o],y0+.02,braceTop,S.bracing.long,steel);
 zigzag([H.x1+o,-H.z],[H.x1+o,H.z],y0+.02,braceTop,S.bracing.short,steel);
 zigzag([H.x0-o,-H.z],[H.x0-o,H.z],y0+.02,braceTop,S.bracing.short,steel);
 // Trusses across the short span and purlins along the length, under the sheeting.
 for(const x of trussXs())truss(x,mainRoof.z0+.12,mainRoof.z1-.12,(px,pz)=>mainUnder(px,pz)-.015,S.trusses.panels,S.trusses.depth,steel);
 for(let k=0;k<S.purlins.main;k++){
  const z=lerp(mainRoof.z0+.15,mainRoof.z1-.15,k/(S.purlins.main-1)),n=7;
  for(let i=0;i<n;i++){const xa=lerp(mainRoof.x0+.1,mainRoof.x1-.1,i/n),xb=lerp(mainRoof.x0+.1,mainRoof.x1-.1,(i+1)/n);steel.push(beam([xa,mainUnder(xa,z)-.012,z],[xb,mainUnder(xb,z)-.012,z],.02));}
 }
 // Tree columns: a concrete pier, then splayed arms up to the eave.
 for(const [x,z] of treeColumns()){
  podium.push(box(x,y0,z,.15,S.trees.pier,.15));
  const base:V3=[x,y0+S.trees.pier,z],face=Math.atan2(z,x);
  for(let k=0;k<S.trees.struts;k++){
   // Fan the arms round the pier, kept under the roof's edge so none pokes through it.
   const a=face+(k-(S.trees.struts-1)/2)*.62,inset=.08;
   const px=Math.min(mainRoof.x1-inset,Math.max(mainRoof.x0+inset,x+Math.cos(a)*S.trees.reach)),pz=Math.min(mainRoof.z1-inset,Math.max(mainRoof.z0+inset,z+Math.sin(a)*S.trees.reach));
   steel.push(beam(base,[px,mainUnder(px,pz)-.02,pz],.04));
  }
 }
 // Practice hall: glass walls, mullions, bracing on the north and west faces, trusses and purlins.
 const pc:[Pt,Pt,Pt,Pt]=[[P.x1,P.z0],[P.x1,P.z1],[P.x0,P.z1],[P.x0,P.z0]];
 for(let k=0;k<4;k++){
  const a=pc[k],b=pc[(k+1)%4],len=Math.hypot(b[0]-a[0],b[1]-a[1]),top=(x:number,z:number)=>practiceUnder(x,z)-.02;
  glass.push(glassWall(a,b,y0,top,Math.max(3,Math.round(len*2)),true));
  mullions(a,b,y0,top,steel);
 }
 const pTop=(x:number,z:number)=>practiceUnder(x,z)-.03;
 zigzag([P.x1,P.z0-o],[P.x0,P.z0-o],y0+.02,pTop,S.bracing.practice,steel);
 zigzag([P.x0-o,P.z0],[P.x0-o,P.z1],y0+.02,pTop,S.bracing.practice-1,steel);
 for(const x of trussXs(S.trusses.practice,practiceRoof))truss(x,practiceRoof.z0+.1,practiceRoof.z1-.1,(px,pz)=>practiceUnder(px,pz)-.012,6,S.trusses.depth*.7,steel);
 for(let k=0;k<S.purlins.practice;k++){
  const z=lerp(practiceRoof.z0+.12,practiceRoof.z1-.12,k/(S.purlins.practice-1));
  steel.push(beam([practiceRoof.x0+.1,practiceUnder(practiceRoof.x0+.1,z)-.01,z],[practiceRoof.x1-.1,practiceUnder(practiceRoof.x1-.1,z)-.01,z],.018));
 }
 // A glazed link between the halls.
 glass.push(box(-1.2,y0,(P.z1-H.z)/2,.6,.42,P.z1+H.z+.02));
 roof.push(box(-1.2,y0+.42,(P.z1-H.z)/2,.7,.03,P.z1+H.z+.1));
 // Podiums: a slab on round columns, the ground floor glazed behind them round an opaque core.
 const slabs=[{x0:Pd.x0,x1:Pd.x1,z0:-Pd.z,z1:Pd.z},{x0:P.podium.x0,x1:P.podium.x1,z0:P.podium.z0,z1:-Pd.z}];
 for(const s of slabs){
  const w=s.x1-s.x0,d=s.z1-s.z0,cx=(s.x0+s.x1)/2,cz=(s.z0+s.z1)/2,h=y0-Pd.slab;
  podium.push(box(cx,h,cz,w,Pd.slab,d));
  podium.push(box(cx,0,cz,w-2*Pd.inset-.1,h,d-2*Pd.inset-.1));
  glass.push(box(cx,0,cz,w-2*Pd.inset,h-.02,d-2*Pd.inset));
  const nx=Math.round(w/Pd.column),nz=Math.round(d/Pd.column);
  for(let k=0;k<=nx;k++){const x=lerp(s.x0+.08,s.x1-.08,k/nx);for(const z of [s.z0+.08,s.z1-.08])podium.push(column(x,0,z,.045,h));}
  for(let k=1;k<nz;k++){const z=lerp(s.z0+.08,s.z1-.08,k/nz);for(const x of [s.x0+.08,s.x1-.08])podium.push(column(x,0,z,.045,h));}
 }
 // Grand stair: one straight flight square to the entrance, from the gate up to the deck, between
 // two low cheek walls with handrails on top.
 const st=stairLine(),G=S.gate,n=S.stair.steps,W=S.stair.width,run=st.len/n;
 for(let k=0;k<n;k++){
  // Step k counts up from the foot: the lowest step is at the gate, the top one meets the deck.
  const x=st.foot[0]-run*(k+.5),h=y0*(k+1)/n;
  podium.push(box(x,0,0,run+.01,h,W));
 }
 for(const side of [-1,1]){
  const z=side*(W/2+.04);
  podium.push(box((st.foot[0]+st.top[0])/2,0,z,st.len,y0*.55,.08));
  steel.push(beam([st.foot[0],.22,z],[st.top[0],y0+.2,z],.02));
 }
 // Side flights off the podium's long sides.
 for(const [fx,fz] of sideGateFeet()){
  const sgn=Math.sign(fz),r=G.side.run/G.side.steps;
  for(let k=0;k<G.side.steps;k++){const h=y0*(G.side.steps-k)/G.side.steps;podium.push(box(fx,0,sgn*(Pd.z+r*(k+.5)),G.side.width,h,r));}
 }
 // Light poles along the practice hall's north side.
 for(let k=0;k<S.poles;k++){const x=lerp(P.podium.x0,P.podium.x1+.6,k/(S.poles-1)),z=P.podium.z0-.25;steel.push(beam([x,0,z],[x,1.15,z],.025),box(x+.06,1.12,z,.16,.03,.06));}
 return {roof:merge(roof,true),soffit:merge(soffit),steel:merge(steel),glass:merge(glass),podium:merge(podium)};
}

/** Draw calls the stadium makes, for the performance budget. Nothing here adds a light. */
export function stadiumPieceCount(){
 const meshes=['roof','soffit','steel','glass','podium'].length,instanced=['terrace','grounds'].length;
 return {meshes,instanced,draws:meshes+instanced,instances:1};
}
export const stadiumTriangles=(g:StadiumGeometry)=>Object.values(g).reduce((n,v)=>n+(v.index?v.index.count:v.getAttribute('position').count)/3,0);

/**
 * The plaza on the stadium lot, in world units: a ring of trees (drawn as palms) round the
 * building with planted beds between them, and lit bollards round the ring and along the main
 * approach. The gates and their approaches stay open.
 */
export function stadiumPlaza(a:Pick<StadiumPlan,'x'|'z'|'w'|'d'>){
 const [cx,cz]=stadiumCentre(a),[rx0]=stadiumRingCentre(a),K=STADIUM_SCALE,R=STADIUM.ring,G=STADIUM.gate,trees:Pt[]=[],beds:Pt[]=[],bollards:Pt[]=[];
 const feet=sideGateFeet().map(([x,z]):Pt=>[cx+x*K,cz+z*K]),gate=stadiumGate(a);
 const open=(p:Pt,pad:number)=>Math.abs(p[1]-cz)<G.width*K/2+pad&&p[0]>cx||feet.some(f=>Math.hypot(p[0]-f[0],p[1]-f[1])<pad+.6);
 const ring=(grow:number,n:number,phase:number,out:Pt[],pad:number)=>{
  for(let k=0;k<n;k++){const t=(k+phase)/n*Math.PI*2,p:Pt=[rx0+(R.rx*K+grow)*Math.cos(t),cz+(R.rz*K+grow)*Math.sin(t)];if(!open(p,pad))out.push(p);}
 };
 ring(1.05,26,0,trees,.5);ring(1.05,10,.5,beds,.45);ring(.4,20,.25,bollards,.25);
 // Two lines of bollards lead from the main gate to the edge of the lot.
 for(let x=gate[0]+.2;x<a.x+a.w+1.8;x+=.45)for(const side of [-1,1])bollards.push([x,cz+side*(G.width*K/2+.35)]);
 return {trees,beds,bollards};
}
