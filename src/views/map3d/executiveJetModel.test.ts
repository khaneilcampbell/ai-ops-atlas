import {describe,expect,it} from 'vitest';
import {EXECUTIVE_JET_MODEL as J,JET_BEAM,JET_FUSELAGE,JET_GEAR_TOP} from './executiveJetModel';
import {NAV_GREEN,NAV_RED} from './aircraftLights';

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

 it('has a lit cockpit and night lights laid out like the airliners (Khaneil, 2026-11-15)',()=>{
  expect(J.cockpit.length).toBe(3);
  for(const c of J.cockpit)expect(c.p[2]).toBeLessThan(JET_FUSELAGE.from);
  const red=J.lights.nav.find(l=>l.c===NAV_RED)!,green=J.lights.nav.find(l=>l.c===NAV_GREEN)!;
  expect(red.p[0]).toBeLessThan(-.9);expect(green.p[0]).toBeGreaterThan(.9);
  expect(J.lights.beacon).toHaveLength(3);expect(J.lights.strobe).toHaveLength(3);
  // Headlights: two in the wing roots and one on the nose gear, all ahead of the main gear; the beam starts at the nose light.
  expect(J.lights.landing).toHaveLength(3);
  for(const l of J.lights.landing)expect(l.p[2]).toBeLessThan(0);
  const nose=J.lights.landing.reduce((a,b)=>a.p[2]<b.p[2]?a:b);
  expect(Math.abs(nose.p[2]-JET_BEAM.z)).toBeLessThan(.05);
 });
});
