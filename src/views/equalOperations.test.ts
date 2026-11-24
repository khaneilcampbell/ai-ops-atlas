import {describe,it,expect} from 'vitest';
import {catalog} from '../catalog';
import {layoutMap,OPERATIONS_DISTRICTS} from './mapLayout';
import {buildScene,type Rect} from './map3d/scene';
import {districtRect} from './map3d/buildingExtent';
import {towerRing,pathClear} from './map3d/roads';
const overlap=(a:Rect,b:Rect)=>a.x<b.x+b.w-1e-7&&a.x+a.w>b.x+1e-7&&a.z<b.z+b.d-1e-7&&a.z+a.d>b.z+1e-7;
describe('Commerce-sized operations campus',()=>{
 const layout=layoutMap(catalog,[],'district'),scene=buildScene(layout);
 const district=(id:string)=>layout.districts.find(d=>d.project.id===id)!;
 it('shares exact land and selectable terrace bounds without touching neighbors or Marketing grounds',()=>{
  const reference=districtRect(scene,'commerce-pipeline')!;
  for(const id of OPERATIONS_DISTRICTS){
   expect(district(id).size).toBe(district('commerce-pipeline').size);
   const r=districtRect(scene,id)!;expect(r.w).toBeCloseTo(reference.w,10);expect(r.d).toBeCloseTo(reference.d,10);
   const terraces=scene.terraces.filter(t=>t.id===id);expect(terraces).toHaveLength(1);
   expect(terraces[0].x).toBe(r.x);expect(terraces[0].z).toBe(r.z);
   expect(terraces[0].w).toBeCloseTo(r.w,10);expect(terraces[0].d).toBeCloseTo(r.d,10);
   for(const t of scene.terraces.filter(t=>t.id!==id))expect(overlap(r,t),`${id} overlaps ${t.id}`).toBe(false);
   for(const p of [scene.galleria!.rect,scene.mall!,scene.commons!.rect,scene.financial!,...scene.agency!.plinth])expect(overlap(r,p),`${id} enters Marketing grounds`).toBe(false);
   for(const t of scene.towers.filter(t=>t.projectId===id)){
    expect(t.x-t.size/2).toBeGreaterThanOrEqual(r.x);expect(t.x+t.size/2).toBeLessThanOrEqual(r.x+r.w);
    expect(t.z-t.size/2).toBeGreaterThanOrEqual(r.z);expect(t.z+t.size/2).toBeLessThanOrEqual(r.z+r.d);
   }
  }
 });
 it('keeps the actual Command and Commerce north street centerlines aligned and both connected',()=>{
  const north=(id:string)=>{const d=district(id),t=scene.towers.find(t=>t.projectId===id)!;return towerRing(t,d.hq.size*1.25+1)!.z0;};
  expect(north('ai-ops-atlas')).toBeCloseTo(north('commerce-pipeline'),9);
  const through=scene.transportConnections.find(c=>c.id==='operations-through-street')!;
  expect(through.road).toHaveLength(2);expect(through.road[1][1]).toBe(through.road[0][1]);
  expect(pathClear(through.road,[...scene.towers,...scene.kiosks].map(t=>({x:t.x,z:t.z,w:t.size,d:t.size})),.4)).toBe(true);
  for(const p of through.road)expect(p[1]).toBeCloseTo(north('commerce-pipeline'),9);
  for(const id of OPERATIONS_DISTRICTS)expect(scene.carBridges.some(b=>b.ends.includes(id))).toBe(true);
 });
 it('preserves other parcels, Development Hub and building dimensions',()=>{
  expect(district('portfolio-site')).toMatchObject({ox:17,oy:22,size:7.5});
  expect(district('github-profile')).toMatchObject({ox:9.75,oy:29.25,size:5});
  expect(district('benjaire-site')).toMatchObject({ox:7.25,oy:0,size:7.5});
  expect(district('soc-lab')).toMatchObject({ox:0,oy:30.75,size:7.5});
  for(const id of ['ai-ops-atlas','intelligence-hub','github-profile'])expect(district(id).hq.size).toBeCloseTo(2.55);
  expect(district('commerce-pipeline').hq.size).toBeCloseTo(3.6);
  expect(scene.githubAnnex).toBeDefined();
  expect(scene.clearedLots!.find(t=>t.projectId==='street-reserve:ai-ops-atlas')!.size).toBeCloseTo(2.601,10);
  expect(scene.clearedLots!.find(t=>t.projectId==='street-reserve:ai-ops-atlas')).toMatchObject({x:22,z:16.9});
  expect(scene.clearedLots!.find(t=>t.projectId==='street-reserve:intelligence-hub')!.size).toBeCloseTo(2.346,10);
  expect(scene.clearedLots!.find(t=>t.projectId==='street-reserve:intelligence-hub')).toMatchObject({x:30.5,z:16});
 });
});
