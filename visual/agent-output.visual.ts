import {expect,test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,goTo,settle} from './atlas';

async function selectAgent(page:import('@playwright/test').Page){
 await goTo(page,'Automations');
 await page.locator('.reg-row[data-id="hub-ci"]').click();
 await settle(page);
}

test('generated files and job results load only in Output, with bounded requests',async({page})=>{
 let reads=0;
 await openAtlas(page,{storage:{mapMode:"2d"}});
 await page.route('https://api.github.com/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(!/\/actions\/runs\/\d+\/(jobs|artifacts)$/.test(path))return route.fallback();
  reads++;
  await route.fulfill({json:path.endsWith('/artifacts')?{total_count:2,artifacts:[{id:501,name:'project-intelligence-hub-documents',size_in_bytes:4096,expired:false,expires_at:'2026-12-01T00:00:00Z'},{id:502,name:'older-documents',size_in_bytes:2048,expired:true}]}:{total_count:1,jobs:[{id:601,name:'Render documents',status:'completed',conclusion:'success',steps:[{name:'Render every project to DOCX',status:'completed',conclusion:'success'}]}]}});
 });
 await selectAgent(page);expect(reads).toBe(0);
 await page.getByRole('tab',{name:'Output',exact:true}).click();await settle(page);
 await expect(page.getByText('project-intelligence-hub-documents',{exact:true})).toBeVisible();
 await expect(page.getByText('older-documents',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Open generated files'})).toHaveCount(1);
 await page.locator('summary').filter({hasText:'Render documents · success'}).click();
 await expect(page.getByText('Render every project to DOCX · success',{exact:true})).toBeVisible();
 expect(reads).toBe(2);
 await page.getByRole('button',{name:'Refresh output',exact:true}).click();await settle(page);expect(reads).toBe(2);
 await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByRole('tab',{name:'Output',exact:true}).click();await settle(page);expect(reads).toBe(2);
 await page.getByText('project-intelligence-hub-documents',{exact:true}).scrollIntoViewIfNeeded();
 mkdirSync('artifacts/agent-output',{recursive:true});await page.screenshot({path:'artifacts/agent-output/desktop.png'});
 await page.setViewportSize({width:390,height:844});await settle(page);await page.getByRole('dialog',{name:'Details'}).getByRole('tab',{name:'Output',exact:true}).click();await settle(page);await expect(page.getByRole('dialog',{name:'Details'}).getByText('project-intelligence-hub-documents',{exact:true})).toBeVisible();expect(reads).toBe(2);await page.getByRole('dialog',{name:'Details'}).getByText('project-intelligence-hub-documents',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/agent-output/phone.png'});
});

test('access errors are not described as no generated output',async({page})=>{
 await openAtlas(page,{storage:{mapMode:"2d"}});
 await page.route('https://api.github.com/**',route=>{
  if(/\/actions\/runs\/\d+\/(jobs|artifacts)$/.test(new URL(route.request().url()).pathname))return route.fulfill({status:403,json:{message:'Actions read permission required'}});
  return route.fallback();
 });
 await selectAgent(page);await page.getByRole('tab',{name:'Output',exact:true}).click();await settle(page);
 await expect(page.getByRole('alert').filter({hasText:'Files: Actions read permission required'})).toBeVisible();
 await expect(page.getByText('This run has no uploaded files.',{exact:false})).toHaveCount(0);
});
