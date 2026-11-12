import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,waitForScene,settle,selectBuilding} from './atlas';
for(const mode of ['day','night','phone'] as const)test(`Central hub ${mode}`,async({page},info)=>{
 test.setTimeout(180000);
 if(mode==='phone')await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:mode==='night'?'night':'day'});await waitForScene(page);await settle(page,1);
 // SHOT_DIR when set, otherwise the test's own output folder (a Mac-only /private/tmp path broke CI).
 const out=process.env.SHOT_DIR??info.outputPath('central-hub');mkdirSync(out,{recursive:true});
 await page.screenshot({path:`${out}/${mode}.png`});
 await selectBuilding(page,'Atlas Command Center');
 await expect(page.getByRole('heading',{name:'Atlas Command Center',exact:true,level:2})).toBeVisible();
});
