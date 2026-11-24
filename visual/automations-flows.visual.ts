import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,goTo,settle} from './atlas';
// Automations → Flows (2026-11-24): each owning agent's automations as a diagram joined by the
// handoffs the catalog records, the picked step beside it, and a read-only lifecycle board.
test.use({deviceScaleFactor:1});
const out=process.env.SHOTS_DIR??'artifacts/automations-flows';
for(const width of [1512,390]) test(`Automations flows ${width}`,async({page})=>{
 test.setTimeout(120_000);
 await page.setViewportSize({width,height:width<600?844:982});
 await openAtlas(page,{storage:{'registry-prefs-automations':{sub:'flows',board:true}}});
 mkdirSync(out,{recursive:true});
 await goTo(page,'Automations');await settle(page,1);
 await expect(page.getByRole('tab',{name:'Flows'})).toHaveAttribute('aria-selected','true');
 // The busiest flow opens first and draws at least one recorded handoff.
 await expect(page.locator('.flows-stage svg path[marker-end]').first()).toBeVisible();
 await page.screenshot({path:`${out}/flows-${width}.png`,fullPage:true});
 const node=page.locator('.flows-node').nth(1);
 const name=(await node.locator('b').innerText()).trim();
 await node.click();await settle(page,1);
 await expect(page.getByRole('complementary',{name:/step$/})).toContainText(name);
 await page.getByRole('region',{name:'Lifecycle'}).evaluate(e=>e.scrollIntoView({block:'start'}));await settle(page,1);
 await page.screenshot({path:`${out}/lifecycle-${width}.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
