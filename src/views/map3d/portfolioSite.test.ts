import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene,FLOOR_H} from './scene';
import {headquartersEnvelope} from './financialPlan';
import {PORTFOLIO_SITE,planPortfolioSite,portfolioSiteReach,portfolioSiteTop} from './portfolioSitePlan';
import {towerRing} from './roads';
import {TRANSPORT} from './transportScale';

const scene=buildScene(layoutMap(catalog));
const tower=scene.towers.find(t=>t.projectId===PORTFOLIO_SITE.projectId)!;
const plan=planPortfolioSite();

describe('Portfolio Site',()=>{
 it('is a ground floor plus twelve floors of a believable height, near the old tower',()=>{
  expect(plan.roof).toBeGreaterThan(tower.floors*FLOOR_H*.95);
  expect(plan.lines).toHaveLength(PORTFOLIO_SITE.floors+1);
  expect(PORTFOLIO_SITE.storey).toBeGreaterThan(FLOOR_H*.95);
  expect(PORTFOLIO_SITE.storey).toBeLessThan(FLOOR_H*1.15);
  expect(planPortfolioSite(tower.customHeight).top).toBeCloseTo(scene.towers.find(t=>t.projectId==='intelligence-hub')!.customHeight!);
  expect(plan.top).toBeCloseTo(portfolioSiteTop());
  expect(plan.top).toBeGreaterThan(plan.roof);
 });

 it('keeps the matched-height façade valid without adding floors',()=>{
  const matched=planPortfolioSite(tower.customHeight);
  expect(matched.lines).toHaveLength(PORTFOLIO_SITE.floors+1);
  expect(matched.roof).toBeGreaterThan(plan.roof);
  for(const box of matched.boxes)expect(box.y1).toBeGreaterThan(box.y0);
 });

 it('does not move the Financial District reference height',()=>{
  expect(headquartersEnvelope(scene.towers)).toBeCloseTo(scene.financial!.referenceHeight);
 });

 it('keeps its footprint inside the ring road',()=>{
  const reach=portfolioSiteReach(plan);
  expect(reach).toBeLessThanOrEqual(.53);
  const ring=towerRing({x:0,z:0,size:tower.size},(tower.size/.92)*1.25+1)!;
  expect(reach*tower.size).toBeLessThan(ring.x1-TRANSPORT.cityWidth/2);
 });

 it('has a balcony and a framed window on every floor, and lit glass all round',()=>{
  const glass=plan.panels.filter(p=>p.kind==='glass');
  // Front left, front middle, two side bays and the back, every floor.
  expect(glass).toHaveLength(PORTFOLIO_SITE.floors*5);
  const rails=plan.boxes.filter(b=>b.kind==='rail');
  expect(rails).toHaveLength(PORTFOLIO_SITE.floors*3);
  for(const b of plan.boxes){expect(b.x1).toBeGreaterThan(b.x0);expect(b.y1).toBeGreaterThan(b.y0);expect(b.z1).toBeGreaterThan(b.z0);}
 });

 it('zigzags the middle frames every two floors',()=>{
  const centres=plan.panels.filter(p=>p.kind==='glass'&&p.face==='front'&&Math.abs(p.x-PORTFOLIO_SITE.middle.x)<.05).map(p=>p.x);
  expect(centres).toHaveLength(PORTFOLIO_SITE.floors);
  expect(centres[0]).toBeCloseTo(centres[1]);
  expect(centres[2]).not.toBeCloseTo(centres[1]);
 });

 it('stays a light building: a few hundred instanced parts, a handful of round shapes',()=>{
  expect(plan.boxes.length).toBeLessThan(220);
  expect(plan.plants.filter(p=>p.kind==='tree').length).toBeLessThanOrEqual(2);
  expect(plan.plants.filter(p=>p.kind==='shrub').length).toBeLessThan(60);
 });
});
