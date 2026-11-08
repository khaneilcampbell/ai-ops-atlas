import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {planOffice} from './model';
import {HQ_INTERIOR,core,glassHeight,goldReach,isAtlasHq,isGold,isTall,shellAxes,shellOutline,shellValue,terrace} from './atlasHqInteriorPlan';
import {wingSway} from '../map3d/atlasHqPlan';

const project=catalog.projects.find(p=>p.id==='ai-ops-atlas')!;
const agents=catalog.agents.filter(a=>a.project===project.id);
const plan=planOffice(project,agents);

describe('Atlas HQ interior',()=>{
 it('only applies to Atlas HQ',()=>{expect(isAtlasHq('ai-ops-atlas')).toBe(true);expect(isAtlasHq('benjaire-site')).toBe(false);});
 it('wraps every desk, the rack and the plants inside the curved glass',()=>{
  for(const ws of plan.workstations)expect(shellValue(plan.w,plan.d,Math.abs(ws.x)+.8,Math.abs(ws.z)+.6)).toBeLessThan(1);
  const {w,d}=plan;
  for(const [x,z] of [[-w/2+.69,-d/2+.69],[w/2-.5,-d/2+.5],[-w/2+.5,d/2-.5],[-w/2+1.35,-d/2+.45]])expect(shellValue(w,d,x,z)).toBeLessThan(1);
  // The core stands inside the glass, behind the wall display.
  const c=core(d);expect(shellValue(w,d,c.w/2,c.z-c.depth/2)).toBeLessThan(1);expect(c.z+c.depth/2).toBeLessThanOrEqual(-d/2+.03);
 });
 it('moves the gold glass floor by floor along the same S the wing sways through outside',()=>{
  const reach=[1,2,3,4].map(goldReach);
  // The wing leans furthest east around Floor 3, least at Floor 1: least and most gold.
  expect(Math.max(...reach)).toBe(goldReach(1));expect(Math.min(...reach)).toBe(goldReach(3));
  for(const l of [1,2,3,4])for(const m of [1,2,3,4])if(wingSway((l+.5)/5).x<wingSway((m+.5)/5).x)expect(goldReach(l)).toBeGreaterThan(goldReach(m));
  // The lobby is gold all round, like the gold lobby glazing outside.
  for(let i=0;i<HQ_INTERIOR.points;i++)expect(isGold(i,0)).toBe(true);
  expect(isGold(HQ_INTERIOR.points/2,2)).toBe(false);
 });
 it('keeps the camera side open and raises the top floor under the sloping roof',()=>{
  expect(isTall(HQ_INTERIOR.points/4)).toBe(true);expect(isTall(HQ_INTERIOR.points/2)).toBe(true);
  expect(isTall(0)).toBe(false);expect(isTall(HQ_INTERIOR.points*3/4)).toBe(false);
  const {a}=shellAxes(plan.w,plan.d);
  expect(glassHeight(-a,4,plan.w,plan.d)).toBeCloseTo(HQ_INTERIOR.height+HQ_INTERIOR.roofRise);
  expect(glassHeight(a,4,plan.w,plan.d)).toBeCloseTo(HQ_INTERIOR.height);
  expect(glassHeight(0,0,plan.w,plan.d)).toBe(HQ_INTERIOR.lobbyHeight);
  // Lobby glass stays under the floor above (3.4 apart).
  expect(HQ_INTERIOR.lobbyHeight).toBeLessThan(3.4);
 });
 it('puts the podium roof garden off the east side of Floor 3, outside the glass',()=>{
  const T=terrace(plan.w,plan.d),{a}=shellAxes(plan.w,plan.d);
  expect(T.x1).toBeGreaterThan(a);for(const [x,z] of T.trees){expect(shellValue(plan.w,plan.d,x,z)).toBeGreaterThan(1);expect(x).toBeLessThan(T.x1);expect(z).toBeGreaterThan(T.z0);expect(z).toBeLessThan(T.z1);}
  expect(shellOutline(plan.w,plan.d)).toHaveLength(HQ_INTERIOR.points);
 });
});
