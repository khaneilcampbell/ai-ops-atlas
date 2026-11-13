import {connectionSpans,splitAtLand} from './connectionGeometry';
import {distanceToRoad} from './highway';
import type {Inst} from './models';
import {isCommerceTower} from './commerceTowerPlan';
import {isGithubTower} from './githubTowerPlan';
import {isIntelligenceHub} from './intelligenceHubPlan';
import {isRibbonTower} from './ribbonTowerPlan';
import {ROAD_W,type Pt} from './roads';
import {TERRACE_H,type Scene3D,type Tower} from './scene';
import {TRANSPORT} from './transportScale';
import type {BuildingStyle} from './identity';

/**
 * Street architecture for the district roads (KC, 2026-11-08): a raised sidewalk along both sides of
 * every road on land, square paved corners where roads meet, zebra crossings on each arm of a
 * junction, and each tower's plaza paved in stone that matches its building. All flat boxes, so the
 * whole city adds a few thousand instances to two existing instanced meshes. World units.
 */
export const SIDEWALK={
 /** One sidewalk for every district street, shared with the bridge approach streets (models.tsx). */
 width:.18,y:TERRACE_H+.035,h:.035,color:'#d9d5c9',
 asphalt:'#424b50',zebra:'#f7f2df',
} as const;

/** Plaza stone per building style: field and the darker border band it sits in. */
export const PLAZA_STONE:Record<BuildingStyle,{field:string;border:string}>={
 tech:{field:'#7a838a',border:'#59626a'},       // dark granite under the circuit towers
 secure:{field:'#c3c8d0',border:'#8f97a3'},     // cool blue-grey setts
 timber:{field:'#c09673',border:'#8f6748'},     // warm brick pavers under the timber labs
 classic:{field:'#e8dfcc',border:'#c4b597'},    // limestone with a sandstone edge
 glass:{field:'#dde1dc',border:'#aeb6b0'},      // pale polished concrete
};

type R={x:number;z:number;w:number;d:number};
const minusRect=(r:R,c:R):R[]=>{
 const x0=Math.max(r.x,c.x),x1=Math.min(r.x+r.w,c.x+c.w),z0=Math.max(r.z,c.z),z1=Math.min(r.z+r.d,c.z+c.d);
 if(x1-x0<1e-6||z1-z0<1e-6)return [r];
 return [{x:r.x,z:r.z,w:x0-r.x,d:r.d},{x:x1,z:r.z,w:r.x+r.w-x1,d:r.d},{x:x0,z:r.z,w:x1-x0,d:z0-r.z},{x:x0,z:z1,w:x1-x0,d:r.z+r.d-z1}].filter(p=>p.w>.01&&p.d>.01);
};
/** A rectangle along an axis-aligned segment, `half` either side, reaching `reach` past each end. */
const along=(a:Pt,b:Pt,half:number,reach=0):R=>{
 const x0=Math.min(a[0],b[0]),x1=Math.max(a[0],b[0]),z0=Math.min(a[1],b[1]),z1=Math.max(a[1],b[1]);
 return a[1]===b[1]?{x:x0-reach,z:z0-half,w:x1-x0+2*reach,d:2*half}:{x:x0-half,z:z0-reach,w:2*half,d:z1-z0+2*reach};
};
const box=(r:R,y:number,h:number,c:string):Inst=>({p:[r.x+r.w/2,y,r.z+r.d/2],s:[r.w,h,r.d],c});
const straight=(a:Pt,b:Pt)=>Math.abs(a[0]-b[0])<1e-6||Math.abs(a[1]-b[1])<1e-6;
/** Each straight piece of a polyline as [a, b]. */
const segments=(roads:Pt[][])=>roads.flatMap(r=>r.slice(1).map((b,i)=>[r[i],b] as [Pt,Pt])).filter(([a,b])=>straight(a,b)&&Math.hypot(b[0]-a[0],b[1]-a[1])>1e-6);

/**
 * Sidewalks for the bridge-approach and plaza streets (models.tsx Bridges), on the same rules as the
 * district streets below (Khaneil, 2026-11-13): a sidewalk runs on round a corner where its street
 * meets another, and it never crosses a carriageway, so every junction opens cleanly instead of
 * kerb running across the mouth of a side street.
 */
