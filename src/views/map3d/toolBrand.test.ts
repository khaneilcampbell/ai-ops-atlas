import {describe,expect,it} from 'vitest';
import {toolBrand,CREAM_STONE,FOREST_ROOF} from './toolBrand';

describe('tool office facades',()=>{
 it('gives the Log Analytics Lab the Security Operations Center sandstone and sky glass',()=>{
  const lab=toolBrand('Log Analytics Lab');
  expect(lab.wall).toBe('#ebe1cc');
  expect(lab.facade?.glass[0]).toBe('#5f8aa6');
  // The brand green stays on the sign and accent fin, not on the floor bands.
  expect(lab.facade?.bands).not.toContain(lab.primary);
  expect(lab.facade?.garden).toBe(true);
 });
 it('builds every other tool office in cream stone with a forest roof, brand colours on the bands (city artwork)',()=>{
  for(const name of ['Design Studio','Payments Office','Edge Office','Automation Works','Search Desk','Storefront Office','Unknown']){const b=toolBrand(name);expect(b.wall).toBe(CREAM_STONE);expect(b.roof).toBe(FOREST_ROOF);expect(b.primary).not.toBe(CREAM_STONE);}
 });
 it('leaves the other tool offices without a facade override',()=>{
  for(const name of ['Design Studio','Payments Office','Edge Office','Automation Works','Search Desk','Storefront Office','Unknown'])expect(toolBrand(name).facade).toBeUndefined();
 });
});
