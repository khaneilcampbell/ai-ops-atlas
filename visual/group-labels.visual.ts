import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,settle,waitForScene} from './atlas';
/**
 * District names (AI ENGINEERING, AI OPERATIONS, ...) and building nameplates follow the buildings
 * after districts move (#363, #375). LABELS_SHOT_DIR saves overview screenshots for the PR.
 */
const dir=process.env.LABELS_SHOT_DIR;
const shot=async(page:import('@playwright/test').Page,name:string)=>{if(dir){mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${name}.png`});}};
for(const [name,width,height] of [['desktop',1512,900],['phone',390,844]] as const)test(`district names on the map, ${name}`,async({page})=>{
 test.setTimeout(600_000);await page.setViewportSize({width,height});
 await openAtlas(page,{light:'night'});await waitForScene(page);await settle(page,3);
 const names=(await page.locator('.m3-pill.hood').allTextContents()).join('|');
 if(width>1000)for(const d of ['AI ENGINEERING','AI OPERATIONS','BUSINESS OPERATIONS'])expect(names).toContain(d);
 await shot(page,`overview-${name}`);
 if(width<1000)return;
 for(let i=0;i<3;i++){await page.getByRole('button',{name:'Zoom in'}).click();await settle(page,2);}
 await shot(page,`closer-${name}`);
});
