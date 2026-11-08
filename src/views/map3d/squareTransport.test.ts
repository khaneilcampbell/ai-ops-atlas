import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {cityEnvelope} from './citySpacing';
import {airportFootprint,airportPoint,AIRPORT_LAYOUT} from './airport';
import {railTimetable,railServiceState,serviceRailDeck,railPoint,COMMUNITY} from './hillsCommunityPlan';
import {planAirportCommuters,planRailCommuters,commuterTimes,commuterAt} from './railCommuters';
import {pathClear} from './roads';

describe('square city with three-stop passenger rail',()=>{
 for(const group of ['none','district','status','tag'] as GroupBy[])it(`preserves clear, connected infrastructure: ${group}`,()=>{
  const original=JSON.stringify(catalog),s=buildScene(layoutMap(catalog,[],group)),r=s.communityRail!,e=cityEnvelope(s.land)!;
  expect(JSON.stringify(catalog)).toBe(original);expect(s.hills).toBeUndefined();
  expect(s.freight,'no freight trunk road (KC, 2026-11-07)').toBeUndefined();
  expect(e.w).toBeCloseTo(e.d,6);
  // The outer land itself is filled, not merely a square enclosing road. Original core canals stay.
  const core=cityEnvelope(s.coreLand!)!;
  for(let x=e.x+.1;x<e.x+e.w;x+=1)for(let z=e.z+.1;z<e.z+e.d;z+=1){
   if(x>=core.x&&x<=core.x+core.w&&z>=core.z&&z<=core.z+core.d)continue;
   expect(s.land.some(p=>x>=p.x&&x<=p.x+p.w&&z>=p.z&&z<=p.z+p.d)).toBe(true);
  }
  const a=s.airport!,parcel=airportFootprint(a);
  expect(parcel.z-s.financial!.z-s.financial!.d).toBeGreaterThan(0);if(group==='district')expect(parcel.z-s.financial!.z-s.financial!.d).toBeLessThan(1);
  expect(r.airportLeg).toBeDefined();const airport=r.airportLeg!;
  expect(airport.route[0]).toEqual(r.hills);expect(airport.route[airport.route.length-1]).toEqual(airport.financial);
  expect(airport.route[airport.route.length-2][1]).toBeCloseTo(airport.financial[1]);
  const runway=airportPoint(a,AIRPORT_LAYOUT.runwayX,0)[0];
  for(const p of airport.route)expect(Math.abs(p[0]-runway)).toBeGreaterThan(AIRPORT_LAYOUT.runwayWidth/2+1);
  const boxes=[...s.towers,...s.kiosks].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
  expect(pathClear(airport.route,boxes,.5)).toBe(true);expect(pathClear(r.airportWalk!.filter(p=>p[1]===0).map(p=>[p[0],p[2]]),boxes,.15)).toBe(true);
 });
 it('runs a continuous round trip with a 15-second dwell and closed doors while moving',()=>{
  const s=buildScene(layoutMap(catalog,[],'district')),r=s.communityRail!,deck=serviceRailDeck(r),timing=railTimetable(r),phases=new Set<string>();
  let previous=railServiceState(0,r).distance;
  for(let t=0;t<timing.cycle;t+=.1){const state=railServiceState(t,r);phases.add(state.phase);expect(Math.abs(state.distance-previous)).toBeLessThanOrEqual(COMMUNITY.speed*.101);previous=state.distance;
   const p=railPoint(deck,(r.airportLeg?.length??0)+2.5+state.distance);expect(Number.isFinite(p.x+p.z+p.yaw)).toBe(true);
   expect(state.doors).toBe(['hills','financial','airport'].includes(state.phase)?1:0);
  }
  expect(phases).toEqual(new Set(['hills','outbound','financial','return','airport-outbound','airport','airport-return']));
  const base=planRailCommuters(undefined,s.financial,r)!,visitors=planAirportCommuters(base,r)!;
  for(const plan of [base,visitors])for(const person of plan.commuters){const k=commuterTimes(plan,person),offset=(plan.clockOffset??0)+person.offset*plan.cycle;
   for(const t of [k.board,k.alightFinancial,k.returnBoard,k.alightHills])expect(railServiceState(t+offset,r).doors).toBe(1);
   let last:{x:number;z:number}|undefined;
   for(let t=k.leaveHome;t<k.atHome;t+=.1){const at=commuterAt(plan,person,t+offset);if(at.visible){if(last)expect(Math.hypot(at.x-last.x,at.z-last.z)).toBeLessThan(person.pace*.101+.02);last=at;}else last=undefined;}
  }
 });
});
