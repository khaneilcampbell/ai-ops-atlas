import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {COMMUNITY as C,COMMUNITY_BUILDINGS,railState} from './hillsCommunityPlan';
import {financialDimensions} from './financialArchitecture';
import {HILLS} from './hillsPlan';
import {pathClear,type Pt} from './roads';
import {COMMUTER_TOWERS,RAIL_COMMUTERS,commuterAt,commuterTimes,planRailCommuters} from './railCommuters';
const ground=(points:[number,number,number][])=>points.filter(p=>p[1]===0).map(p=>[p[0],p[2]] as Pt);
describe('rail commuters',()=>{
 it('waits 15 seconds at each stop',()=>{expect(C.dwell).toBe(15);const length=100,travel=length/C.speed;expect(railState(14.9,length).phase).toBe('hills');expect(railState(15.1,length).phase).toBe('outbound');expect(railState(15+travel+14.9,length).phase).toBe('financial');expect(railState(30+travel+.1,length).phase).toBe('return');});
 for(const group of ['none','district','status','tag'] as GroupBy[])it(`two groups of six reach each train from different places at their own pace: ${group}`,()=>{
  const s=buildScene(layoutMap(catalog,[],group)),f=s.financial!,c=s.community!,plan=planRailCommuters(c,f,s.communityRail)!;
  expect(plan.commuters).toHaveLength(12);
  for(const g of [0,1]){const people=plan.commuters.filter(p=>p.group===g);expect(people).toHaveLength(6);
   // A group rides out together; the two groups ride different trains.
   expect(new Set(people.map(p=>p.offset)).size).toBe(1);
   const boards=people.map(p=>commuterTimes(plan,p).board);expect(Math.max(...boards)-Math.min(...boards),'arrivals spread across the stop').toBeGreaterThan(6);
   expect(new Set(people.map(p=>p.pace)).size,'different paces').toBeGreaterThanOrEqual(4);
   expect(new Set(people.map(p=>p.home)).size,'different starting places').toBeGreaterThanOrEqual(5);
   expect(people.filter(p=>p.work===COMMUTER_TOWERS.ritz)).toHaveLength(2);
  }
  expect(plan.commuters[0].offset).not.toBe(plan.commuters[6].offset);
  const towers=new Set(f.buildings.map(b=>b.id));
  for(const p of plan.commuters){expect([COMMUTER_TOWERS.circa,COMMUTER_TOWERS.amex,COMMUTER_TOWERS.ritz]).toContain(p.work);if(towers.has('circa')&&p.home!=='mansion'&&p.home!=='home-4'&&p.home!=='shops'&&p.home!=='spa'&&p.home!=='home-2')expect(p.work).toBe(COMMUTER_TOWERS.circa);}
  // KC, 2026-10-31: Ritz-Carlton guests go home to the mansion; one American Express guest to Vista House.
  for(const p of plan.commuters.filter(p=>p.work===COMMUTER_TOWERS.ritz))expect(p.home).toBe('mansion');
  const vista=plan.commuters.filter(p=>p.home==='home-4');expect(vista).toHaveLength(1);expect(vista[0].work).toBe(COMMUTER_TOWERS.amex);
  const mansion=[c.x+HILLS.mansion.x,c.z+HILLS.mansion.z+HILLS.mansion.d/2+.15];for(const p of plan.commuters.filter(p=>p.home==='mansion'))expect([p.hills.points[0][0],p.hills.points[0][2]]).toEqual(mansion);
  const homes=COMMUNITY_BUILDINGS.filter(b=>!['station','golf'].includes(b.kind)).map(b=>({x:c.x+b.x,z:c.z+b.z,w:b.w,d:b.d})),offices=f.buildings.map(b=>({x:f.x+b.x,z:f.z+b.z,w:financialDimensions(b.id).w,d:financialDimensions(b.id).d}));
  for(const p of plan.commuters){
   const k=commuterTimes(plan,p),dwell=C.dwell;
   // Everyone boards and alights only while the train stands at that station with its doors open.
   expect(railState(k.board,s.communityRail!.length)).toMatchObject({phase:'hills',doors:1});expect(railState(k.alightFinancial,s.communityRail!.length)).toMatchObject({phase:'financial',doors:1});
   expect(railState(k.returnBoard,s.communityRail!.length)).toMatchObject({phase:'financial',doors:1});expect(railState(k.alightHills,s.communityRail!.length)).toMatchObject({phase:'hills',doors:1});
   expect(k.board).toBeLessThan(dwell);expect(k.board).toBeGreaterThan(0);
   // No one needs to be in two places: a full stop at work and at home between walks.
   expect(k.leaveWork-k.atWork).toBeGreaterThanOrEqual(RAIL_COMMUTERS.rest);expect(k.leaveHome+k.period-k.atHome).toBeGreaterThanOrEqual(RAIL_COMMUTERS.rest);
   // Routes start at real doorways, use existing walks and stairs, and end at a train door on the platform.
   expect(p.hills.points.at(-1)![1]).toBe(C.platformRise);expect(p.hills.points[0][1]).toBe(0);expect(p.financial.points[0][1]).toBe(C.platformRise);expect(p.financial.points.at(-1)![1]).toBe(0);
   expect(pathClear(ground(p.hills.points),homes,.05),`${p.id} hills walk`).toBe(true);expect(pathClear(ground(p.financial.points),offices,.05),`${p.id} financial walk`).toBe(true);
   // Smooth movement: no jumps while visible.
   let last:{x:number;z:number}|undefined;
   for(let t=p.offset*plan.cycle-200;t<p.offset*plan.cycle+k.period;t+=.1){const at=commuterAt(plan,p,t);if(at.visible){if(last)expect(Math.hypot(at.x-last.x,at.z-last.z)).toBeLessThan(p.pace*.1+.02);last=at;}else last=undefined;}
  }
 });
});
