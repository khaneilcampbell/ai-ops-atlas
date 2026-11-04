import {test,expect} from '@playwright/test';
import {openAtlas,goTo,settle} from './atlas';
for(const phone of [false,true]) test(`Activity evidence ${phone}`,async({page})=>{
 await page.setViewportSize(phone?{width:390,height:844}:{width:1200,height:900});
 await openAtlas(page,{storage:{mapMode:'2d'}});await goTo(page,'Activity');
 await expect(page.getByLabel('Source',{exact:true})).toBeVisible();
 await page.getByText('Evidence and next action',{exact:true}).first().click(); await settle(page);
 await expect(page.getByText('Collected:',{exact:false}).first()).toBeVisible();
 await page.screenshot({path:`artifacts/activity-after-${phone?'phone':'desktop'}.png`,fullPage:true});
});
