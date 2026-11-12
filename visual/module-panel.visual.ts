import {test,expect} from '@playwright/test';import {mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** Phase 2 building module panels (KC, 2026-11-10): the inspector names the module a building houses. */
const out=process.env.SHOT_DIR??'artifacts/module-panel';
const BUILDINGS:[string,string][]=[['atlas-hq','Atlas Command Center'],['benjaire-hq','Business Operations HQ'],['agency','Growth & Marketing Studio'],['marketplace','Product Marketplace'],['aldren','Data Intelligence Center']];
for(const [file,name] of BUILDINGS)test(`Module panel: ${name}`,async({page})=>{
 test.setTimeout(300_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,name);await settle(page,2);
 const panel=page.getByRole('complementary',{name:'Inspector'});await expect(panel).toBeVisible();
 await page.screenshot({path:`${out}/${file}-desktop.png`});
 expect(errors).toEqual([]);
});
test('Module panel on a phone: Benjaire HQ',async({page})=>{
 test.setTimeout(300_000);mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Business Operations HQ');await settle(page,2);
 await page.screenshot({path:`${out}/benjaire-hq-phone.png`});
});
for(const [file,name,module] of [['operations','Observability Center','Observability'],['cargo','Model Intelligence Lab','Model Intelligence Lab']])test(`Module panel: ${name} (airport)`,async({page})=>{
 test.setTimeout(300_000);mkdirSync(out,{recursive:true});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Atlas Airport');await page.getByRole('button',{name:`${name} →`}).click();await settle(page,2);
 await expect(page.getByRole('complementary',{name:'Inspector'})).toContainText(module);
 await page.screenshot({path:`${out}/${file}-desktop.png`});
});
// The Workflow Automation Hub is a station, so it is reached along the rail from the Financial District.
const LISTS:[string,string,string,string[]?][]=[['inventory','Atlas Command Center','Module inventory'],['dependencies','Development Hub','Project dependencies'],['workflow-map','Financial District','Workflow map',['Financial District Station','Workflow Automation Hub']],['n8n-runs','Financial District','Live n8n runs',['Financial District Station','Workflow Automation Hub']],['datasets','Data Intelligence Center','Dataset inventory'],['security-incidents','Security Operations Center','Security incidents'],['security-alerts','Security Operations Center','Security alerts'],['hosting','Infrastructure Operations Hub','Hosting inventory'],['deploys','Infrastructure Operations Hub','Deployment overview'],['spend-caps','Financial Operations Tower','Spend against caps'],['infra-incidents','Infrastructure Operations Hub','Infrastructure incidents'],['site-traffic','Growth & Marketing Studio','Site traffic'],['research-briefs','Growth & Marketing Studio','Product research briefs'],['publishing-pipeline','Commerce Operations Center','Publishing pipeline'],['model-inventory','Atlas Airport','Model inventory',['Model Intelligence Lab']],['model-cost','Atlas Airport','Cost per model',['Model Intelligence Lab']],['signals','Atlas Airport','Connected signals',['Atlas · Operations']],['docs','Knowledge & Research Center','Document inventory'],['assignments','Business Operations HQ','Automation assignments']];
for(const [file,name,list,via=[]] of LISTS)test(`Module list: ${list}`,async({page})=>{
 test.setTimeout(300_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,name);await settle(page,2);
 for(const stop of via){await page.getByRole('button',{name:`${stop} →`,exact:true}).click();await settle(page,2);}
 const details=page.getByRole('group',{name:list});await details.locator('summary').click();await details.scrollIntoViewIfNeeded();await settle(page,1);
 await page.screenshot({path:`${out}/list-${file}.png`});
 expect(errors).toEqual([]);
});
