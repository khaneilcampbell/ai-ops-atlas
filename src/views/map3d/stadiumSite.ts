import type {Rect} from './scene';
import type {Pt} from './roads';
import {distanceToRoad} from './highway';
import {STADIUM,STADIUM_SCALE,sideGateFeet,stadiumCentre,stadiumGate} from './stadiumGeometry';
import type {StadiumPlan} from './stadiumPlan';

/**
 * Atlas Stadium's grounds (KC, 2026-11-07: "utilize the whole space for the stadium ... like how
 * we did Atlas Marketplace"). After the city is laid out, the stadium takes the open land around
 * its lot, up to the neighbouring districts and the island edge, so nothing else moves. On it, in
 * the manner of KC's site-plan blueprint: a ring of reflecting pools round the concourse, two
 * training pitches, car parks with marked bays, round fountain plazas, and groves of trees.
 * Everything is placed clear of roads, walks, paving and the station stairs.
 */
export const SITE={
 /** How far the grounds may reach past the stadium lot on each side. */
 reach:12,step:.5,gap:.5,edge:1.2,
 pitch:{w:4.6,d:3,apron:.35},
 parking:{w:4.2,d:2.6,bay:.42},
 plaza:{r:1.25},
 grove:{step:1,share:.62,max:48},
 pools:{grow:.55,width:.42,segments:44},
} as const;

export interface SiteBox {x:number;z:number;w:number;d:number;c:string;h?:number;r?:number}
export interface StadiumSite {
 site:Rect;
 /** Flat pieces on the ground, all g.box: pool water and rims, pitches and lines, car parks and bays, plaza paving. */
 boxes:SiteBox[];
 pitches:Rect[];parking:Rect[];
 fountains:{x:number;z:number;k:number}[];
 trees:{x:number;z:number;kind:'cone'|'round'}[];
 beds:Pt[];
}

const hash=(x:number,z:number)=>{const s=Math.sin(x*127.1+z*311.7)*43758.5453;return s-Math.floor(s);};
const overlaps=(a:Rect,b:Rect,gap=0)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.z<b.z+b.d+gap&&a.z+a.d+gap>b.z;
const inside=(a:Rect,b:Rect)=>a.x>=b.x&&a.z>=b.z&&a.x+a.w<=b.x+b.w&&a.z+a.d<=b.z+b.d;

