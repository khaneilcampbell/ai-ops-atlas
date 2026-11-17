import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {planOffice} from './model';
import {HQ_INTERIOR,core,glassHeight,isAtlasHq,isPanel,isTall,shellOutline,shellValue} from './atlasHqInteriorPlan';
import {HQ} from '../map3d/atlasHqPlan';

const project=catalog.projects.find(p=>p.id==='ai-ops-atlas')!;
const agents=catalog.agents.filter(a=>a.projectId===project.id);
const plan=planOffice(project,agents);

describe('Atlas HQ interior',()=>{
 it('only applies to Atlas HQ',()=>{expect(isAtlasHq('ai-ops-atlas')).toBe(true);expect(isAtlasHq('benjaire-site')).toBe(false);});
 it('wraps every desk, the rack and the plants inside the glass',()=>{
  for(const ws of plan.workstations)expect(shellValue(plan.w,plan.d,Math.abs(ws.x)+.8,Math.abs(ws.z)+.6)).toBeLessThan(1);
  const {w,d}=plan;
  for(const [x,z] of [[-w/2+.69,-d/2+.69],[w/2-.5,-d/2+.5],[-w/2+.5,d/2-.5],[-w/2+1.35,-d/2+.45]])expect(shellValue(w,d,x,z)).toBeLessThan(1);
  // The core stands inside the glass, behind the wall display.
  const c=core(d);expect(shellValue(w,d,c.w/2,c.z-c.depth/2)).toBeLessThan(1);expect(c.z+c.depth/2).toBeLessThanOrEqual(-d/2+.03);
 });
 it('shares the facade: outline, mullion points, green panels and floor count',()=>{
  expect(shellOutline(plan.w,plan.d)).toHaveLength(HQ.plate.points);
  expect(HQ_INTERIOR.floors).toBe(HQ.plate.levels);expect(HQ_INTERIOR.roundness).toBe(HQ.plate.roundness);
  const panels=Array.from({length:HQ_INTERIOR.points},(_,i)=>i).filter(isPanel);
  expect(panels).toHaveLength(HQ.plate.points/HQ.panelEvery);
 });
 it('keeps the camera side open, the lobby double height and every glass wall under the floor above',()=>{
  expect(isTall(HQ_INTERIOR.points/4)).toBe(true);expect(isTall(HQ_INTERIOR.points/2)).toBe(true);
  expect(isTall(0)).toBe(false);expect(isTall(HQ_INTERIOR.points*3/4)).toBe(false);
  expect(glassHeight(0)).toBe(HQ_INTERIOR.lobbyHeight);
  for(let l=1;l<HQ_INTERIOR.floors;l++)expect(glassHeight(l)).toBe(HQ_INTERIOR.height);
  for(let l=0;l<HQ_INTERIOR.floors;l++)expect(glassHeight(l)).toBeLessThan(HQ.plate.level);
 });
});
