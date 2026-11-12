import {describe,it,expect} from 'vitest';
import {catalog} from '../catalog';
import {layoutMap} from './mapLayout';
import {buildScene} from './map3d/scene';
describe('central command district',()=>{
 const layout=layoutMap(catalog,[],'district'),scene=buildScene(layout);
 it('reuses the central parcel at the standard single-building size',()=>{
  const hub=layout.districts.find(d=>d.project.id==='ai-ops-atlas')!;
  expect(hub).toMatchObject({ox:19.5,oy:17.25,size:5});
  expect(layout.cleared?.find(d=>d.project.id==='benjaire-ops')).toMatchObject({ox:0,oy:17.25,size:5});
  expect(scene.towers.find(t=>t.projectId==='ai-ops-atlas')).toMatchObject({x:22,z:19.4});
  expect(hub.crew.map(a=>a.id)).toEqual(catalog.agents.filter(a=>a.projectId==='ai-ops-atlas').map(a=>a.id));
 });
 it('reflows landmark anchors with the standard district grid',()=>{
  expect(scene.mall).toMatchObject({x:24.625,z:42.675,w:12.4,d:11.6});
  expect(scene.agency).toMatchObject({x:20.825,w:9.6,d:4.8});expect(scene.agency!.z).toBeCloseTo(-.175);
  expect(layout.districts.find(d=>d.project.id==='intelligence-hub')).toMatchObject({ox:26.75,oy:17.25});
 });
 it('keeps building widths while standardizing land parcels',()=>{
  const get=(id:string)=>layout.districts.find(d=>d.project.id===id)!;
  const reference=get('intelligence-hub');
  for(const id of ['ai-ops-atlas','benjaire-site','portfolio-site','github-profile','soc-lab'])expect(get(id).hq.size).toBeCloseTo(reference.hq.size);
  expect(get('commerce-pipeline').hq.size).toBeCloseTo(3.6);
  expect(get('commerce-pipeline').size).toBe(10);expect(get('benjaire-site').size).toBe(10);
  expect(get('portfolio-site').size).toBe(5);expect(get('github-profile').size).toBe(10);expect(get('soc-lab').size).toBe(10);
  for(const id of ['ai-ops-atlas','benjaire-site','commerce-pipeline','portfolio-site','github-profile','soc-lab']) {
   const d=get(id),hq=d.hq;
   for(const lot of [...d.lots,...d.kiosks])expect(hq.gx+hq.size+.15<=lot.gx||lot.gx+lot.size+.15<=hq.gx||hq.gy+hq.size+.15<=lot.gy||lot.gy+lot.size+.15<=hq.gy).toBe(true);
  }
 });
 it('keeps hub lots within its parcel and bridge endpoints aligned',()=>{
  const hub=layout.districts.find(d=>d.project.id==='ai-ops-atlas')!;
  for(const lot of [hub.hq,...hub.lots,...hub.kiosks]) {expect(lot.gx).toBeGreaterThanOrEqual(hub.ox);expect(lot.gy).toBeGreaterThanOrEqual(hub.oy);expect(lot.gx+lot.size).toBeLessThanOrEqual(hub.ox+hub.size);expect(lot.gy+lot.size).toBeLessThanOrEqual(hub.oy+hub.size);}
  expect(layout.walks.some(w=>w.from===hub.project.id||w.to===hub.project.id)).toBe(true);
 });
});
