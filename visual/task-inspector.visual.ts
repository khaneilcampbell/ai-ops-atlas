import {test,expect} from '@playwright/test';
import {openAtlas,goTo,settle} from './atlas';
for(const phone of [false,true]) test(`Task inspector ${phone}`,async({page})=>{
 await page.setViewportSize(phone?{width:390,height:844}:{width:1200,height:900});
 await openAtlas(page,{storage:{mapMode:'2d'}});await goTo(page,'Agents');
 await page.locator('[data-id="atlas-production-coordinator"]').click();await page.getByRole('tab',{name:'Output',exact:true}).click();await settle(page);
 if(process.env.SHOT_PHASE!=='before'){
 await page.getByLabel('Import local job report').setInputFiles('ops/benjaire-production/evidence/job.json');
 await expect(page.getByRole('region',{name:'Benjaire task checkpoint'})).toContainText('awaiting approval');
 await expect(page.getByRole('button',{name:'Approve',exact:true})).toBeDisabled();
 await page.getByRole('region',{name:'Benjaire task checkpoint'}).scrollIntoViewIfNeeded(); }
 await page.screenshot({path:`artifacts/task-${process.env.SHOT_PHASE??'after'}-${phone?'phone':'desktop'}.png`,fullPage:true});
});
