import {describe,expect,it} from 'vitest';
import {EXECUTIVE_JET_MODEL as J,JET_FUSELAGE,JET_GEAR_TOP} from './executiveJetModel';

const all=[...J.tubes,...J.balls,...J.boxes,...J.gear.balls,...J.gear.boxes];
describe('executive jet model',()=>{
 it('rests on its wheels: every tyre touches the ground and nothing else goes below it',()=>{
  for(const w of J.gear.balls)expect(w.p[1]-w.s[1]).toBeCloseTo(0,5);
  expect(J.gear.balls.length).toBe(6);
  for(const b of [...J.balls,...J.boxes])expect(b.p[1]-b.s[1]/2).toBeGreaterThan(.03);
 });
 it('gear struts reach from the wheels up into the belly',()=>{
  const struts=J.gear.boxes.filter(b=>b.s[1]>.1&&b.s[0]<.02);
  expect(struts.length).toBe(3);
  for(const s of struts)expect(s.p[1]+s.s[1]/2).toBeGreaterThanOrEqual(JET_GEAR_TOP);
  expect(JET_GEAR_TOP).toBeCloseTo(JET_FUSELAGE.y-JET_FUSELAGE.radius);
 });
 it('keeps the old footprint and is mirror-symmetric',()=>{
  const xs=all.map(b=>Math.abs(b.p[0])+b.s[0]/2);
  expect(Math.max(...xs)).toBeLessThan(1.2);
  const xsOf=(items:typeof all)=>items.map(b=>b.p[0].toFixed(3)).sort();
  for(const items of [J.tubes,J.gear.balls])expect(xsOf(items)).toEqual(xsOf(items.map(b=>({...b,p:[-b.p[0],b.p[1],b.p[2]]}))));
 });
});

import {JET_LIGHTS} from './executiveJetModel';
import {executiveJetPose,FLIGHT_SCHEDULE} from './flightSchedule';

describe('executive jet lights and gear in flight',()=>{
 it('has a lit cockpit behind the windscreen and three landing lights at the front',()=>{
  expect(J.cockpit.length).toBe(3);
  expect(JET_LIGHTS.cockpit.length).toBe(3);
  for(const l of JET_LIGHTS.cockpit)expect(l.p[2]).toBeLessThan(JET_FUSELAGE.from);
  expect(JET_LIGHTS.landing.length).toBe(3);
  for(const l of JET_LIGHTS.landing)expect(l.p[2]).toBeLessThan(0);
 });
 it('folds the gear up after takeoff and lowers it before landing, never flying low with it up',()=>{
  const span=FLIGHT_SCHEDULE.cycle*4;let ups=0,downs=0,prev=executiveJetPose(0).gear,maxY=0;
  for(let t=0;t<span;t+=.05){
   const p=executiveJetPose(t);
   if(p.y<.02)expect(p.gear).toBeGreaterThan(.98);
   if(p.gear<.02)maxY=Math.max(maxY,p.y);
   if(prev>=.5&&p.gear<.5)ups++;
   if(prev<.5&&p.gear>=.5)downs++;
   prev=p.gear;
  }
  expect(ups).toBeGreaterThan(0);
  expect(downs).toBe(ups);
  expect(maxY).toBeGreaterThan(1);
 });
});
