import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {compactGeometry} from './atlasHqGeometry';
import {STADIUM_SCALE,type StadiumPlan} from './stadiumPlan';
export {STADIUM_SCALE};
import type {Pt} from './roads';

/**
 * Atlas Stadium (KC, 2026-11-07): an elliptical bowl under a ring of curved shell petals, on a
 * raised ring concourse. Every size lives here in design units: an 8 x 7 box, measured from its
 * centre and from the terrace top. The map draws it STADIUM_SCALE times larger (stadiumPlan.ts), so
 * one factor grows the whole stadium and its lot together.
 *
 * The roof is Atlas's own: nine shells in a repeating tall-short-middle rhythm of three, each
 * leaning a little, the leading edge of each lifting over the next so a thin seam shows between
 * them. The seams, the opening rim and the shell undersides carry the night glow.
 */
export const STADIUM={
 /** Shell count: odd, between 7 and 11. */
 shells:9,
 /** Crown height of each shell above the terrace, repeated around the ring. */
 rhythm:[3.05,2.82,2.94],
 /** Where the shells meet the concourse. */
 base:{rx:3.35,rz:2.9,y:.3},
 /** The oval roof opening over the pitch. */
 open:{rx:2.15,rz:1.55},
 /** Lean of each shell from base to crown, radians (about 12 degrees). */
 twist:.21,
 /** Each shell is this much wider than its share of the ring, so neighbours overlap. */
 overlap:1.3,
 /** The leading edge lifts out by this much, the trailing edge tucks in, so shells never touch. */
 lip:.08,
 /** How far a shell puffs out in the middle. */
 bulge:.17,
 /** Share of each shell's width, at its leading edge, drawn as the lit seam; and the lit rim at the top. */
 seam:.12,rim:.06,
 /** Gap between a shell's outer skin and its underside. */
 thickness:.05,
 /**
  * Each shell's lower edge arches up in its middle by `h`, easing back to the plain curve by
  * `reach` up the shell, so the glazed lobby shows under the shells all round.
  */
 lift:{h:.75,reach:.32},
 /** Glazed lobby ring on the concourse, under the arches; a mullion every `mullions`th of the ring. */
 lobby:{rx:3.07,rz:2.63,h:.4,mullions:56},
 /** Floodlight heads under the opening rim, per shell, aimed at the pitch. */
 floods:3,
 segments:{u:8,v:10},
 /** Coarser grid for the undersides, only seen through the roof opening. */
 underSegments:{u:6,v:6},
 /** Three seating tiers between the pitch and the back of the bowl. */
 seats:{tiers:3,inner:{rx:2.05,rz:1.45},outer:{rx:3.0,rz:2.55},low:.12,high:1.15,segments:48},
 pitch:{w:3.5,d:2.15},
 /** Scoreboards on the two short ends of the bowl, facing the pitch. */
 screens:{x:2.95,y:1.55,w:1.25,h:.42},
 /** Raised ring walkway on slim columns. */
 concourse:{y:.5,thick:.07,inner:{rx:3.04,rz:2.6},outer:{rx:3.95,rz:3.45},edge:.025,segments:48,columns:24},
 /**
  * Gates: steps from the deck down to street level. The main gate faces east, where the roads
  * and walks from GitHub Profile, the Financial District, the airport and Stadium Station arrive;
  * `foot` is how far east of the centre its bottom step lands. Two side gates face north-east and
  * south-east.
  */
 gate:{foot:4.45,width:1.2,steps:5,side:{angle:.62,width:.7,steps:3,run:.55}},
} as const;

/** Highest point of the roof above the terrace. */
export const stadiumCrown=()=>Math.max(...STADIUM.rhythm)*STADIUM_SCALE;
export const stadiumCentre=(a:Pick<StadiumPlan,'x'|'z'|'w'|'d'>):Pt=>[a.x+a.w/2,a.z+a.d/2];
/** Street-level point where the main gate's bottom step lands: every stadium road and walk ends here. */
export const stadiumGate=(a:Pick<StadiumPlan,'x'|'z'|'w'|'d'>):Pt=>{const [x,z]=stadiumCentre(a);return [x+STADIUM.gate.foot*STADIUM_SCALE,z];};
/** Where the two side gates' bottom steps land, as offsets from the centre, in design units. */
export function sideGateFeet():Pt[]{
 const {outer}=STADIUM.concourse,{angle,run}=STADIUM.gate.side;
 return [-angle,angle].map(a=>{const x=Math.cos(a),z=Math.sin(a);return [(outer.rx+run)*x,(outer.rz+run)*z] as Pt;});
}

