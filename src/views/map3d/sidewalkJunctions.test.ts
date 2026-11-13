import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {connectionSpans} from './connectionGeometry';
import {ROAD_W,type Pt} from './roads';
import {buildScene,TERRACE_H} from './scene';
import {distanceToRoad,roadIntersections} from './highway';
import {marinaSite} from './marinaPlan';
import {plazaRings} from './streetGraph';
import {bridgeStreetSidewalks,SIDEWALK,streetPavement,walkOffCarriageways,walkOffStreets} from './streetPavement';

// Sidewalks meet the streets cleanly (Khaneil, 2026-11-13): no kerb runs across a carriageway, and
// where one street ends on another the sidewalks turn the corner instead of stopping short.
const straight=(a:Pt,b:Pt)=>Math.abs(a[0]-b[0])<1e-6||Math.abs(a[1]-b[1])<1e-6;
const rect=(a:Pt,b:Pt,half:number)=>({x0:Math.min(a[0],b[0])-half,x1:Math.max(a[0],b[0])+half,z0:Math.min(a[1],b[1])-half,z1:Math.max(a[1],b[1])+half});

for(const g of ['district','tag','none'] as GroupBy[])describe(`sidewalks at junctions, ${g} grouping`,()=>{
 const scene=buildScene(layoutMap(catalog,[],g));
 const links=scene.transportConnections.flatMap(l=>[l.road,...(l.frontage?[l.frontage]:[])]);
 const spans=connectionSpans(scene.carBridges.flatMap(b=>b.roads));
 const walks=[...streetPavement(scene).pavement.filter(p=>p.c===SIDEWALK.color&&Math.abs(p.p[1]-SIDEWALK.y)<1e-6),...bridgeStreetSidewalks(spans,links)];
 const roads=[...links,...spans.map(s=>[s.a,s.b])].flatMap(r=>r.slice(1).map((b,i)=>[r[i],b] as [Pt,Pt])).filter(([a,b])=>straight(a,b));

 it('lays no sidewalk across a carriageway',()=>{
  const hits:string[]=[];
  for(const w of walks){
   const x0=w.p[0]-w.s[0]/2,x1=w.p[0]+w.s[0]/2,z0=w.p[2]-w.s[2]/2,z1=w.p[2]+w.s[2]/2;
   for(const [a,b] of roads){const r=rect(a,b,ROAD_W/2);if(Math.min(x1,r.x1)-Math.max(x0,r.x0)>.01&&Math.min(z1,r.z1)-Math.max(z0,r.z0)>.01)hits.push(`${w.p[0].toFixed(2)},${w.p[2].toFixed(2)} on ${a}-${b}`);}
  }
  expect(hits).toEqual([]);
 });

 it('ends every street on the street it runs into, never as a stub inside its carriageway',()=>{
  // A bridge road's plaza end is joined to the tower's plaza lane, where it was routed, so stays put.
  const lanes=[...plazaRings(scene).values()].map(g=>[[g.x0,g.z0],[g.x1,g.z0],[g.x1,g.z1],[g.x0,g.z1],[g.x0,g.z0]] as Pt[]);
  const paths=[...links,...scene.carBridges.flatMap(b=>b.roads)],stubs:string[]=[];
  paths.forEach((p,i)=>{for(const e of [p[0],p[p.length-1]]){
   if(lanes.some(l=>distanceToRoad(e,l)<.01))continue;
   const d=Math.min(...paths.filter((_,j)=>j!==i).flatMap(q=>q.slice(1).map((b,k)=>distanceToRoad(e,[q[k],b]))));
   if(d>.01&&d<ROAD_W)stubs.push(`${e} ${d.toFixed(2)}`);
  }});
  expect(stubs).toEqual([]);
 });
});