export function bridgeStreetSidewalks(spans:{a:Pt;b:Pt}[],links:Pt[][]):Inst[]{
 const half=ROAD_W/2,sw=SIDEWALK.width,others=segments(links);
 const lines:[Pt,Pt][]=[...spans.map(s=>[s.a,s.b] as [Pt,Pt]),...others];
 const carriage:R[]=[...spans.filter(s=>straight(s.a,s.b)).map(s=>along(s.a,s.b,half,half)),...others.map(([a,b])=>along(a,b,TRANSPORT.cityWidth/2,TRANSPORT.cityWidth/2))];
 const out:Inst[]=[];
 spans.forEach((s,i)=>{
  if(!straight(s.a,s.b)||Math.hypot(s.b[0]-s.a[0],s.b[1]-s.a[1])<.01)return;
  const touches=(p:Pt)=>lines.some((l,j)=>j!==i&&distanceToRoad(p,l)<.01);
  const x=Math.abs(s.a[1]-s.b[1])<1e-6;
  const [a,b]=(x?s.a[0]<=s.b[0]:s.a[1]<=s.b[1])?[s.a,s.b]:[s.b,s.a];
  const la=touches(a)?half+sw:0,lb=touches(b)?half+sw:0;
  for(const side of [-1,1]){
   const off=side*(half+sw/2);
   const r:R=x?{x:a[0]-la,z:a[1]+off-sw/2,w:b[0]-a[0]+la+lb,d:sw}:{x:a[0]+off-sw/2,z:a[1]-la,w:sw,d:b[1]-a[1]+la+lb};
   let parts=[r];for(const c of carriage)parts=parts.flatMap(p=>minusRect(p,c));
   out.push(...parts.map(p=>box(p,SIDEWALK.y,SIDEWALK.h,SIDEWALK.color)));
  }
 });
 return out;
}

/** Towers with their own sculpted plaza design keep it. */
const customPlaza=(t:Tower)=>!!t.identity.landmark||isRibbonTower(t.projectId)||isCommerceTower(t.projectId)||isGithubTower(t.projectId)||isIntelligenceHub(t.projectId);

export function streetPavement(scene:Pick<Scene3D,'transportConnections'|'land'|'carBridges'|'towers'|'paving'|'freight'>):{pavement:Inst[];markings:Inst[];
 /** Centre of each junction arm's zebra, so a walk crossing there adds no second crossing. */
 zebras:Pt[]}{
 const half=TRANSPORT.cityWidth/2,sw=SIDEWALK.width;
 const streets=scene.freight?.streets??[],onStreet=(q:Pt)=>streets.some(st=>distanceToRoad(q,st)<1e-3);
 // District roads on land, as the deck renderer draws them (VenueBridge), less any already-marked street.
 const roads=splitAtLand(connectionSpans((scene.transportConnections??[]).map(l=>l.road)),scene.land)
  .filter(s=>s.onLand&&!(onStreet(s.a)&&onStreet(s.b)))
  .filter(s=>Math.hypot(s.b[0]-s.a[0],s.b[1]-s.a[1])>.05);
 const lines=roads.map(s=>[s.a,s.b] as Pt[]);
 const bridgeLines=segments((scene.carBridges??[]).flatMap(br=>br.roads));
 // A road that ends on a bridge street turns its sidewalks round that corner too.
 const frontage=segments((scene.transportConnections??[]).flatMap(l=>l.frontage?[l.frontage]:[]));
 const touches=(p:Pt,self:number)=>lines.some((l,i)=>i!==self&&distanceToRoad(p,l)<half+.01)||[...bridgeLines,...frontage].some(l=>distanceToRoad(p,l)<.01);
 // Everything a sidewalk must stay off: every carriageway (on land or not, frontage streets included),
 // its corner squares, and the bridge approaches and decks.
 const allStreets=segments((scene.transportConnections??[]).flatMap(l=>[l.road,...(l.frontage?[l.frontage]:[])]));
 const carriage:R[]=[...roads.map(s=>along(s.a,s.b,half,half)),...allStreets.map(([a,b])=>along(a,b,half,half)),
  ...(scene.carBridges??[]).flatMap(br=>[along(br.a,br.b,TRANSPORT.bridgeWidth/2,.04),...br.roads.flatMap(road=>road.slice(1).map((p,i)=>along(road[i],p,ROAD_W/2,ROAD_W/2)))])];
 const pavement:Inst[]=[],markings:Inst[]=[],zebras:Pt[]=[];
 roads.forEach((s,i)=>{
  const x=s.a[1]===s.b[1];
  // Run a sidewalk on past an end only where it turns a corner into another road; dead ends stop square.
  const lo=touches(s.a,i)?half+sw:0,hi=touches(s.b,i)?half+sw:0;
  const [a,b]=(x?s.a[0]<=s.b[0]:s.a[1]<=s.b[1])?[s.a,s.b]:[s.b,s.a];
  const [la,lb]=a===s.a?[lo,hi]:[hi,lo];
  for(const side of [-1,1]){
   const off=side*(half+sw/2);
   const r:R=x?{x:a[0]-la,z:a[1]+off-sw/2,w:b[0]-a[0]+la+lb,d:sw}:{x:a[0]+off-sw/2,z:a[1]-la,w:sw,d:b[1]-a[1]+la+lb};
   let parts=[r];for(const c of carriage)parts=parts.flatMap(p=>minusRect(p,c));
   pavement.push(...parts.map(p=>box(p,SIDEWALK.y,SIDEWALK.h,SIDEWALK.color)));
  }
  // Square asphalt where this road meets another, so corners are paved rather than notched.
  for(const end of [s.a,s.b])if(touches(end,i))markings.push(box({x:end[0]-half,z:end[1]-half,w:2*half,d:2*half},TERRACE_H+.055,.006,SIDEWALK.asphalt));
 });
 // Zebra crossings on every arm of a junction where three or four roads meet.
 const seen:Pt[]=[];
 const points=[...roads.flatMap(s=>[s.a,s.b])];
 for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
  const [p,q]=[roads[i],roads[j]];if((p.a[1]===p.b[1])===(q.a[1]===q.b[1]))continue;
  const h=p.a[1]===p.b[1]?p:q,v=h===p?q:p,cx=v.a[0],cz=h.a[1];
  if(cx>Math.min(h.a[0],h.b[0])+.01&&cx<Math.max(h.a[0],h.b[0])-.01&&cz>Math.min(v.a[1],v.b[1])+.01&&cz<Math.max(v.a[1],v.b[1])-.01)points.push([cx,cz]);
 }
 const onRoad=(q:Pt)=>[...lines,...bridgeLines].some(l=>distanceToRoad(q,l)<.01);
 const reach=half+sw+.32;
 for(const pt of points){
  if(seen.some(s=>Math.hypot(s[0]-pt[0],s[1]-pt[1])<half))continue;seen.push(pt);
  const arms=([[1,0],[-1,0],[0,1],[0,-1]] as const).filter(([dx,dz])=>onRoad([pt[0]+dx*reach,pt[1]+dz*reach]));
  if(arms.length<3)continue;
  for(const [dx,dz] of arms){
   const d=half+sw+.14;zebras.push([pt[0]+dx*d,pt[1]+dz*d]);
   for(let k=-2;k<=2;k++){
    const across=k*.13;
    markings.push({p:[pt[0]+dx*d+(dz?across:0),TERRACE_H+.061,pt[1]+dz*d+(dx?across:0)],s:dx?[.2,.006,.065]:[.065,.006,.2],c:SIDEWALK.zebra});
   }
  }
 }
 // Each tower's plaza in its building's stone: a border band of the plaza's own paving, then the field.
 for(const t of scene.towers){
  if(customPlaza(t))continue;
  const plaza=scene.paving.filter(p=>p.w>t.size&&Math.abs(p.x+p.w/2-t.x)<1e-6&&Math.abs(p.z+p.d/2-t.z)<1e-6&&Math.abs(p.w-p.d)<1e-6).sort((a,b)=>a.w-b.w)[0];
  if(!plaza)continue;
  const stone=PLAZA_STONE[t.identity.style],top=plaza.y+plaza.h,band=.07;
  const outer={x:plaza.x+.04,z:plaza.z+.04,w:plaza.w-.08,d:plaza.d-.08};
  const inner={x:outer.x+band,z:outer.z+band,w:outer.w-2*band,d:outer.d-2*band};
  // Keep clear of any road or sidewalk that crosses a plaza's edge.
  const clear=(r:R)=>{let parts=[r];for(const c of [...carriage,...roads.map(s=>along(s.a,s.b,half+sw,0))])parts=parts.flatMap(p=>minusRect(p,c));return parts;};
  pavement.push(...clear(outer).map(p=>box(p,top-.004,.008,stone.border)),...clear(inner).map(p=>box(p,top,.008,stone.field)));
 }
 return {pavement,markings,zebras};
}

