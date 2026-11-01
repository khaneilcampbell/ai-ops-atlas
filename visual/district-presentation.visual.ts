import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
test.use({viewport:{width:1400,height:900},deviceScaleFactor:1});
test('grouping preserves city geometry and camera; labels and controls stay consistent',async({page})=>{
 test.setTimeout(600_000);await openAtlas(page,{light:'night'});await waitForScene(page);
 const scene=()=>page.evaluate(async()=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),path=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1],fiber=await import(path);
  const s=fiber._roots.get(document.querySelector('.map3d canvas')).store.getState();
  const meshes:{id:string;matrix:number[]}[]=[];
  s.scene.traverse((o:import('three').InstancedMesh)=>{if(o.isInstancedMesh)meshes.push({id:o.uuid,matrix:Array.from(o.instanceMatrix.array)});});
  return {meshes,camera:s.camera.matrixWorld.elements};
 });
 await expect(page.locator('.map-view-context')).toHaveCount(0);
 // Financial tower names follow the same overview rule as project towers.
 for(const name of ['Wells Fargo','American Express','Chase','Robinhood','Atlas HQ'])await expect(page.locator('.m3-plaque',{hasText:name}).first()).toHaveCount(1);
 const baseline=await scene();mkdirSync('artifacts/district-presentation',{recursive:true});
 for(const mode of ['none','status','tag','district']){
  await page.getByRole('combobox',{name:'Group projects',exact:true}).selectOption(mode);await settle(page,2);
  expect(await scene()).toEqual(baseline);
  if(mode==='none')await expect(page.locator('.m3-pill.hood.district')).toHaveCount(0);
  if(mode==='status')await expect(page.locator('.m3-pill.hood.district').filter({hasText:/Declared/i}).first()).toHaveCount(1);
  await page.screenshot({path:`artifacts/district-presentation/${mode}.png`});
 }
 await page.getByRole('combobox',{name:'Map view',exact:true}).selectOption('automations');await settle(page,1);
 await expect(page.locator('.map-view-context')).toHaveCount(0);
 await selectBuilding(page,'Financial District');await selectBuilding(page,'Wells Fargo');
 await expect(page.getByLabel('Inspector',{exact:true})).toContainText('Wells Fargo');
});
