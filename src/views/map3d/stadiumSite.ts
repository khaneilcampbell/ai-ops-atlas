import type {Rect} from './scene';
import type {Pt} from './roads';
import {distanceToRoad} from './highway';
import {STADIUM,STADIUM_SCALE,sideGateFeet,stadiumCentre} from './stadiumGeometry';
import {SITE_EDGE,type StadiumPlan} from './stadiumPlan';

/**
 * Atlas Stadium's grounds (KC, 2026-11-07: "utilize the whole space for the stadium ... like how
 * we did Atlas Marketplace"). After the city is laid out, the stadium takes the open land around
 * its lot, up to the neighbouring districts and the island edge, so nothing else moves. The stadium
 * sits in the middle of it (planStadium), ringed by reflecting pools as in KC's blueprint; the rest
 * stays open lawn (KC, 2026-11-07: pitches, car parks, plazas and groves removed).
 */
export const SITE={
 /** How far the grounds may reach past the stadium lot on each side. */
 reach:12,step:.5,gap:.5,edge:SITE_EDGE,
 pools:{grow:.55,width:.42,segments:44},
} as const;

export interface SiteBox {x:number;z:number;w:number;d:number;c:string;h?:number;r?:number}
export interface StadiumSite {
 site:Rect;
 /** Flat pieces on the ground, all g.box: the pool water and its rims. */
 boxes:SiteBox[];
 /** Palms round the plaza that survived the road, walk and station clean-up; set by the scene. */
 palms?:Pt[];
}

const overlaps=(a:Rect,b:Rect,gap=0)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.z<b.z+b.d+gap&&a.z+a.d+gap>b.z;
const inside=(a:Rect,b:Rect)=>a.x>=b.x&&a.z>=b.z&&a.x+a.w<=b.x+b.w&&a.z+a.d<=b.z+b.d;

export function planStadiumSite({stadium:a,land,envelope,paths}:{stadium:StadiumPlan;
 /** Every district, terrace and lot; the stadium's own lot is recognised and skipped. */
 land:Rect[];envelope:Rect;
 /** Roads, walks and station walks that cross open land: nothing is placed on them. */
 paths:Pt[][]}):StadiumSite{
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
 const [cx,cz]=stadiumCentre(a);
 // Trim the longer side so the stadium sits in the middle of its grounds.
 const ew=Math.min(cx-site.x,site.x+site.w-cx),ns=Math.min(cz-site.z,site.z+site.d-cz);
 Object.assign(site,{x:cx-ew,w:ew*2,z:cz-ns,d:ns*2});
 const boxes:SiteBox[]=[];
 // Reflecting pools in arcs round the concourse, open at the gates.
 const o=STADIUM.ring,P=S.pools,ring={rx:o.rx*STADIUM_SCALE+P.grow,rz:o.rz*STADIUM_SCALE+P.grow};
 const feet=sideGateFeet().map(([x,z]):Pt=>[cx+x*STADIUM_SCALE,cz+z*STADIUM_SCALE]);
 for(let k=0;k<P.segments;k++){
  const a0=k/P.segments*Math.PI*2,a1=(k+1)/P.segments*Math.PI*2,am=(a0+a1)/2,[mx,mz]=[cx+ring.rx*Math.cos(am),cz+ring.rz*Math.sin(am)];
  if(Math.abs(mz-cz)<STADIUM.gate.width*STADIUM_SCALE/2+.5&&mx>cx||feet.some(f=>Math.hypot(f[0]-mx,f[1]-mz)<1.1))continue;
  if(paths.some(path=>distanceToRoad([mx,mz],path)<.5))continue;
  const [x0,z0]=[cx+ring.rx*Math.cos(a0),cz+ring.rz*Math.sin(a0)],[x1,z1]=[cx+ring.rx*Math.cos(a1),cz+ring.rz*Math.sin(a1)],len=Math.hypot(x1-x0,z1-z0)+.02,r=-Math.atan2(z1-z0,x1-x0);
  boxes.push({x:mx,z:mz,w:len,d:P.width+.12,c:'#d9d2c4',h:.05,r},{x:mx,z:mz,w:len,d:P.width,c:'#5aaac0',h:.065,r});
 }
 return {site,boxes};
}