/**
 * The pieces of a straight walk that are not laid lengthwise on a street (Khaneil, 2026-11-13: "remove
 * the sidewalk pavement that's in the middle of the street"). Where a walk runs along a carriageway,
 * the street's own sidewalks carry people, so that stretch is dropped; crossings are left to the caller.
 */
export function walkOffStreets(a:Pt,b:Pt,streets:[Pt,Pt][]):[Pt,Pt][]{
 if(!straight(a,b))return [[a,b]];
 const x=Math.abs(a[1]-b[1])<1e-6,k=x?0:1,lo=Math.min(a[k],b[k]),hi=Math.max(a[k],b[k]),c=a[1-k];
 const clear=TRANSPORT.cityWidth/2+TRANSPORT.walkWidth/2-.02;
 const cuts=streets.filter(([p,q])=>straight(p,q)&&(Math.abs(p[1]-q[1])<1e-6)===x&&Math.abs(p[1-k]-c)<clear)
  .map(([p,q])=>[Math.max(lo,Math.min(p[k],q[k])),Math.min(hi,Math.max(p[k],q[k]))]).filter(([s,e])=>e-s>1e-6).sort((u,v)=>u[0]-v[0]);
 const out:[number,number][]=[];let at=lo;
 for(const [s,e] of cuts){if(s-at>.05)out.push([at,s]);at=Math.max(at,e);}
 if(hi-at>.05||!cuts.length)out.push([at,hi]);
 const pt=(v:number):Pt=>x?[v,c]:[c,v];
 return out.map(([s,e])=>[pt(s),pt(e)]);
}
