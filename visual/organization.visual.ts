import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,goTo,settle} from './atlas';
test.use({deviceScaleFactor:1});
for(const width of [1512,390]) test(`Separated agents and automations ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await openAtlas(page,{storage:{'registry-prefs-agents':{classification:'B',view:'all'}}});
 await goTo(page,'Agents');
 await expect(page.getByRole('heading',{name:'Agents',exact:true})).toBeVisible();
 await expect(page.locator('.reg-row')).toHaveCount(22);
 await expect(page.locator('.reg-row[data-id="repo-intelligence"]')).toHaveCount(1);
 await expect(page.locator('.reg-row[data-id="github-merge-flow"]')).toHaveCount(0);
 // Owns Merge Flow since 2026-11-14, so it is an agent now.
 await expect(page.locator('.reg-row[data-id="atlas-production-coordinator"]')).toHaveCount(1);
 await expect(page.locator('.reg-row[data-id="skyline-inquiry-assistant"]')).toHaveCount(0);
 await expect(page.locator('.reg-row[data-id="niche-scout"]')).toHaveCount(0);
 mkdirSync('docs/agent-organization',{recursive:true});
 await page.screenshot({path:`docs/agent-organization/agents-${width}.png`});
 await goTo(page,'Automations');
 await expect(page.getByRole('heading',{name:'Automations',exact:true})).toBeVisible();
 await expect(page.locator('.reg-row')).toHaveCount(43); // 43: Agent Self-Reports (published 2026-11-24, #517) joined; 42: Atlas Engineering and Atlas Quality Assurance (paused, #516) and the Atlas Security Sheet (#510) joined the 39 after #506 and #508
 for(const id of ['github-merge-flow','atlas-ci','benjaire-flow-intake'])await expect(page.locator(`.reg-row[data-id="${id}"]`)).toHaveCount(1);
 await expect(page.locator('.reg-row[data-id="repo-intelligence"]')).toHaveCount(0);
 await page.locator('.reg-row[data-id="github-merge-flow"]').click();await settle(page,1);
 await page.getByRole('tab',{name:'Output',exact:true}).click();
 await expect(page.getByRole('tabpanel')).toBeVisible();
 await page.screenshot({path:`docs/agent-organization/automations-${width}.png`});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 expect(overflow).toBe(false);
});
