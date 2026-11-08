import {test,expect} from '@playwright/test';
import {openAtlas,settle,waitForScene} from './atlas';
test.use({viewport:{width:1000,height:700},deviceScaleFactor:1,reducedMotion:'no-preference'});
test('Marketplace office life is optional visual movement',async({page})=>{
 await openAtlas(page,{light:'day'});
 await page.evaluate(async()=>{const {enterBuilding}=await import('/src/views/office/store.ts');enterBuilding('atlas-marketplace',true);});
 await settle(page,4);await waitForScene(page);
 const button=page.getByRole('button',{name:'Office life: On',exact:true});await expect(button).toBeVisible();
 await page.clock.runFor(500);
 await page.screenshot({path:'artifacts/marketplace-office-life.png'});
 await button.click();await expect(page.getByRole('button',{name:'Office life: Off',exact:true})).toHaveAttribute('aria-pressed','false');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Office life: Off',exact:true}).click();await expect(page.getByRole('button',{name:'Office life paused',exact:true})).toBeVisible();
});