type V3=[number,number,number];
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;

/** One point on shell i at (u across, -1 trailing to 1 leading; v up, 0 base to 1 crown). */
export function shellPoint(i:number,u:number,v:number,inset=0):V3{
 const S=STADIUM,step=Math.PI*2/S.shells,half=step/2*S.overlap*(1-.12*v);
 const a=i*step+u*half+S.twist*v,t=Math.pow(v,1.4);
 const puff=S.bulge*Math.sin(Math.PI*Math.min(1,v*1.1))*(1-u*u)+S.lip*u*(.4+.6*v)-inset;
 const rx=lerp(S.base.rx,S.open.rx,t)+puff,rz=lerp(S.base.rz,S.open.rz,t)+puff;
 const crown=S.rhythm[i%S.rhythm.length];
 const arch=S.lift.h*(1-u*u)*Math.max(0,1-v/S.lift.reach)**2;
 const y=S.base.y+(crown-S.base.y)*Math.sin(Math.PI/2*v)+.06*Math.sin(Math.PI*v)*(1-u*u)+arch-inset*.6;
 return [rx*Math.cos(a),y,rz*Math.sin(a)];
}

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

/** A sloped elliptical band from (s0 at y0) to (s1 at y1), seen from above and the pitch. */
function band(inner:{rx:number;rz:number},outer:{rx:number;rz:number},y0:number,y1:number,n:number,up=true){
 return surface(n,1,(u,v)=>{const a=u*Math.PI*2;return [lerp(inner.rx,outer.rx,v)*Math.cos(a),lerp(y0,y1,v),lerp(inner.rz,outer.rz,v)*Math.sin(a)];},!up);
}
/** A vertical elliptical wall between y0 and y1; `out` faces away from the centre. */
function wall(e:{rx:number;rz:number},y0:number,y1:number,n:number,out:boolean){
 return surface(n,1,(u,v)=>{const a=u*Math.PI*2;return [e.rx*Math.cos(a),lerp(y0,y1,v),e.rz*Math.sin(a)];},out);
}
const box=(x:number,y:number,z:number,w:number,h:number,d:number,r=0)=>{const g=new THREE.BoxGeometry(w,h,d);g.rotateY(r);g.translate(x,y+h/2,z);g.deleteAttribute('uv');return g;};
const merge=(parts:THREE.BufferGeometry[],keepUv=false)=>{
 const flat=parts.map(p=>{const g=p.index?p.toNonIndexed():p;if(g!==p)p.dispose();if(!keepUv&&g.getAttribute('uv'))g.deleteAttribute('uv');return g;});
 const out=mergeGeometries(flat)!;flat.forEach(g=>g.dispose());return compactGeometry(out);
};

export interface StadiumGeometry {
 /** Outer skin of the shells. */
 shells:THREE.BufferGeometry;
 /** Underside of the shells, facing the bowl: glows warm at night. */
 undersides:THREE.BufferGeometry;
 /** Seams between shells, the opening rim and the concourse edge line: the lit parts. */
 seams:THREE.BufferGeometry;
 seats:THREE.BufferGeometry;
 deck:THREE.BufferGeometry;
 /** Glazed lobby ring under the arches: warm at night. */
 glass:THREE.BufferGeometry;
}

/** Panels across and up one shell skin, for the perforated skin texture (one tile = 4 x 4 panels). */
export const SKIN_TILES:[number,number]=[1.5,2.5];

