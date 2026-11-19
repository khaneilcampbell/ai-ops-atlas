import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,goTo,settle} from './atlas';
// Governance tab shows each agent's kill switch and always-on caps (2026-11-14, Intel review fix).
test.use({deviceScaleFactor:1});
const out=process.env.SHOTS_DIR??'artifacts/kill-switch';
for(const width of [1512,390]) test(`Kill switch and caps on the Governance tab ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await openAtlas(page);
 mkdirSync(out,{recursive:true});
 await goTo(page,'Automations');
 const row=page.locator('.reg-row[data-id="benjaire-contact-worker"]');
 await row.scrollIntoViewIfNeeded();await row.click();await settle(page,1);
 if(width<600){
  // The phone inspector has only Overview and Output, so the governance fields don't show there.
  await expect(page.getByRole('tab',{name:'Governance'})).toHaveCount(0);
  await page.screenshot({path:`${out}/inspector-${width}.png`});
  return;
 }
 await page.getByRole('tab',{name:'Governance'}).click();await settle(page,1);
 if(!process.env.BEFORE){
  await expect(page.getByText('Kill switch',{exact:true})).toBeVisible();
  await expect(page.getByText(/20 a minute site-wide/).first()).toBeVisible();
 }
 await page.getByText('Audit log',{exact:true}).scrollIntoViewIfNeeded();await settle(page,1);
 await page.screenshot({path:`${out}/governance-${width}.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
