import {it,expect} from 'vitest';
import {HILLS} from './hillsPlan';
import {mansionParts,MANSION_TOP} from './hillsMansion';
const parts=mansionParts(),all=[...parts.solid,...parts.glass,...parts.plants,...parts.lights],m=HILLS.mansion;
it('keeps the redesigned house on the old footprint so roads, lamps and paths stay put',()=>{
 for(const i of all){
  expect(i.p[0]-i.s[0]/2).toBeGreaterThanOrEqual(m.x-m.w/2-.31);expect(i.p[0]+i.s[0]/2).toBeLessThanOrEqual(m.x+m.w/2+.31);
  // Slabs may cantilever toward the courtyard (as the old balconies did), never behind the house.
  expect(i.p[2]-i.s[2]/2).toBeGreaterThanOrEqual(m.z-m.d/2-.31);expect(i.p[2]+i.s[2]/2).toBeLessThanOrEqual(m.z+m.d/2+.35);
  expect(i.p[1]).toBeGreaterThanOrEqual(0);
 }
});
it('stays under the flight-clearance roof and reports its true top',()=>{
 const top=Math.max(...all.map(i=>i.p[1]+i.s[1]));expect(top).toBeCloseTo(MANSION_TOP,2);expect(top).toBeLessThan(m.h+1);
});
it('fits the first-draft budget: instanced boxes only, glass for the night glow',()=>{
 expect(all.length).toBeLessThanOrEqual(120);expect(parts.glass.length).toBe(3);expect(parts.lights.length).toBeLessThanOrEqual(8);
 expect(all.every(i=>i.s.every(v=>v>0))).toBe(true);
});
