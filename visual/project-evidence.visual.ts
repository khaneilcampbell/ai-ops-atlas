import {test,expect} from '@playwright/test';
import {openAtlas,settle} from './atlas';
for(const phone of [false,true]) test(`Project evidence ${phone}`,async({page})=>{
 await page.setViewportSize(phone?{width:390,height:844}:{width:1200,height:900});
 await openAtlas(page,{storage:{mapMode:'2d'}});await page.getByRole('list',{name:'Projects on the map'}).getByRole('button',{name:/^Atlas HQ,/}).dispatchEvent('click');await settle(page);
 if(process.env.SHOT_PHASE!=='before') await expect(page.getByRole('region',{name:'Project intelligence'})).toBeVisible();
 await page.screenshot({path:`artifacts/project-${process.env.SHOT_PHASE??'after'}-${phone?'phone':'desktop'}.png`,fullPage:true});
});
