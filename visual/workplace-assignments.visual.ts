import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {openAtlas,settle,waitForScene} from './atlas';
test.use({deviceScaleFactor:1});
test('existing OpenAI assignment uses agent inspector and recorded Output',async({page})=>{
 await openAtlas(page,{light:'day'});
 const roster=await page.evaluate(async()=>{const {catalog}=await import('/src/catalog/index.ts');return catalog.agents.map(a=>({id:a.id,name:a.name,projectId:a.projectId,repository:a.repository,building:a.workplace?.building??catalog.projects.find(p=>p.id===a.projectId)?.name,floor:a.workplace?.floor??a.officeFloor??4,room:a.workplace?.room??'Project desk',external:!!a.workplace}));});
 writeFileSync('artifacts/workplace-roster.json',JSON.stringify(roster,null,2));
 await page.evaluate(async()=>{const {enterBuilding}=await import('/src/views/office/store.ts');enterBuilding('skyline-business:Model Lab',true);});await settle(page,4);await waitForScene(page);
 const nav=page.getByRole('navigation',{name:'Choose Model Lab floor'});await nav.getByRole('button',{name:'Floor 4',exact:true}).click();await page.clock.runFor(200);await settle(page,3);
 await page.locator('.skyline-interior canvas').dispatchEvent('wheel',{deltaY:0});await page.clock.runFor(300);await settle(page,2);
 await page.getByRole('button',{name:/Suite 401/}).click();await expect(page.getByLabel('Assigned agent inspector')).toContainText('Workspace assigned');
 await page.getByRole('tab',{name:'Output',exact:true}).click();await expect(page.getByLabel('Latest recorded work')).toBeVisible();
 await page.screenshot({path:'artifacts/openai-assigned-worker.png'});await page.getByRole('button',{name:'Close details'}).click();await expect(page.getByLabel('Assigned agent inspector')).toHaveCount(0);
});
