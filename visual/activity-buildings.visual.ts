import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,goTo} from './atlas';
for(const phone of [false,true])test(`Activity building filter ${phone?'phone':'desktop'}`,async({page})=>{
 test.setTimeout(120000);
 if(phone)await page.setViewportSize({width:390,height:844});
 await openAtlas(page);await goTo(page,'Activity');
 const filter=page.getByRole('combobox',{name:'Project',exact:true});
 await expect(filter.locator('option',{hasText:'Atlas Command Center'})).toHaveCount(1);
 if(!process.env.BEFORE){
  for(const name of ['Skyline','Service Desk','Benjaire Dashboard'])await expect(filter.locator('option').filter({hasText:new RegExp(`^${name}$`)})).toHaveCount(0);
  await filter.selectOption('ai-ops-atlas');
  await expect(page.locator('.count').first()).toBeVisible();
 }
 const dir=process.env.SHOT_DIR??'/private/tmp/activity-buildings-shots';mkdirSync(dir,{recursive:true});
 await page.screenshot({path:`${dir}/${phone?'phone':'desktop'}.png`,fullPage:false});
});
