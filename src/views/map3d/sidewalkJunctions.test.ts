import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {connectionSpans} from './connectionGeometry';
import {ROAD_W,type Pt} from './roads';
import {buildScene} from './scene';
import {bridgeStreetSidewalks,SIDEWALK,streetPavement} from './streetPavement';

// Sidewalks meet the streets cleanly (Khaneil, 2026-11-13): no kerb runs across a carriageway, and
// where one street ends on another the sidewalks turn the corner instead of stopping short.
const straight=(a:Pt,b:Pt)=>Math.abs(a[0]-b[0])<1e-6||Math.abs(a[1]-b[1])<1e-6;
const rect=(a:Pt,b:Pt,half:number)=>({x0:Math.min(a[0],b[0])-half,x1:Math.max(a[0],b[0])+half,z0:Math.min(a[1],b[1])-half,z1:Math.max(a[1],b[1])+half});

for(const g of ['district','tag'] as GroupBy[])describe(`sidewalks at junctions, ${g} grouping`,()=>{
 const scene=buildScene(layoutMap(catalog,[],g));
 const links=scene.transportConnections.map(l=>l.road);
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
});
