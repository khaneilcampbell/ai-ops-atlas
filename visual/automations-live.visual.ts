import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,goTo,settle} from './atlas';
// Automations → Live (2026-11-24): today's runs on a timeline, a table with failures and drafts
// first, and the picked automation in a drawer. Draws only runs Atlas has loaded.
test.use({deviceScaleFactor:1});
const out=process.env.SHOTS_DIR??'artifacts/automations-live';
for(const width of [1512,390]) test(`Automations live ${width}`,async({page})=>{
 test.setTimeout(120_000);
 await page.setViewportSize({width,height:width<600?844:982});
 await openAtlas(page,{storage:{'registry-prefs-automations':{sub:'live',board:true}}});
 mkdirSync(out,{recursive:true});
 await goTo(page,'Automations');await settle(page,1);
 await expect(page.getByRole('tab',{name:'Live'})).toHaveAttribute('aria-selected','true');
 // Failures, then drafts, lead the table.
 const first=page.locator('.live-table tbody tr').first();
 await expect(first.locator('.lv-pill')).toHaveText(/Latest run failed|Draft, not published/);
 await page.screenshot({path:`${out}/live-${width}.png`,fullPage:true});
 await page.locator('.live-table tbody tr',{hasText:'Database Task Writer'}).click();await settle(page,1);
 await expect(page.getByRole('complementary',{name:/Database Task Writer details/})).toContainText('Open in n8n');
 await page.getByRole('complementary',{name:/details/}).evaluate(e=>e.scrollIntoView({block:'start'}));await settle(page,1);
 await page.screenshot({path:`${out}/drawer-${width}.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
