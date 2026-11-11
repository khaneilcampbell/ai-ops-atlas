import {test} from '@playwright/test';import {mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** Preview shots of the Benjaire finance panel and the district list. Runs only when BENJAIRE_FINANCE_SHOTS=1. */
test.skip(!process.env.BENJAIRE_FINANCE_SHOTS,'Set BENJAIRE_FINANCE_SHOTS=1 to take Benjaire finance preview screenshots.');
const out=process.env.BENJAIRE_FINANCE_OUT??'artifacts/benjaire-finance';
test('Benjaire finance panel, desktop and phone',async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});
 for(const [label,size] of [['desktop',{width:1512,height:1100}],['phone',{width:390,height:844}]] as const){
  await page.setViewportSize(size);await openAtlas(page,{light:'day',storage:{mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
  await selectBuilding(page,'Financial District');await settle(page,2);
  await page.locator('.panel-body').first().evaluate(e=>{e.scrollTop=e.scrollHeight;});await settle(page,1);
  await page.screenshot({path:`${out}/district-${label}.png`});
  await selectBuilding(page,'Business Finance Center');await settle(page,2);
  await page.screenshot({path:`${out}/business-finance-${label}.png`});
  const section=page.locator('.benjaire-finance');if(await section.count()){await section.scrollIntoViewIfNeeded();await settle(page,1);await page.screenshot({path:`${out}/business-finance-section-${label}.png`});}
 }
});
