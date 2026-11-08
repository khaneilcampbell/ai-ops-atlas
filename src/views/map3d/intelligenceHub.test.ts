import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene,FLOOR_H} from './scene';
import {headquartersEnvelope} from './financialPlan';
import {INTELLIGENCE_HUB,faces,hubOutline,intelligenceHubHeight,intelligenceHubTop,offsetPolygon,planIntelligenceHub} from './intelligenceHubPlan';
import {allGeometries,intelligenceHubGeometry,windowKey} from './intelligenceHubGeometry';
import {towerRing} from './roads';
import {TRANSPORT} from './transportScale';

const scene=buildScene(layoutMap(catalog));
const tower=scene.towers.find(t=>t.projectId===INTELLIGENCE_HUB.projectId)!;
const plan=planIntelligenceHub(tower.size,tower.customHeight!);

describe('Intelligence Hub',()=>{
 it('stands with the Financial District, under its shortest tower and under Atlas HQ',()=>{
  const reference=scene.financial!.referenceHeight;
  expect(tower.customHeight).toBeCloseTo(intelligenceHubHeight(reference));
  expect(tower.customHeight!).toBeGreaterThan(tower.height);
  const shortest=Math.min(...scene.financial!.buildings.map(b=>b.height));
  expect(intelligenceHubTop(tower.customHeight!)).toBeLessThan(shortest);
  expect(tower.customHeight!).toBeLessThan(reference);
  // Its own custom height never feeds back into the reference the Financial District rises from.
  expect(headquartersEnvelope(scene.towers)).toBeCloseTo(reference);
 });

 it('has more floors than the 14-storey tower it replaces, of a believable height',()=>{
  expect(tower.floors).toBe(14);
  // A ground floor plus the storeys above it.
  expect(plan.storeys+1).toBeGreaterThan(tower.floors);
  expect(plan.storey).toBeGreaterThan(FLOOR_H*.85);
  expect(plan.storey).toBeLessThan(FLOOR_H*1.1);
  expect(plan.lines).toHaveLength(plan.storeys+1);
  expect(plan.lines.at(-1)!+INTELLIGENCE_HUB.parapet).toBeCloseTo(plan.roof);
  expect(plan.rearTop).toBeLessThan(plan.roof);
 });

 it('keeps its footprint: every face, band and bay inside the ring road around it',()=>{
  const ring=towerRing({x:0,z:0,size:tower.size},(tower.size/.92)*1.25+1)!;
  const clear=ring.x1-TRANSPORT.cityWidth/2,k=plan.k,I=INTELLIGENCE_HUB;
  const band=offsetPolygon(plan.outline,[I.band.out*k,I.band.out*k,I.band.corner*k,I.band.out*k,I.band.out*k]);
  for(const [x,z] of band){expect(Math.abs(x)).toBeLessThan(clear);expect(Math.abs(z)).toBeLessThan(clear);}
  for(const [x,z] of band)expect(Math.max(Math.abs(x),Math.abs(z))).toBeLessThan(.53*k);
 });

 it('cuts the corner the map looks at and puts one planted loggia on it every floor',()=>{
  const corner=faces(hubOutline(1))[2];
  expect(corner.n[0]).toBeCloseTo(Math.SQRT1_2);
  expect(corner.n[1]).toBeCloseTo(Math.SQRT1_2);
  expect(plan.bays).toHaveLength(plan.storeys);
  for(const b of plan.bays)expect(b.angle).toBeCloseTo(Math.PI/4);
  // Each bay sits inside its own storey.
  for(const [i,b] of plan.bays.entries()){expect(b.y0).toBeGreaterThan(plan.lines[i]);expect(b.y1).toBeLessThan(plan.lines[i+1]);}
 });

 it('offsets a face outward by its own distance',()=>{
  const sq=offsetPolygon([[-1,-1],[1,-1],[1,1],[-1,1]],[.5,.5,.5,.5]);
  expect(sq).toEqual([[-1.5,-1.5],[1.5,-1.5],[1.5,1.5],[-1.5,1.5]]);
 });

 it('draws repeated parts as instances of a few shared geometries, within a small memory budget',()=>{
  const geo=intelligenceHubGeometry(plan);
  // One frame geometry per window size, however many floors.
  expect(Object.keys(geo.windowRings).sort()).toEqual([...new Set(plan.windows.map(windowKey))].sort());
  expect(Object.keys(geo.windowRings).length).toBeLessThanOrEqual(4);
  let tris=0,bytes=0;
  for(const g of allGeometries(geo)){
   const n=g.index?g.index.count:g.getAttribute('position').count;tris+=n/3;expect(n).toBeGreaterThan(0);
   for(const a of Object.values(g.attributes))bytes+=a.array.byteLength;if(g.index)bytes+=g.index.array.byteLength;
  }
  // The whole map has 8 MB of geometry to spend (visual/perf.visual.ts) and main already uses 7.9.
  expect(tris).toBeLessThan(4_000);
  expect(bytes).toBeLessThan(150_000);
  for(const g of allGeometries(geo))g.dispose();
 });
});