describe('walks off the street',()=>{
 it('drops the stretch of a walk laid along a carriageway and keeps the rest',()=>{
  expect(walkOffStreets([0,0],[10,0],[[[2,0],[6,0]]])).toEqual([[[0,0],[2,0]],[[6,0],[10,0]]]);
  expect(walkOffStreets([0,1],[10,1],[[[2,0],[6,0]]])).toEqual([[[0,1],[10,1]]]);
  expect(walkOffStreets([3,-5],[3,5],[[[0,0],[10,0]]])).toEqual([[[3,-5],[3,5]]]);
 });
 const scene=buildScene(layoutMap(catalog,[],'district'));
 it('leaves no walk running down the middle of a street',()=>{
  const streets=[...scene.transportConnections.flatMap(l=>[l.road,...(l.frontage?[l.frontage]:[])]),...scene.carBridges.flatMap(b=>b.roads)].flatMap(r=>r.slice(1).map((b,i)=>[r[i],b] as [Pt,Pt]));
  const on=connectionSpans(scene.transportConnections.map(l=>l.walk)).flatMap(s=>walkOffStreets(s.a,s.b,streets))
   .filter(([a,b])=>streets.some(([p,q])=>straight(p,q)&&straight(a,b)&&(p[1]===q[1])===(a[1]===b[1])&&distanceToRoad([(a[0]+b[0])/2,(a[1]+b[1])/2],[p,q])<ROAD_W/2));
  expect(on).toEqual([]);
 });
});

describe('station plaza to the boat dock',()=>{
 const scene=buildScene(layoutMap(catalog,[],'district'));
 const m=marinaSite(scene,TERRACE_H);
 const streets=scene.transportConnections.flatMap(l=>[l.road,...(l.frontage?[l.frontage]:[])]);
 it('starts the marina walk at the coast, clear of every street',()=>{
  const walk:Pt[]=[[m.x,m.cityWalkZ],[m.x,m.shoreZ]];
  expect(streets.filter(r=>distanceToRoad(walk[0],r)<ROAD_W/2+.3||roadIntersections(walk,r).length)).toEqual([]);
 });
 it('paves a walk from the station forecourt to the marina stair',()=>{
  const p=scene.stationPlaza!,w=scene.walks;
  expect(w.some(s=>Math.abs(s.x0-(p.bounds.x+p.bounds.w))<1e-6&&s.x1===m.x)).toBe(true);
  expect(w.some(s=>s.x0===m.x&&s.x1===m.x&&Math.max(s.z0,s.z1)>=m.cityWalkZ)).toBe(true);
 });
});

describe('station paths stay off the streets',()=>{
 it('lays no station path slab on any carriageway, in district and tag groupings',()=>{
  for(const g of ['district','tag'] as const){
   const s=buildScene(layoutMap(catalog,[],g));
   const roads=[...s.transportConnections.flatMap(l=>[l.road,...(l.frontage?[l.frontage]:[])]),...s.carBridges.flatMap(b=>b.roads)];
   const segs=roads.flatMap(r=>r.slice(1).map((b,i)=>[r[i],b] as [Pt,Pt]));
   const along:string[]=[];
   for(const st of s.communityRail?.loop?.stops??[]){const p=st.walk.filter(q=>q[1]===0).map(q=>[q[0],q[2]] as Pt);
    // Every station path slab the renderer lays stays off every carriageway rectangle (junction squares included).
    for(let i=1;i<p.length;i++)for(const [a,b] of walkOffCarriageways(p[i-1],p[i],segs,.48))for(let k=0;k<=20;k++){const q:Pt=[a[0]+(b[0]-a[0])*k/20,a[1]+(b[1]-a[1])*k/20];
     const x=Math.abs(a[1]-b[1])<1e-6;for(const off of [-.23,0,.23]){const e:Pt=x?[q[0],q[1]+off]:[q[0]+off,q[1]];
      if(segs.some(([u,v])=>straight(u,v)&&e[0]>Math.min(u[0],v[0])-ROAD_W/2+.01&&e[0]<Math.max(u[0],v[0])+ROAD_W/2-.01&&e[1]>Math.min(u[1],v[1])-ROAD_W/2+.01&&e[1]<Math.max(u[1],v[1])+ROAD_W/2-.01))along.push(`${g} ${st.id} ${e.map(v=>v.toFixed(2))}`);}}}
   expect(along.slice(0,5)).toEqual([]);
  }
 });
});
