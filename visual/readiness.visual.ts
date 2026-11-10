import { test, expect } from '@playwright/test';
import { openAtlas, goTo, settle } from './atlas';
for (const phone of [false, true]) test(`readiness import ${phone ? 'phone' : 'desktop'}`, async ({page}) => {
  await page.setViewportSize(phone ? {width:390,height:844} : {width:1200,height:800});
  await openAtlas(page, {storage:{mapMode:'2d'}});
  await goTo(page,'Automations');
  await page.locator('[data-id="atlas-production-coordinator"]').first().click();
  await settle(page,2);
  await page.getByRole('tab',{name:'Output',exact:true}).click();
  const panel = page.getByRole('region',{name:'Campaign readiness packet'});
  // section has an accessible name and therefore an implicit region role.
  await expect(panel).toBeVisible();
  await panel.getByLabel('Open readiness packet').setInputFiles('ops/benjaire-production/fixtures/readiness-packet.json');
  await expect(panel).toContainText('Synthetic fixture');
  await expect(panel).toContainText('Awaiting human approval');
  await expect(panel).toContainText('Not independently verified');
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({path:`docs/benjaire-readiness/after-${phone?'phone':'desktop'}.png`, fullPage:true});
  await panel.getByRole('button',{name:'Clear local packet'}).click();
  await expect(panel.getByText('Synthetic fixture',{exact:false})).toHaveCount(0);
  await panel.getByLabel('Open readiness packet').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"publish_authorized":true}')});
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel).not.toContainText('Awaiting human approval');
});
