import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {FINANCIAL_BUILDINGS,headquartersEnvelope} from './financialPlan';
import {GITHUB_TOWER,boxSide,githubTowerHeight,githubTowerTop,planGithubTower} from './githubTowerPlan';
import {githubTowerGeometry} from './githubTowerGeometry';
import {towerRing} from './roads';
import {TRANSPORT} from './transportScale';

const scene=buildScene(layoutMap(catalog));
const tower=scene.towers.find(t=>t.projectId===GITHUB_TOWER.projectId)!;
const plan=planGithubTower(tower.size,tower.customHeight!);

describe('GitHub tower',()=>{
 it('stands with the Financial District: taller than before, under its shortest tower',()=>{
  const reference=scene.financial!.referenceHeight;
  expect(tower.customHeight).toBeCloseTo(githubTowerHeight(reference));
  // Taller than the plain tower it replaces, and at Financial scale, whatever the city scale (#160).
  expect(tower.customHeight!).toBeGreaterThan(tower.height);
  expect(githubTowerTop(tower.customHeight!)).toBeGreaterThan(reference*.9);
  const shortest=Math.min(...scene.financial!.buildings.map(b=>b.height));
  expect(githubTowerTop(tower.customHeight!)).toBeLessThan(shortest);
  // Atlas HQ's roof stands at the reference itself (#159), so the GitHub crown stays under it.
  expect(githubTowerTop(tower.customHeight!)).toBeLessThan(reference);
  // Its own custom height never feeds back into the reference the Financial District rises from.
  expect(headquartersEnvelope(scene.towers)).toBeCloseTo(reference);
  expect(Math.min(...FINANCIAL_BUILDINGS.map(b=>b.rise))).toBeGreaterThan(GITHUB_TOWER.share);
 });

 it('keeps every piece inside the ring road around it, so district traffic stays outside the walls',()=>{
  const ring=towerRing({x:0,z:0,size:tower.size},(tower.size/.92)*1.25+1)!;
  const clear=ring.x1-TRANSPORT.cityWidth/2;
  for(const b of [...plan.podium,...plan.boxes,...plan.terraces,plan.core,...plan.planters]){
   for(const v of [b.x0,b.x1,b.z0,b.z1])expect(Math.abs(v)).toBeLessThan(clear);
  }
 });

 it('alternates its boxes left and right, each sitting on the one below, up to the roof',()=>{
  expect(plan.storeys).toBeGreaterThanOrEqual(12);
  for(const [i,b] of plan.boxes.entries()){
   expect(Math.sign((b.x0+b.x1)/2)).toBe(boxSide(i));
   if(i)expect(b.y0).toBeCloseTo(plan.boxes[i-1].y1);
   if(i){const below=plan.boxes[i-1];expect(Math.min(b.x1,below.x1)-Math.max(b.x0,below.x0)).toBeGreaterThan(.2*tower.size);}
  }
  expect(plan.boxes.at(-1)!.y1).toBeCloseTo(plan.height);
  expect(plan.boxes[0].y0).toBeCloseTo(plan.base);
 });

 it('climbs each terrace with a staircase from its outer edge to the next roof, with yellow cushions',()=>{
  for(const [i,s] of plan.stairs.entries()){
   const t=plan.terraces[i];
   expect(s.side).toBe(-boxSide(i));
   expect(s.steps).toHaveLength(GITHUB_TOWER.stair.steps);
   // First step starts at the terrace floor at the outer edge; the last reaches the box roof.
   expect(Math.abs(s.from[0])).toBeCloseTo(.5*tower.size);
   expect(s.steps.at(-1)!.y1).toBeCloseTo(t.y1);
   for(const st of s.steps){expect(st.x0).toBeGreaterThanOrEqual(t.x0-1e-9);expect(st.x1).toBeLessThanOrEqual(t.x1+1e-9);}
   for(let j=1;j<s.steps.length;j++)expect(s.steps[j].y1).toBeGreaterThan(s.steps[j-1].y1);
   expect(s.cushions.length).toBeGreaterThan(0);
  }
 });

 it('grows each terrace tree under the box above it, clear of the stairs',()=>{
  for(const [i,t] of plan.terraces.entries()){
   const tree=plan.trees[i],top=tree.y+tree.trunk+tree.crown*1.2;
   expect(top).toBeLessThan(t.y1);
   expect(tree.z+tree.crown).toBeLessThan(GITHUB_TOWER.stair.z0*tower.size);
   expect(tree.x).toBeGreaterThan(t.x0);expect(tree.x).toBeLessThan(t.x1);
  }
 });

 it('stays within a small draw budget',()=>{
  const geo=githubTowerGeometry(plan);
  const tris=Object.values(geo).reduce((n,g)=>n+g.getAttribute('position').count/3,0);
  expect(Object.keys(geo)).toHaveLength(5);
  expect(tris).toBeLessThan(40000);
  for(const g of Object.values(geo))g.dispose();
 });
});

