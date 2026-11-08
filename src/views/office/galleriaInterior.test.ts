import {describe,expect,it} from 'vitest';
import {galleriaCrowd} from './GalleriaInterior';

describe('Atlas Galleria interior',()=>{
 it('puts people on every floor, at that floor’s height',()=>{
  for(const f of [0,1,2,3]){const people=galleriaCrowd(f,f*4);expect(people.length,`floor ${f}`).toBeGreaterThan(0);for(const p of people)for(const q of p.path)expect(q[1]).toBe(f*4);}
 });
});
