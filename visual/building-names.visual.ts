import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * Original building names (docs/building-names.md, KC 2026-11-07): no real company name on a nameplate.
 * NAMES_SHOT_DIR saves before/after screenshots; the name checks always run.
 */
const dir=process.env.NAMES_SHOT_DIR;
const RENAMED=['Financial Operations Tower','Integration Exchange','Merrow Credit Union','Data Intelligence Center','Camton Hotel','Governance & Compliance Center','Ravelle Advisors','Ellipse Residences','Infrastructure Operations Hub'];
const OLD=['Chase','Robinhood','Navy Federal','Experian','Ritz-Carlton','Wells Fargo','Vanguard','Circa','BMW','OpenAI','Anthropic','GitHub Profile'];
const shot=async(page:import('@playwright/test').Page,name:string)=>{if(dir){mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${name}.png`});}};
for(const light of ['day','night'] as const)test(`renamed buildings, ${light}`,async({page})=>{
 test.setTimeout(600_000);await page.setViewportSize({width:1512,height:900});
 await openAtlas(page,{light});await waitForScene(page);
 await selectBuilding(page,'Financial District');await settle(page,3);
 const names=await page.locator('.m3-plaque').allTextContents();
 if(!process.env.NAMES_BEFORE){for(const old of OLD)expect(names.join('|')).not.toContain(old);for(const name of RENAMED.slice(0,7))expect(names.join('|')).toContain(name);}
 await shot(page,`financial-${light}`);
 await selectBuilding(page,process.env.NAMES_BEFORE?'BMW':'Infrastructure Operations Hub');await shot(page,`dealership-${light}`);
});
test('renamed buildings on a phone',async({page})=>{
 test.setTimeout(600_000);await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);
 await selectBuilding(page,'Financial District');await settle(page,3);await shot(page,'phone-financial');
});
