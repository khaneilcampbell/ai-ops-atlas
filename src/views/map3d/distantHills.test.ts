import {describe,it,expect} from 'vitest';
import {distantHills,HILLS} from './distantHills';

describe('distant forested hills',()=>{
 const b={x0:-20,x1:40,z0:-30,z1:30},hills=distantHills(b,-.2),cx=10,cz=0,half=30;
 it('rings the island well out across the water, never on it',()=>{
  expect(hills).toHaveLength(HILLS.count);
  for(const h of hills){const d=Math.hypot(h.p[0]-cx,h.p[2]-cz);expect(d-Math.max(h.s[0],h.s[2])).toBeGreaterThan(half+HILLS.margin*.5);}
 });
 it('stays low and green, the same every time',()=>{
  for(const h of hills){expect(h.s[1]).toBeLessThanOrEqual(HILLS.maxH);expect(HILLS.colors).toContain(h.c);}
  expect(JSON.stringify(distantHills(b,-.2))).toBe(JSON.stringify(hills));
 });
});
