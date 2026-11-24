import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,goTo,settle} from './atlas';
// Automations opens on the Board (2026-11-24): every automation under the agent who runs it, with
// what needs Khaneil first. BEFORE=1 shoots the old Directory on main for the pull request.
test.use({deviceScaleFactor:1});
const out=process.env.SHOTS_DIR??'artifacts/automations-board';
for(const width of [1512,390]) test(`Automations board ${width}`,async({page})=>{
 test.setTimeout(120_000);
 await page.setViewportSize({width,height:width<600?844:982});
 await openAtlas(page);
 mkdirSync(out,{recursive:true});
 await goTo(page,'Automations');await settle(page,1);
 if(process.env.BEFORE){await page.screenshot({path:`${out}/before-${width}.png`,fullPage:true});return;}
 await expect(page.getByRole('tab',{name:'Board'})).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('region',{name:'Automations run by Claire Dubois'}).locator('.board-card')).toHaveCount(6);
 await expect(page.getByRole('complementary',{name:'Needs you'})).toContainText('Publish Database Task Writer');
 await page.screenshot({path:`${out}/after-${width}.png`,fullPage:true});
 await page.locator('.board-lane').first().evaluate(e=>e.scrollIntoView({block:'start'}));await settle(page,1);
 await page.screenshot({path:`${out}/lanes-${width}.png`});
 await page.getByRole('button',{name:/^Drafts ·/}).click();await settle(page,1);
 await page.screenshot({path:`${out}/drafts-${width}.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
