import {test,expect} from '@playwright/test';import {mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** Phase 2 building module panels (KC, 2026-11-10): the inspector names the module a building houses. */
const out=process.env.SHOT_DIR??'artifacts/module-panel';
const BUILDINGS:[string,string][]=[['atlas-hq','Atlas Command Center'],['benjaire-hq','Business Operations HQ'],['agency','Growth & Marketing Studio'],['marketplace','Product Marketplace']];
for(const [file,name] of BUILDINGS)test(`Module panel: ${name}`,async({page})=>{
 test.setTimeout(300_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,name);await settle(page,2);
 const panel=page.getByRole('complementary',{name:'Inspector'});await expect(panel).toBeVisible();
 await page.screenshot({path:`${out}/${file}-desktop.png`});
 expect(errors).toEqual([]);
});
test('Module panel on a phone: Benjaire HQ',async({page})=>{
 test.setTimeout(300_000);mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Business Operations HQ');await settle(page,2);
 await page.screenshot({path:`${out}/benjaire-hq-phone.png`});
});
test('Module panel: Atlas · Operations (airport)',async({page})=>{
 test.setTimeout(300_000);mkdirSync(out,{recursive:true});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Atlas Airport');await page.getByRole('button',{name:'Atlas · Operations →'}).click();await settle(page,2);
 await expect(page.getByRole('complementary',{name:'Inspector'})).toContainText('Observability');
 await page.screenshot({path:`${out}/operations-desktop.png`});
});
