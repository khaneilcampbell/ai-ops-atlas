import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {alignStreets,STREET_ALIGN,STREET_CLEAR} from './streetAlign';
import {distanceToRoad} from './highway';
import {planStreetLights} from './streetLighting';
import {streetPavement} from './streetPavement';
import {ROAD_W,type Pt} from './roads';

type Seg={id:string;a:Pt;b:Pt};
const segs=(paths:{id:string;pts:Pt[]}[]):Seg[]=>paths.flatMap(p=>p.pts.slice(1).map((b,i)=>({id:p.id,a:p.pts[i],b})));
/** Parallel axis-aligned runs that overlap along their length, `lo` to `hi` apart. */
function sideBySide(s:Seg[],lo:number,hi:number,others:Seg[]=s){
 const out:string[]=[];
 for(const p of s)for(const q of others){if(p===q)continue;
  const ph=Math.abs(p.a[1]-p.b[1])<1e-9,qh=Math.abs(q.a[1]-q.b[1])<1e-9;if(ph!==qh)continue;
  const k=ph?1:0,o=ph?0:1,off=Math.abs(p.a[k]-q.a[k]);if(off<=lo||off>=hi)continue;
  if(Math.min(Math.max(p.a[o],p.b[o]),Math.max(q.a[o],q.b[o]))-Math.max(Math.min(p.a[o],p.b[o]),Math.min(q.a[o],q.b[o]))>.05)out.push(`${p.id}/${q.id} ${off.toFixed(3)}`);}
 return out;
}

describe('one street per corridor',()=>{
 it('snaps a run beside an earlier one onto it, and moves a walk off the carriageway',()=>{
  const [a,b]=alignStreets([
   {id:'a',road:[[0,0],[0,10]],walk:[[.6,0],[.6,10]]},
   {id:'b',road:[[-5,2],[.1,2],[.1,8],[5,8]],walk:[[-5,3],[.1,3],[.1,7],[5,7]]},
  ]);
  expect(b.road).toEqual([[-5,2],[0,2],[0,8],[5,8]]);
  expect(b.walk).toEqual([[-5,3],[.6,3],[.6,7],[5,7]]);
  expect(a.road).toEqual([[0,0],[0,10]]);
 });
 it('never moves a path end or a run into a building',()=>{
  const [,b]=alignStreets([
   {id:'a',road:[[0,0],[0,10]],walk:[]},
   {id:'b',road:[[-5,2],[.1,2],[.1,8],[5,8]],walk:[]},
   {id:'c',road:[[.2,0],[.2,9]],walk:[]},
  ],[{x:-.3,z:5,w:.4,d:.4}]);
  expect(b.road).toEqual([[-5,2],[.1,2],[.1,8],[5,8]]);
 });
 const scene=buildScene(layoutMap(catalog,[],'district'));
 const roads=segs(scene.transportConnections.map(c=>({id:c.id,pts:c.road})));
 it('draws no two district roads a few centimetres apart',()=>{
  expect(sideBySide(roads,1e-6,STREET_ALIGN.road)).toEqual([]);
 });
 it('keeps every link walk off the carriageways between its two ends',()=>{
  // A walk's first and last runs meet a gate or door where it was routed, so they stay put.
  const walks=segs(scene.transportConnections.map(c=>({id:c.id,pts:c.walk}))).filter((w,i,all)=>i>0&&all[i-1].id===w.id&&i<all.length-1&&all[i+1].id===w.id);
  expect(sideBySide(walks,-1,STREET_ALIGN.walkClear-1e-6,roads)).toEqual([]);
 });
 it('paints one zebra per junction arm',()=>{
  const {zebras}=streetPavement(scene);
  for(let i=0;i<zebras.length;i++)for(let j=i+1;j<zebras.length;j++)expect(Math.hypot(zebras[i][0]-zebras[j][0],zebras[i][1]-zebras[j][1])).toBeGreaterThan(.3);
 });
 for(const group of ['district','tag'] as const)it(`keeps trees, bushes, rocks, bollards and lamps out of the streets: ${group}`,()=>{
  const s=group==='district'?scene:buildScene(layoutMap(catalog,[],group));
  const streets=[...s.transportConnections.map(c=>c.road),...s.carBridges.flatMap(b=>b.roads)],walks=s.transportConnections.map(c=>c.walk);
  const items=[...s.trees,...s.bushes,...s.rocks,...s.bollards].map(i=>[i.x,i.z] as Pt);
  expect(items.filter(p=>streets.some(r=>distanceToRoad(p,r)<STREET_CLEAR)||walks.some(w=>distanceToRoad(p,w)<.24))).toEqual([]);
  expect(planStreetLights(s).filter(l=>!l.highway&&streets.some(r=>distanceToRoad([l.x,l.z],r)<STREET_CLEAR))).toEqual([]);
 });
});

describe('walks beside streets sit flush against the sidewalk',()=>{
 // Before the final-pass reach (Khaneil, 2026-11-13) this measured about 170 (link walk beside a street with a
 // strip of grass between, per street piece); about 92 is left, held back by another street or a building.
 it('leaves little link walk running beside a street with grass between',()=>{
  const s=buildScene(layoutMap(catalog,[],'district'));
  const st=[...s.transportConnections.flatMap(c=>[c.road,...(c.frontage?[c.frontage]:[])]),...s.carBridges.flatMap(b=>b.roads)].flatMap(r=>r.slice(1).map((b,i)=>[r[i],b] as [Pt,Pt]));
  let gap=0;
  for(const c of s.transportConnections)for(let i=1;i<c.walk.length;i++){const a=c.walk[i-1],b=c.walk[i],x=Math.abs(a[1]-b[1])<1e-6,k=x?0:1;
   for(const [p,q] of st){if((Math.abs(p[1]-q[1])<1e-6)!==x)continue;const off=Math.abs(p[1-k]-a[1-k]),ov=Math.min(Math.max(p[k],q[k]),Math.max(a[k],b[k]))-Math.max(Math.min(p[k],q[k]),Math.min(a[k],b[k]));if(ov>ROAD_W&&off>STREET_ALIGN.walkSide+.02&&off<1.08)gap+=ov;}}
  expect(gap).toBeLessThan(100);
 });
});