/** Built once per stadium, centred on the box centre at terrace height. */
export function stadiumGeometry():StadiumGeometry{
 const S=STADIUM,{u:NU,v:NV}=S.segments,shells:THREE.BufferGeometry[]=[],under:THREE.BufferGeometry[]=[],seams:THREE.BufferGeometry[]=[];
 const cut=1-S.seam*2,top=1-S.rim;
 for(let i=0;i<S.shells;i++){
  // Skin from the trailing edge to the seam, seam to the leading edge, rim around the top.
  // Rows packed towards the base (v^1.5), so the arched lower edge stays a smooth curve.
  shells.push(surface(NU,NV,(u,v)=>shellPoint(i,-1+u*(1+cut),v**1.5*top),true,SKIN_TILES));
  seams.push(surface(2,NV,(u,v)=>shellPoint(i,cut+u*(1-cut),v**1.5*top),true));
  seams.push(surface(NU,1,(u,v)=>shellPoint(i,-1+u*2,top+v*(1-top)),true));
  under.push(surface(S.underSegments.u,S.underSegments.v,(u,v)=>shellPoint(i,-1+u*2,v,S.thickness),false));
  // Floodlight heads tucked under the rim, facing the pitch.
  for(let k=0;k<S.floods;k++){
   const [x,y,z]=shellPoint(i,-.6+1.2*k/(S.floods-1),.96,S.thickness+.04),a=Math.atan2(z,x);
   seams.push(box(x,y-.05,z,.05,.05,.16,-a));
  }
 }
 const C=S.concourse,deckTop=C.y,deckLow=C.y-C.thick;
 seams.push(wall(C.outer,deckTop-C.edge,deckTop,C.segments,true));
 const deck=[
  band(C.inner,C.outer,deckTop,deckTop,C.segments,true),
  band(C.inner,C.outer,deckLow,deckLow,C.segments,false),
  wall(C.outer,deckLow,deckTop-C.edge,C.segments,true),
  wall(C.inner,deckLow,deckTop,C.segments,false),
 ];
 // Glazed lobby under the arches: a glass ring with mullions and a slim head rail.
 const L=S.lobby,glass=[wall(L,deckTop,deckTop+L.h,C.segments,true),wall({rx:L.rx-.01,rz:L.rz-.01},deckTop,deckTop+L.h,C.segments,false)];
 for(let k=0;k<L.mullions;k++){const a=k/L.mullions*Math.PI*2;deck.push(box(L.rx*Math.cos(a),deckTop,L.rz*Math.sin(a),.025,L.h,.025,-a));}
 deck.push(wall({rx:L.rx+.015,rz:L.rz+.015},deckTop+L.h-.03,deckTop+L.h,C.segments,true));
 // Main gate: wide steps from the deck's east edge down to the street.
 const G=S.gate,east=C.outer.rx-.05,run=(G.foot-east)/G.steps;
 for(let k=0;k<G.steps;k++){const h=deckTop*(G.steps-k)/G.steps;deck.push(box(east+run*(k+.5),0,0,run,h,G.width));}
 // A light canopy over the main gate, on two posts.
 deck.push(box(east+.35,deckTop+.62,0,.75,.05,G.width+.3),box(east+.68,deckTop,-(G.width/2+.1),.05,.62,.05),box(east+.68,deckTop,G.width/2+.1,.05,.62,.05));
 // Side gates: shorter flights to the north-east and south-east.
 for(const a of [-G.side.angle,G.side.angle]){
  const ox=C.outer.rx*Math.cos(a)*.98,oz=C.outer.rz*Math.sin(a)*.98,dx=Math.cos(a),dz=Math.sin(a),r=G.side.run/G.side.steps;
  for(let k=0;k<G.side.steps;k++){const h=deckTop*(G.side.steps-k)/G.side.steps,d=r*(k+.5);deck.push(box(ox+dx*d,0,oz+dz*d,r,h,G.side.width,-a));}
 }
 // Seating tiers: each a sloped ring with a riser at its front, plus the back wall of the bowl.
 const T=S.seats,seats:THREE.BufferGeometry[]=[];
 for(let k=0;k<T.tiers;k++){
  const t0=k/T.tiers,t1=(k+1)/T.tiers,e=(t:number)=>({rx:lerp(T.inner.rx,T.outer.rx,t),rz:lerp(T.inner.rz,T.outer.rz,t)});
  const y0=lerp(T.low,T.high,t0)+.08,y1=lerp(T.low,T.high,t1);
  seats.push(band(e(t0),e(t1),y0,y1,T.segments,true),wall(e(t0),k?lerp(T.low,T.high,t0):0,y0,T.segments,false));
 }
 seats.push(wall(T.outer,0,T.high,T.segments,true));
 return {shells:merge(shells,true),undersides:merge(under),seams:merge(seams),seats:merge(seats),deck:merge(deck),glass:merge(glass)};
}

