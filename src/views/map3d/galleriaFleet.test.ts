import {describe,expect,it} from 'vitest';
import {FLEET_STRIDE,GALLERIA_FLEET,carBoxes,galleriaCar,type GalleriaCarKind} from './galleriaFleet';

describe('Galleria car park fleet',()=>{
 const kinds=Object.keys(GALLERIA_FLEET) as GalleriaCarKind[];
 it('mixes every kind of car within the first dozen bays',()=>{
  const seen=new Set(Array.from({length:12},(_,k)=>galleriaCar(k).kind));
  expect([...seen].sort()).toEqual([...kinds].sort());
 });
 it('fits every car in a bay (0.62 deep, 0.34 wide) and the shared moving mesh',()=>{
  for(const kind of kinds){
   const bs=carBoxes(kind,'#fff',[0,0],0);
   expect(bs.length).toBeLessThanOrEqual(FLEET_STRIDE);
   // Nose along +z at yaw 0: length runs along z, width along x.
   const z0=Math.min(...bs.map(b=>b.z-b.w/2)),z1=Math.max(...bs.map(b=>b.z+b.w/2)),x1=Math.max(...bs.map(b=>Math.abs(b.x)+b.d/2));
   expect(z1-z0,kind).toBeLessThan(.62);expect(2*x1,kind).toBeLessThan(.34);
  }
 });
 it('turns the nose with the yaw',()=>{
  const nose=(yaw:number)=>carBoxes('prototype','#fff',[0,0],yaw).find(b=>b.c==='#5fd3f3')!;
  expect(nose(0).z).toBeGreaterThan(.2);expect(nose(Math.PI/2).x).toBeGreaterThan(.2);
 });
});
