import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
test.use({viewport:{width:1400,height:900},deviceScaleFactor:1});
test('the Map view menu keeps the camera and district names; labels and controls stay consistent',async({page})=>{
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
 for(const name of ['Governance & Compliance Center','Budget & Forecasting Center','Financial Operations Tower','Investment Operations Center','Atlas Command Center'])await expect(page.locator('.m3-plaque',{hasText:name}).first()).toHaveCount(1);
 const baseline=await scene();mkdirSync('artifacts/district-presentation',{recursive:true});
 // Grouping and the infrastructure view are one "Map view" menu now; there is no separate grouping menu.
 await expect(page.getByRole('combobox',{name:'Group projects',exact:true})).toHaveCount(0);
 const view=page.getByRole('combobox',{name:'Map view',exact:true});
 await expect(view.locator('option')).toHaveText(['By district','Agent network','Automation flow']);
 for(const mode of ['agents','infrastructure']){
  await view.selectOption(mode);await settle(page,2);
  expect((await scene()).camera).toEqual(baseline.camera);
  // District names fade back in after the label layout settles; software WebGL on CI can take longer than 5 s.
  await expect(page.locator('.m3-pill.hood.district').first()).toBeVisible({timeout:30_000});
  await expect(page.locator('.m3-pill.hood.district').filter({hasText:/Declared|#/i})).toHaveCount(0);
  await page.screenshot({path:`artifacts/district-presentation/${mode}.png`});
 }
 await page.getByRole('combobox',{name:'Map view',exact:true}).selectOption('automations');await settle(page,1);
 await expect(page.locator('.map-view-context')).toHaveCount(0);
 await selectBuilding(page,'Financial District');await selectBuilding(page,'Governance & Compliance Center');
 await expect(page.getByLabel('Inspector',{exact:true})).toContainText('Governance & Compliance Center');
});
