import {test,expect} from '@playwright/test';
import {openAtlas,settle,waitForScene} from './atlas';
test.use({deviceScaleFactor:1});
for(const light of ['day','night'] as const)test(`Marketplace ${light}`,async({page})=>{
 await openAtlas(page,{light});
 await page.evaluate(async()=>{const {enterBuilding}=await import('/src/views/office/store.ts');enterBuilding('atlas-marketplace',true);});
 await settle(page,4);await waitForScene(page);
 const nav=page.getByRole('navigation',{name:'Choose Atlas Marketplace floor'});
 await expect(nav).toBeVisible();
 await page.screenshot({path:`artifacts/marketplace-${process.env.BEFORE?'before':'after'}-${light}-all.png`});
 await nav.getByRole('button',{name:process.env.BEFORE?'Ground':'Lobby',exact:true}).click();await page.clock.runFor(200);await settle(page,2);await waitForScene(page);
 await page.screenshot({path:`artifacts/marketplace-${process.env.BEFORE?'before':'after'}-${light}-lobby.png`});
 if(!process.env.BEFORE)for(const floor of [2,3]){
  await nav.getByRole('button',{name:`Floor ${floor}`,exact:true}).click();await page.clock.runFor(200);await settle(page,2);await waitForScene(page);
  await page.screenshot({path:`artifacts/marketplace-circulation-${light}-floor-${floor}.png`});
 }
 if(!process.env.BEFORE){await expect(nav.getByRole('button',{name:'Car park'})).toHaveCount(0);await nav.getByRole('button',{name:'Floor 1',exact:true}).click();await page.clock.runFor(200);await settle(page,2);await waitForScene(page);await page.screenshot({path:`artifacts/marketplace-after-${light}-production.png`});await page.getByRole('button',{name:/Commerce Operations Coordinator/}).click();await expect(page.getByLabel('Assigned agent inspector')).toContainText('Building workflow planned');await page.getByRole('tab',{name:'Output',exact:true}).click();await expect(page.getByLabel('Latest recorded work')).toBeVisible();await page.screenshot({path:`artifacts/marketplace-after-${light}-output.png`});await page.getByRole('button',{name:'Close details'}).click();await nav.getByRole('button',{name:'Lobby',exact:true}).focus();await page.keyboard.press('Enter');await expect(nav.getByRole('button',{name:'Lobby',exact:true})).toHaveAttribute('aria-pressed','true');}
});
