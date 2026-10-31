import {describe,expect,it} from 'vitest';
import {MALL_SHOPS} from '../map3d/mallPlan';
import {MALL_IN,MALL_LEVELS,mallUnits} from './mallInterior';

describe('Atlas Marketplace interior', () => {
  const units=mallUnits();

  it('has eight units on each of the four floors', () => {
    expect(units).toHaveLength(MALL_IN.levels*MALL_IN.unitsPerFloor);
    for(const l of MALL_LEVELS)expect(units.filter(u=>u.level===l.level)).toHaveLength(MALL_IN.unitsPerFloor);
  });

  it('never shows a shop as selling', () => {
    for(const u of units){
      const note=u.note.toLowerCase();
      expect(note.replace(/not selling/g,'')).not.toMatch(/selling|now open|live sales/);
    }
    const shops=units.filter(u=>u.kind==='shop');
    expect(shops.map(u=>u.name)).toEqual(MALL_SHOPS.filter(s=>s.status==='planned').map(s=>s.name));
    for(const u of shops)expect(u.note).toMatch(/^Planned · not selling yet/);
  });

  it('puts every ground-floor shop from the map on the ground floor', () => {
    const ground=units.filter(u=>u.level===0).map(u=>u.name);
    for(const s of MALL_SHOPS)expect(ground).toContain(s.name);
    expect(ground.filter(n=>n==='Information desk')).toHaveLength(2);
  });

  it('gives each unit a shop front and back wall of the same length', () => {
    for(const u of units){
      expect(u.front.length).toBe(MALL_IN.segmentsPerUnit+1);
      expect(u.back.length).toBe(u.front.length);
    }
    expect(new Set(units.map(u=>u.id)).size).toBe(units.length);
  });
});
