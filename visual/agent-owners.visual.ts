import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,goTo,settle} from './atlas';
// Agents with the automations they own nested underneath. Since 2026-11-13 every automation has an
// owning agent, so Automations shows no orphan note.
test.use({deviceScaleFactor:1});
for(const width of [1512,390]) test(`Agents own their automations ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await openAtlas(page);
 mkdirSync('docs/agent-owners',{recursive:true});
 await goTo(page,'Agents');
 const nested=page.getByRole('list',{name:'Automations run by Senior Engineering Reviewer'});
 await expect(nested.getByRole('button')).toHaveCount(6);
 await expect(page.getByRole('list',{name:'Automations run by Client Inquiry Manager'}).getByRole('button')).toHaveCount(6);
 await expect(page.getByRole('list',{name:'Automations run by Commerce Operations Manager'}).getByRole('button')).toHaveCount(5);
 await expect(page.getByRole('list',{name:'Automations run by Portfolio Web Developer'}).getByRole('button')).toHaveCount(3);
 await page.locator('.reg-row[data-id="atlas-engineering-review"]').scrollIntoViewIfNeeded();await settle(page,1);
 await page.locator('.reg-row[data-id="atlas-engineering-review"]').evaluate(e=>e.scrollIntoView({block:'start'}));
 await page.screenshot({path:`docs/agent-owners/agents-${width}.png`});
 await page.locator('.reg-row[data-id="benjaire-inquiry-manager"]').evaluate(e=>e.scrollIntoView({block:'start'}));await settle(page,1);
 await page.screenshot({path:`docs/agent-owners/new-owner-${width}.png`});
 await goTo(page,'Automations');
 await expect(page.locator('.orphan-note')).toHaveCount(0);
 await page.locator('.reg-row[data-id="site-ci"]').evaluate(e=>e.scrollIntoView({block:'start'}));await settle(page,1);
 await page.screenshot({path:`docs/agent-owners/automations-${width}.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
