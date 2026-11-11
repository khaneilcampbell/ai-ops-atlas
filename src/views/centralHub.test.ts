import {describe,it,expect} from 'vitest';
import {catalog} from '../catalog';
import {layoutMap} from './mapLayout';
import {buildScene} from './map3d/scene';
describe('central command district',()=>{
 const layout=layoutMap(catalog,[],'district'),scene=buildScene(layout);
 it('reuses the central cleared parcel without resizing the hub',()=>{
  const hub=layout.districts.find(d=>d.project.id==='ai-ops-atlas')!;
  expect(hub).toMatchObject({ox:19.5,oy:14.75,size:5});
  expect(layout.cleared?.find(d=>d.project.id==='benjaire-ops')).toMatchObject({ox:0,oy:14.75,size:5});
  expect(scene.towers.find(t=>t.projectId==='ai-ops-atlas')).toMatchObject({x:22,z:17.25});
  expect(hub.crew.map(a=>a.id)).toEqual(catalog.agents.filter(a=>a.projectId==='ai-ops-atlas').map(a=>a.id));
 });
 it('preserves Marketplace, Galleria and marketing studio anchors',()=>{
  expect(scene.mall).toMatchObject({x:24.3875,z:35.175,w:12.4,d:11.6});
  expect(scene.agency).toMatchObject({x:20.825,w:9.6,d:4.8});expect(scene.agency!.z).toBeCloseTo(-.175);
  expect(layout.districts.find(d=>d.project.id==='intelligence-hub')).toMatchObject({ox:26.75,oy:12.25});
 });
 it('keeps hub lots within its parcel and bridge endpoints aligned',()=>{
  const hub=layout.districts.find(d=>d.project.id==='ai-ops-atlas')!;
  for(const lot of [hub.hq,...hub.lots,...hub.kiosks]) {expect(lot.gx).toBeGreaterThanOrEqual(hub.ox);expect(lot.gy).toBeGreaterThanOrEqual(hub.oy);expect(lot.gx+lot.size).toBeLessThanOrEqual(hub.ox+hub.size);expect(lot.gy+lot.size).toBeLessThanOrEqual(hub.oy+hub.size);}
  expect(layout.walks.some(w=>w.from===hub.project.id||w.to===hub.project.id)).toBe(true);
 });
});