/** Instanced extras (all g.box): concourse columns and pitch lines. */
export function stadiumColumns(){
 const C=STADIUM.concourse,out:{p:V3;s:V3}[]=[];
 for(let i=0;i<C.columns;i++){
  const a=(i+.5)/C.columns*Math.PI*2;
  if(Math.abs(Math.atan2(Math.sin(a),Math.cos(a)))<.2)continue; // keep the main gate clear
  out.push({p:[(C.outer.rx-.12)*Math.cos(a),0,(C.outer.rz-.12)*Math.sin(a)],s:[.06,C.y-C.thick,.06]});
 }
 return out;
}
export function pitchLines(){
 const P=STADIUM.pitch,y=.09,t=.018,out:{p:V3;s:V3}[]=[];
 out.push({p:[0,y,-P.d/2],s:[P.w,.004,t]},{p:[0,y,P.d/2],s:[P.w,.004,t]},{p:[-P.w/2,y,0],s:[t,.004,P.d]},{p:[P.w/2,y,0],s:[t,.004,P.d]},{p:[0,y,0],s:[t,.004,P.d]});
 return out;
}

/** Draw calls the stadium makes, for the performance budget. Nothing here adds a light. */
export function stadiumPieceCount(){
 const meshes=['shells','undersides','seams','seats','deck','glass'].length,instanced=['columns + lines','pitch','screens','terrace'].length;
 return {meshes,instanced,draws:meshes+instanced,instances:stadiumColumns().length+pitchLines().length+1+2+1};
}
export const stadiumTriangles=(g:StadiumGeometry)=>Object.values(g).reduce((n,v)=>n+(v.index?v.index.count:v.getAttribute('position').count)/3,0);

/**
 * The plaza on the stadium lot, in world units: a ring of trees round the concourse with planted
 * beds between them, and lit bollards along the main approach and round the ring. Gates and their
 * approaches stay open.
 */
export function stadiumPlaza(a:Pick<StadiumPlan,'x'|'z'|'w'|'d'>){
 const [cx,cz]=stadiumCentre(a),K=STADIUM_SCALE,C=STADIUM.concourse,G=STADIUM.gate,trees:Pt[]=[],beds:Pt[]=[],bollards:Pt[]=[];
 const feet=sideGateFeet().map(([x,z]):Pt=>[cx+x*K,cz+z*K]),gate=stadiumGate(a);
 const open=(p:Pt,pad:number)=>Math.abs(p[1]-cz)<G.width*K/2+pad&&p[0]>cx||feet.some(f=>Math.hypot(p[0]-f[0],p[1]-f[1])<pad+.6);
 const ring=(grow:number,n:number,phase:number,out:Pt[],pad:number)=>{
  for(let k=0;k<n;k++){const t=(k+phase)/n*Math.PI*2,p:Pt=[cx+(C.outer.rx*K+grow)*Math.cos(t),cz+(C.outer.rz*K+grow)*Math.sin(t)];if(!open(p,pad))out.push(p);}
 };
 ring(1.05,26,0,trees,.5);ring(1.05,10,.5,beds,.45);ring(.4,20,.25,bollards,.25);
 // Two lines of bollards lead from the main gate to the edge of the lot.
 for(let x=gate[0]+.2;x<a.x+a.w+1.8;x+=.45)for(const side of [-1,1])bollards.push([x,cz+side*(G.width*K/2+.35)]);
 return {trees,beds,bollards};
}
