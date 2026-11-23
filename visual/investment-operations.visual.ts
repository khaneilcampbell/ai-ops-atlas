import {test,expect} from '@playwright/test';import {mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** Investment Operations Center panel, desktop and phone. Runs only when INVESTMENT_OPS_SHOTS=1. All data shown is synthetic. */
test.skip(!process.env.INVESTMENT_OPS_SHOTS,'Set INVESTMENT_OPS_SHOTS=1 to take Investment Operations Center screenshots.');
const out=process.env.INVESTMENT_OPS_OUT??'artifacts/investment-operations';
test('Investment Operations Center panel, desktop and phone',async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});
 for(const [label,size] of [['desktop',{width:1512,height:1100}],['phone',{width:390,height:844}]] as const){
  await page.setViewportSize(size);await openAtlas(page,{light:'day',storage:{mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
  await selectBuilding(page,'Investment Operations Center');await settle(page,2);
  await page.screenshot({path:`${out}/panel-${label}.png`});
  const section=page.locator('.investment-ops');
  if(await section.count()){
   await expect(section).toContainText('Not connected');await expect(section).toContainText('Invented data');await expect(section).not.toContainText('Synced');
   await expect(section).toContainText('only in the Atlas Mac app');
   await section.scrollIntoViewIfNeeded();await settle(page,1);
  }else{await page.locator('.panel-body').first().evaluate(e=>{e.scrollTop=e.scrollHeight;});await settle(page,1);}
  await page.screenshot({path:`${out}/section-${label}.png`});
 }
});
