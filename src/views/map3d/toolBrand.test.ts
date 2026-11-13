import {describe,expect,it} from 'vitest';
import {toolBrand} from './toolBrand';

describe('tool office facades',()=>{
 it('gives the Log Analytics Lab the Security Operations Center sandstone and sky glass',()=>{
  const lab=toolBrand('Log Analytics Lab');
  expect(lab.wall).toBe('#ebe1cc');
  expect(lab.facade?.glass[0]).toBe('#5f8aa6');
  // The brand green stays on the sign and accent fin, not on the floor bands.
  expect(lab.facade?.bands).not.toContain(lab.primary);
  expect(lab.facade?.garden).toBe(true);
 });
 it('leaves the other tool offices on their brand colours',()=>{
  for(const name of ['Design Studio','Payments Office','Edge Office','Automation Works','Search Desk','Storefront Office','Unknown'])expect(toolBrand(name).facade).toBeUndefined();
 });
});
