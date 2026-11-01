import {test,expect} from '@playwright/test';import {mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * Every building appears in every map grouping (KC, 2026-11-01). The unit test
 * map3d/everyView.test.ts checks the full list; this opens the buildings that used to drop out from
 * their nameplates in each grouping, at desktop and phone width. Screenshots only when SHOT_DIR is set.
 */
const out=process.env.SHOT_DIR;
// The buildings that used to drop out of some groupings: the agency (it only fitted the bay of the
// By district layout) and the Marketplace (water at its lot's north edge when ungrouped or by status).
const NAMES=['Benjaire Marketing Agency','Atlas Marketplace'];
for(const group of ['none','district','status','tag'] as const)for(const [device,size] of [['desktop',{width:1512,height:900}],['phone',{width:390,height:844}]] as const)
test(`every building is on the map grouped by ${group}, ${device}`,async({page})=>{
 test.setTimeout(300_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize(size);await openAtlas(page,{light:'day',storage:{mapProjectGrouping:group}});await waitForScene(page);await settle(page,2);
 if(out){mkdirSync(out,{recursive:true});await page.screenshot({path:`${out}/${group}-${device}.png`});}
 for(const [i,name] of NAMES.entries()){
  await selectBuilding(page,name);await settle(page,2);
  if(out)await page.screenshot({path:`${out}/${group}-${device}-selected-${i}.png`});
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 }
 expect(errors).toEqual([]);
});
