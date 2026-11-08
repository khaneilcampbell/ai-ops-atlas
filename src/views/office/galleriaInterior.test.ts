import {describe,expect,it} from 'vitest';
import {GALLERIA_UNITS} from '../map3d/galleriaPlan';
import {DOOR,doorway,fitout,galleriaCrowd} from './GalleriaInterior';

describe('Atlas Galleria interior',()=>{
 it('gives every walled unit a framed door, open glass for shops and closed for back of house',()=>{
  for(const u of GALLERIA_UNITS.filter(u=>u.kind!=='parking')){
   const boxes=fitout(u,0,false),jambs=boxes.filter(b=>b.c===DOOR.frame&&b.s[1]===DOOR.h);
   const leaves=boxes.filter(b=>b.c===(u.kind==='service'?DOOR.solid:DOOR.glass));
   // A unit whose shopfront is shorter than a door gets none; every other one gets two jambs and two leaves.
   if(!jambs.length)continue;
   expect(jambs,u.id).toHaveLength(2);expect(leaves.length,u.id).toBeGreaterThanOrEqual(2);
  }
  expect(GALLERIA_UNITS.filter(u=>u.kind!=='parking'&&fitout(u,0,false).some(b=>b.c===DOOR.frame)).length).toBeGreaterThan(10);
 });
 it('swings open doors into the unit and leaves closed ones flush with the shopfront',()=>{
  const a:[number,number]=[0,0],b:[number,number]=[4,0],inside:[number,number]=[2,3];
  const open=doorway(a,b,inside,0,true).filter(x=>x.c===DOOR.glass),shut=doorway(a,b,inside,0,false).filter(x=>x.c===DOOR.solid);
  for(const l of open)expect(l.p[2]).toBeGreaterThan(.05);
  for(const l of shut)expect(Math.abs(l.p[2])).toBeLessThan(1e-9);
  expect(doorway(a,[1,0],inside,0,true)).toEqual([]);
 });
 it('puts people on every floor, at that floor’s height',()=>{
  for(const f of [0,1,2,3]){const people=galleriaCrowd(f,f*4);expect(people.length,`floor ${f}`).toBeGreaterThan(0);for(const p of people)for(const q of p.path)expect(q[1]).toBe(f*4);}
 });
});
