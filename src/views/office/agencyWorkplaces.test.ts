import {expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {AGENCY_ROOMS,INTERIOR,EAST_EDGE,WEST_EDGE} from './agencyInteriorPlan';
import {agencyAssignedAgent,agencySeat} from './agencyWorkplaces';

const SEATED:Record<string,string>={'1-strategy':'benjaire-product-lab','2-insights':'benjaire-product-lab-research','2-archive':'benjaire-product-lab-competitors','1-social':'benjaire-product-lab-customers','2-workshop':'benjaire-product-lab-scoring','1-review':'benjaire-product-lab-brief'};

it('seats each Product Lab agent in its mapped room and nobody else',()=>{
 const got=Object.fromEntries(AGENCY_ROOMS.flatMap(r=>{const a=agencyAssignedAgent(r,catalog.agents);return a?[[r.id,a.id]]:[];}));
 expect(got).toEqual(SEATED);
});

it('puts every seat inside its room, clear of the slot and the atrium',()=>{
 const a=INTERIOR.atrium;
 for(const r of AGENCY_ROOMS){
  const s=agencySeat(r);
  expect(s.x,r.id).toBeGreaterThan(r.x);expect(s.x,r.id).toBeLessThan(r.x+r.w);
  expect(s.z,r.id).toBeGreaterThan(r.z);expect(s.z,r.id).toBeLessThan(r.z+r.d);
  expect(s.x>WEST_EDGE&&s.x<EAST_EDGE,r.id).toBe(false);
  if(r.level>0&&r.level<=a.openTo)expect(Math.hypot(s.x-a.x,s.z-a.z),r.id).toBeGreaterThan(a.r+.5);
 }
});

it('says which rooms hold a real agent and keeps the rest planned',()=>{
 for(const r of AGENCY_ROOMS){
  if(SEATED[r.id])expect(r.purpose,r.id).toMatch(/Benjaire Product Lab/);
  else expect(r.purpose,r.id).not.toMatch(/Product Lab/);
 }
});
