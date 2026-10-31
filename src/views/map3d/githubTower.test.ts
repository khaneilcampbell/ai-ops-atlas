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
