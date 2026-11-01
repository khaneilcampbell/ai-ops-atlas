import {mkdirSync} from 'node:fs';
import {expect,test,type Page} from '@playwright/test';
import {openAtlas,selectBuilding,settle,waitForOffice,waitForScene} from './atlas';
/**
 * KC, 2026-11-01: the district is Atlas Hills and the house is Atlas Mansion. Checks the map label,
 * the panel, search and the inside. Screenshots go to SHOT_DIR only when it is set.
 */
const SHOT_DIR=process.env.SHOT_DIR;
async function shot(page:Page,name:string){if(!SHOT_DIR)return;mkdirSync(SHOT_DIR,{recursive:true});await page.screenshot({path:`${SHOT_DIR}/${name}.png`});}
const sizes={desktop:{width:1512,height:945},phone:{width:390,height:844}} as const;
for(const [size,viewport] of Object.entries(sizes))test(`Atlas Mansion in Atlas Hills, ${size}`,async({page})=>{
 test.setTimeout(240_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize(viewport);
 await openAtlas(page,{light:'day',storage:{powerMode:'saver'}});await waitForScene(page);
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await settle(page,2);
 await selectBuilding(page,'Atlas Mansion');await settle(page,2);
 await expect(page.locator('.m3-plaque',{hasText:'Atlas Mansion'}).first()).toBeAttached();
 await expect(page.getByRole('heading',{name:'Atlas Hills',exact:true})).toBeVisible();
 await expect(page.getByText('Inside Atlas Mansion',{exact:true})).toBeAttached();
 await shot(page,`${size}-panel`);
 if(size==='desktop'){
  const search=page.getByRole('textbox',{name:'Search'});await search.fill('Atlas Mansion');
  await expect(page.locator('.list-row .title',{hasText:'Atlas Mansion'})).toBeVisible();await shot(page,`${size}-search`);await search.fill('');
 }
 await page.getByRole('button',{name:'Enter building',exact:true}).click();await waitForOffice(page);await settle(page,2);
 await expect(page.getByRole('navigation',{name:'Choose Atlas Mansion floor',exact:true})).toBeVisible();
 await shot(page,`${size}-inside`);
 await page.getByRole('button',{name:'Exit Atlas Mansion and return to city',exact:true}).click();await settle(page,2);
 expect(errors).toEqual([]);
});
