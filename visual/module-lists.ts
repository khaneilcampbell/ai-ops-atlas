import {test,expect} from '@playwright/test';import {mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** Module lists inside building panels (Khaneil, 2026-11-10). Each list opens the whole map, about two
 * minutes on the CI runner, so the lists run from two spec files (module-lists-1/-2) that CI can put in
 * different shards. */
const out=process.env.SHOT_DIR??'artifacts/module-panel';
// The Workflow Automation Hub is a station, so it is reached along the rail from the Financial District.
export const LISTS:[string,string,string,string[]?][]=[['inventory','Atlas Command Center','Module inventory'],['dependencies','AI Engineering & Research Center','Project dependencies'],['workflow-map','Business Operations Station','Workflow map',['Workflow Automation Hub']],['n8n-runs','Business Operations Station','Live n8n runs',['Workflow Automation Hub']],['datasets','Business Operations HQ','Dataset inventory'],['security-incidents','Security & Infrastructure Center','Security incidents'],['security-alerts','Security & Infrastructure Center','Security alerts'],['hosting','Security & Infrastructure Center','Hosting inventory'],['deploys','Security & Infrastructure Center','Deployment overview'],['spend-caps','Business Operations HQ','Spend against caps'],['infra-incidents','Security & Infrastructure Center','Infrastructure incidents'],['site-traffic','Product & Growth Studio','Site traffic'],['research-briefs','Product & Growth Studio','Product research briefs'],['publishing-pipeline','Product & Growth Studio','Publishing pipeline'],['model-inventory','AI Engineering & Research Center','Model inventory'],['model-cost','AI Engineering & Research Center','Cost per model'],['signals','Security & Infrastructure Center','Connected signals'],['docs','AI Engineering & Research Center','Document inventory'],['assignments','Business Operations HQ','Automation assignments'],['kpis','Business Operations HQ','Operational KPIs']];
export function moduleListTests(lists:typeof LISTS){
for(const [file,name,list,via=[]] of lists)test(`Module list: ${list}`,async({page})=>{
 test.setTimeout(300_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,name);await settle(page,2);
 for(const stop of via){await page.getByRole('button',{name:`${stop} →`,exact:true}).click();await settle(page,2);}
 const details=page.getByRole('group',{name:list}).first();await details.locator('summary').click();await details.scrollIntoViewIfNeeded();await settle(page,1);
 await page.screenshot({path:`${out}/list-${file}.png`});
 expect(errors).toEqual([]);
});
}
