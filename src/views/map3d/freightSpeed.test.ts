import {it,expect} from 'vitest';
import {freightSpeed,FREIGHT_SPEED as speed} from './freight';
const highway:[number,number][]=[[0,0],[20,0]];
it('uses faster highway travel and slower city and cargo access',()=>{
 expect(freightSpeed([10,.35],highway)).toBe(speed.highway);
 expect(freightSpeed([10,3],highway)).toBe(speed.city);
 expect(freightSpeed([10,1.45],highway)).toBeGreaterThan(speed.city);
 expect(freightSpeed([10,1.45],highway)).toBeLessThan(speed.highway);
});
