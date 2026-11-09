import { test, expect } from '@playwright/test';
import { openAtlas, goTo, settle } from './atlas';
for (const phone of [false,true]) test(`Coordinator profile ${phone?'phone':'desktop'}`, async ({page}) => {
  test.setTimeout(60_000);
  await page.setViewportSize(phone?{width:390,height:844}:{width:1200,height:800});
  await openAtlas(page,{storage:{mapMode:'2d'}});
  if (phone) {
    await page.getByRole('button',{name:'More sections'}).click();
    await page.locator('.more-list button',{hasText:'Automations'}).click();
    await settle(page);
  } else {
    await goTo(page,'Automations');
  }
  await page.locator('[data-id="atlas-production-coordinator"]').first().click();
  await settle(page,2);
  const panel = page.getByRole('tabpanel');
  if (!process.env.PROFILE_BEFORE && !phone) {
    await expect(page.getByText('Prioritize at most three production issues using current failure evidence and business impact',{exact:true}).first()).toBeVisible();
    await expect(page.getByRole('tab',{name:'Workday',exact:true})).toHaveCount(0);
    await page.getByRole('tab',{name:'Goals',exact:true}).click();
    await expect(panel).toContainText('Evidence-backed handoff completeness');
    await expect(panel).toContainText('Platform readiness clarity');
    await page.getByRole('tab',{name:/^Operations/}).click();
    await expect(panel).toContainText('Source: GitHub Actions');
    await page.getByRole('tab',{name:'Workflow',exact:true}).click();
    await expect(panel).toContainText('Request-based workday');
    await expect(panel).toContainText('No timed execution or background schedule');
    await expect(panel).toContainText('Manual work only; the visual workday is not a real execution schedule');
  }
  if (!phone) await page.getByRole('tab',{name:'Workflow',exact:true}).click();
  await page.screenshot({path:`docs/coordinator-role/${process.env.PROFILE_BEFORE?'before':'after'}-${phone?'phone':'desktop'}.png`,fullPage:true});
});