describe('GitHub glass podium and its new land',()=>{
 const city=buildScene(layoutMap(catalog,[],'district'));
 const t=city.towers.find(x=>x.projectId===GITHUB_TOWER.projectId)!;
 const own=city.terraces.find(x=>x.id===GITHUB_TOWER.projectId)!;
 const annex=city.githubAnnex!;
 const within=(b:{x0:number;x1:number;z0:number;z1:number},r:{x:number;z:number;w:number;d:number})=>b.x0>=r.x-1e-9&&b.x1<=r.x+r.w+1e-9&&b.z0>=r.z-1e-9&&b.z1<=r.z+r.d+1e-9;
 it('grows the GitHub terrace onto open ground in the default By district map',()=>{
  expect(annex).toBeDefined();
  expect(city.terraces.filter(x=>x.id===GITHUB_TOWER.projectId)).toHaveLength(2);
  expect(city.land).toContainEqual(annex.land);
  // Nothing else stands, grows or drives on the new land.
  for(const r of city.terraces)if(r.id!==GITHUB_TOWER.projectId)expect(r.x<annex.land.x+annex.land.w&&r.x+r.w>annex.land.x&&r.z<annex.land.z+annex.land.d&&r.z+r.d>annex.land.z).toBe(false);
  const on=(x:number,z:number)=>x>annex.land.x&&x<annex.land.x+annex.land.w&&z>annex.land.z&&z<annex.land.z+annex.land.d;
  for(const p of [...city.trees,...city.bushes,...city.rocks])expect(on(p.x,p.z)).toBe(false);
  for(const b of [...city.towers,...city.kiosks,...city.retail])expect(on(b.x,b.z)).toBe(false);
  for(const r of city.carBridges.flatMap(b=>b.roads).flat())expect(on(r[0],r[1])).toBe(false);
  for(const w of city.walks)for(const p of w.route??[])expect(on(p.gx,p.gy)).toBe(false);
 });
 it('stands three storeys of glass on the GitHub land, clear of the ring road, stepping back',()=>{
  const ring=towerRing(t,(t.size/.92)*1.25+1)!,road=ring.x1-t.x+TRANSPORT.cityWidth/2;
  const ground={x:Math.min(own.x,annex.terrace.x),z:Math.min(own.z,annex.terrace.z),w:own.w+(annex.side.endsWith('x')?annex.terrace.w:0),d:own.d+(annex.side.endsWith('z')?annex.terrace.d:0)};
  expect(annex.tiers).toHaveLength(3);
  for(const [i,b] of annex.tiers.entries()){
   expect(within(b,ground)).toBe(true);
   // Outside the ring road on every side.
   expect(Math.max(Math.abs(b.x0-t.x),Math.abs(b.x1-t.x),Math.abs(b.z0-t.z),Math.abs(b.z1-t.z))).toBeGreaterThan(road);
   const nearest=annex.side.endsWith('x')?Math.min(Math.abs(b.x0-t.x),Math.abs(b.x1-t.x)):Math.min(Math.abs(b.z0-t.z),Math.abs(b.z1-t.z));
   expect(nearest).toBeGreaterThan(road);
   if(i){const below=annex.tiers[i-1];expect(b.y0).toBeCloseTo(below.y1);expect((b.x1-b.x0)*(b.z1-b.z0)).toBeLessThan((below.x1-below.x0)*(below.z1-below.z0));}
  }
  // The skybridge clears traffic on the ring road beneath it.
  expect(annex.skybridge.y0).toBeGreaterThan(.5);
 });
});
