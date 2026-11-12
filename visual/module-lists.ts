import {test,expect} from '@playwright/test';import {mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** Module lists inside building panels (Khaneil, 2026-11-10). Each list opens the whole map, about two
 * minutes on the CI runner, so the lists run from two spec files (module-lists-1/-2) that CI can put in
 * different shards. */
const out=process.env.SHOT_DIR??'artifacts/module-panel';
// The Workflow Automation Hub is a station, so it is reached along the rail from the Financial District.
export const LISTS:[string,string,string,string[]?][]=[['inventory','Atlas Command Center','Module inventory'],['dependencies','Development Hub','Project dependencies'],['workflow-map','Financial District','Workflow map',['Financial District Station','Workflow Automation Hub']],['n8n-runs','Financial District','Live n8n runs',['Financial District Station','Workflow Automation Hub']],['datasets','Data Intelligence Center','Dataset inventory'],['security-incidents','Security Operations Center','Security incidents'],['security-alerts','Security Operations Center','Security alerts'],['hosting','Infrastructure Operations Hub','Hosting inventory'],['deploys','Infrastructure Operations Hub','Deployment overview'],['spend-caps','Financial Operations Tower','Spend against caps'],['infra-incidents','Infrastructure Operations Hub','Infrastructure incidents'],['site-traffic','Growth & Marketing Studio','Site traffic'],['research-briefs','Growth & Marketing Studio','Product research briefs'],['publishing-pipeline','Commerce Operations Center','Publishing pipeline'],['model-inventory','Atlas Airport','Model inventory',['Model Intelligence Lab']],['model-cost','Atlas Airport','Cost per model',['Model Intelligence Lab']],['signals','Atlas Airport','Connected signals',['Atlas · Operations']],['docs','Knowledge & Research Center','Document inventory']];
export function moduleListTests(lists:typeof LISTS){
for(const [file,name,list,via=[]] of lists)test(`Module list: ${list}`,async({page})=>{
 test.setTimeout(300_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,name);await settle(page,2);
 for(const stop of via){await page.getByRole('button',{name:`${stop} →`,exact:true}).click();await settle(page,2);}
 const details=page.getByRole('group',{name:list});await details.locator('summary').click();await details.scrollIntoViewIfNeeded();await settle(page,1);
 await page.screenshot({path:`${out}/list-${file}.png`});
 expect(errors).toEqual([]);
});
}
