import {test,expect} from '@playwright/test';
import {openAtlas,goTo,settle} from './atlas';
for(const phone of [false,true]) test(`Operations briefing ${phone}`,async({page})=>{
 await page.setViewportSize(phone?{width:390,height:844}:{width:1200,height:900});
 await openAtlas(page,{storage:{mapMode:'2d'}});await goTo(page,'Mission');
 if(process.env.SHOT_PHASE!=='before'){
 await page.getByRole('button',{name:'Generate briefing',exact:true}).click();await settle(page);
 await expect(page.getByRole('region',{name:'Operations Briefing'})).toContainText('Coverage gaps');
 await page.getByRole('region',{name:'Operations Briefing'}).scrollIntoViewIfNeeded(); }
 await page.screenshot({path:`artifacts/briefing-${process.env.SHOT_PHASE??'after'}-${phone?'phone':'desktop'}.png`,fullPage:true});
});
