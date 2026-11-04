import { test, expect } from '@playwright/test';
import { openAtlas, goTo, settle } from './atlas';
for (const phone of [false, true]) test(`operations foundations ${phone ? 'phone' : 'desktop'}`, async ({ page }) => {
  await page.setViewportSize(phone ? {width:390,height:844} : {width:1200,height:900});
  await openAtlas(page, {storage:{mapMode:'2d'}});
  for (const destination of ['Settings','Activity','Agents']) {
    await goTo(page,destination); await settle(page);
    if(destination === 'Settings') { await page.getByRole('button',{name:'Test connection',exact:true}).click(); await settle(page); await expect(page.getByRole('status')).toContainText('Repository metadata readable'); }
    await page.screenshot({path:`artifacts/operations-${process.env.SHOT_PHASE ?? 'after'}-${destination}-${phone?'phone':'desktop'}.png`,fullPage:true});
  }
});
