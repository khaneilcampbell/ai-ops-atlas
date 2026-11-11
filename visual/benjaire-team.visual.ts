import {test,expect} from '@playwright/test';
/** The coordinator is a type B automation (catalog/ai-ops-atlas.yaml), so it is listed under Automations, not Agents. */
import {openAtlas,goTo,settle} from './atlas';
for(const phone of [false,true])test(`Coordinator Output remains evidence-based ${phone?'phone':'desktop'}`,async({page})=>{
 await page.setViewportSize(phone?{width:390,height:844}:{width:1200,height:800});
 await openAtlas(page,{storage:{mapMode:'2d'}});
 await page.route('**/actions/workflows/benjaire-production.yml/runs*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({total_count:0,workflow_runs:[]})}));
 await page.evaluate(()=>localStorage.removeItem('atlas:repoCache'));await page.reload();await settle(page,3);
 if(phone){await page.getByRole('button',{name:'More sections'}).click();await settle(page,1);await page.locator('.more-list button',{hasText:'Automations'}).click();await settle(page);}else await goTo(page,'Automations');
 await page.locator('[data-id="atlas-production-coordinator"]').first().click();await settle(page,2);
 await page.getByRole('tab',{name:'Output',exact:true}).click();
 await expect(page.getByLabel('Latest recorded work')).toContainText('No execution recorded');
 await expect(page.getByLabel('Latest recorded work')).toContainText('GitHub Actions');
 await page.screenshot({path:`artifacts/benjaire-team-output-${phone?'phone':'desktop'}.png`,fullPage:true});
});
