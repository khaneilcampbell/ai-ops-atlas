import {test,expect} from '@playwright/test';
import {openAtlas,settle,selectBuilding,waitForScene} from './atlas';
test.use({deviceScaleFactor:1});
test('Marketplace original exterior remains selectable',async({page})=>{
 await openAtlas(page,{light:'night'});await waitForScene(page);
 await selectBuilding(page,'Product Marketplace');await page.clock.runFor(200);await settle(page,2);await waitForScene(page);
 await expect(page.getByRole('button',{name:'Enter building',exact:true})).toBeVisible();
 await page.screenshot({path:'artifacts/marketplace-restored-exterior.png'});
 await page.getByRole('button',{name:'Enter building',exact:true}).click();await page.clock.runFor(1000);await settle(page,3);await waitForScene(page);
 await expect(page.getByRole('navigation',{name:'Choose Product Marketplace floor'})).toBeVisible();
});