export function planStadiumSite({stadium:a,land,envelope,paths,paving}:{stadium:StadiumPlan;
 /** Every district, terrace and lot; the stadium's own lot is recognised and skipped. */
 land:Rect[];envelope:Rect;
 /** Roads, walks and station walks that cross open land: nothing is placed on them. */
 paths:Pt[][];
 /** Paths and paving already on the ground. */
 paving:Rect[]}):StadiumSite{
 const lot={x:a.x-2,z:a.z-2,w:a.w+4,d:a.d+4},S=SITE;
 const others=land.filter(r=>!(Math.abs(r.x-lot.x)<1e-6&&Math.abs(r.z-lot.z)<1e-6&&Math.abs(r.w-lot.w)<1e-6));
 const bound={x:envelope.x+S.edge,z:envelope.z+S.edge,w:envelope.w-2*S.edge,d:envelope.d-2*S.edge};
 // Grow the grounds one side at a time while they stay on the island and off other land.
 const site={...lot};const grown={w:0,e:0,n:0,s:0};
 for(let changed=true;changed;){
  changed=false;
  for(const side of ['w','e','n','s'] as const){
   if(grown[side]>=S.reach)continue;
   const t={...site},st=S.step,g=S.gap;
   // Only the new strip (and a gap beyond it) must be free: land already beside the lot stays put.
   let strip:Rect;
   if(side==='w'){t.x-=st;t.w+=st;strip={x:t.x-g,z:t.z,w:st+g,d:t.d};}
   else if(side==='e'){t.w+=st;strip={x:t.x+t.w-st,z:t.z,w:st+g,d:t.d};}
   else if(side==='n'){t.z-=st;t.d+=st;strip={x:t.x,z:t.z-g,w:t.w,d:st+g};}
   else{t.d+=st;strip={x:t.x,z:t.z+t.d-st,w:t.w,d:st+g};}
   const shrink={x:strip.x+1e-3,z:strip.z+1e-3,w:strip.w-2e-3,d:strip.d-2e-3};
   if(!inside(t,bound)||others.some(r=>overlaps(shrink,r)))continue;
   Object.assign(site,t);grown[side]+=S.step;changed=true;
  }
 }
 const placed:Rect[]=[lot];
 const clear=(r:Rect,pad=.4)=>inside(r,site)&&!placed.some(p=>overlaps(r,p,pad))&&!paving.some(p=>overlaps(r,p,.25))
  &&!paths.some(path=>[[r.x,r.z],[r.x+r.w,r.z],[r.x,r.z+r.d],[r.x+r.w,r.z+r.d],[r.x+r.w/2,r.z+r.d/2]].some(q=>distanceToRoad(q as Pt,path)<Math.max(r.w,r.d)/2+.6)||pathHits(path,r,.6));
 const [cx,cz]=stadiumCentre(a),gate=stadiumGate(a);
 /** Free spots for a w x d piece, nearest to a target first. */
 const spots=(w:number,d:number,near:Pt,pad=.4)=>{
  const out:Rect[]=[];
  for(let x=site.x;x+w<=site.x+site.w;x+=S.step)for(let z=site.z;z+d<=site.z+site.d;z+=S.step){const r={x,z,w,d};if(clear(r,pad))out.push(r);}
  return out.sort((p,q)=>Math.hypot(p.x+p.w/2-near[0],p.z+p.d/2-near[1])-Math.hypot(q.x+q.w/2-near[0],q.z+q.d/2-near[1]));
 };
 const boxes:SiteBox[]=[],pitches:Rect[]=[],parking:Rect[]=[],fountains:StadiumSite['fountains']=[];
 // Reflecting pools in arcs round the concourse, open at the gates.
 const o=STADIUM.concourse.outer,P=S.pools,ring={rx:o.rx*STADIUM_SCALE+P.grow,rz:o.rz*STADIUM_SCALE+P.grow};
 const feet=sideGateFeet().map(([x,z]):Pt=>[cx+x*STADIUM_SCALE,cz+z*STADIUM_SCALE]);
 for(let k=0;k<P.segments;k++){
  const a0=k/P.segments*Math.PI*2,a1=(k+1)/P.segments*Math.PI*2,am=(a0+a1)/2,[mx,mz]=[cx+ring.rx*Math.cos(am),cz+ring.rz*Math.sin(am)];
  if(Math.abs(mz-cz)<STADIUM.gate.width*STADIUM_SCALE/2+.5&&mx>cx||feet.some(f=>Math.hypot(f[0]-mx,f[1]-mz)<1.1))continue;
  if(paths.some(path=>distanceToRoad([mx,mz],path)<.5))continue;
  const [x0,z0]=[cx+ring.rx*Math.cos(a0),cz+ring.rz*Math.sin(a0)],[x1,z1]=[cx+ring.rx*Math.cos(a1),cz+ring.rz*Math.sin(a1)],len=Math.hypot(x1-x0,z1-z0)+.02,r=-Math.atan2(z1-z0,x1-x0);
  boxes.push({x:mx,z:mz,w:len,d:P.width+.12,c:'#d9d2c4',h:.05,r},{x:mx,z:mz,w:len,d:P.width,c:'#5aaac0',h:.065,r});
 }
 // Two training pitches, side by side or one above the other, as far from the main gate as the grounds allow.
 const T=S.pitch,far:Pt=[2*cx-gate[0],cz];
 const layouts=[{w:T.w*2+T.apron*3,d:T.d+T.apron*2,dx:T.w+T.apron,dz:0},{w:T.w+T.apron*2,d:T.d*2+T.apron*3,dx:0,dz:T.d+T.apron}];
 for(const L of layouts){
  const r=spots(L.w,L.d,far,.6)[0];if(!r)continue;
  placed.push(r);boxes.push({x:r.x+r.w/2,z:r.z+r.d/2,w:r.w,d:r.d,c:'#cfc8b8',h:.03});
  for(const k of [0,1]){
   const p={x:r.x+T.apron+k*L.dx,z:r.z+T.apron+k*L.dz,w:T.w,d:T.d};pitches.push(p);
   const mx=p.x+p.w/2,mz=p.z+p.d/2,line='#f3f1e6',t=.05,grass=k?'#3f7a4c':'#46845a';
   boxes.push({x:mx,z:mz,w:p.w,d:p.d,c:grass,h:.05},
    {x:mx,z:p.z,w:p.w,d:t,c:line,h:.056},{x:mx,z:p.z+p.d,w:p.w,d:t,c:line,h:.056},{x:p.x,z:mz,w:t,d:p.d,c:line,h:.056},{x:p.x+p.w,z:mz,w:t,d:p.d,c:line,h:.056},{x:mx,z:mz,w:t,d:p.d,c:line,h:.056},
    {x:p.x+.45,z:mz,w:.9,d:1.3,c:line,h:.054},{x:p.x+p.w-.45,z:mz,w:.9,d:1.3,c:line,h:.054},{x:p.x+.45,z:mz,w:.82,d:1.22,c:grass,h:.055},{x:p.x+p.w-.45,z:mz,w:.82,d:1.22,c:grass,h:.055});
  }
  break;
 }
 // Car parks near the main gate, with marked bays and a planted edge.
 const C=S.parking;
 for(const r of spots(C.w,C.d,gate,.5).filter((r,i,all)=>i===0||!overlaps(r,all[0],.6)).slice(0,2)){
  if(!clear(r,.5))continue;placed.push(r);parking.push(r);
  boxes.push({x:r.x+r.w/2,z:r.z+r.d/2,w:r.w,d:r.d,c:'#5d6266',h:.035});
  for(let x=r.x+C.bay;x<r.x+r.w-.05;x+=C.bay)for(const z of [r.z+.45,r.z+r.d-.45])boxes.push({x,z,w:.03,d:.8,c:'#e9e6dc',h:.04});
 }
 // Round fountain plazas on the open lawn.
 for(const r of spots(S.plaza.r*2,S.plaza.r*2,[cx,cz],.8).slice(0,40)){
  if(fountains.length>=3)break;if(!clear(r,.8))continue;
  placed.push(r);const x=r.x+r.w/2,z=r.z+r.d/2;fountains.push({x,z,k:1.1});
  // Three squares turned in step read as a round paved plaza.
  for(const k of [0,1,2])boxes.push({x,z,w:r.w*.92,d:r.d*.92,c:'#d9d2c4',h:.03,r:k*Math.PI/6});
 }
 // Groves over the rest of the grounds: mostly slim cone trees, a few round ones.
 const trees:StadiumSite['trees']=[],beds:Pt[]=[],G=S.grove;
 for(let x=site.x+.6;x<site.x+site.w-.4;x+=G.step)for(let z=site.z+.6;z<site.z+site.d-.4;z+=G.step){
  if(trees.length>=G.max)break;
  const jx=x+(hash(x,z)-.5)*.5,jz=z+(hash(z,x)-.5)*.5,h=hash(jx,jz);
  if(h>G.share)continue;
  if(!clear({x:jx-.25,z:jz-.25,w:.5,d:.5},.3))continue;
  if(h<.06)beds.push([jx,jz]);else trees.push({x:jx,z:jz,kind:h<.14?'round':'cone'});
 }
 return {site,boxes,pitches,parking,fountains,trees,beds};
}

/** Does a path pass through a rectangle (grown by pad)? Sampled along each segment. */
function pathHits(path:Pt[],r:Rect,pad:number){
 for(let i=1;i<path.length;i++){
  const [a,b]=[path[i-1],path[i]],n=Math.max(2,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.25));
  for(let k=0;k<=n;k++){const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;if(x>r.x-pad&&x<r.x+r.w+pad&&z>r.z-pad&&z<r.z+r.d+pad)return true;}
 }
 return false;
}
