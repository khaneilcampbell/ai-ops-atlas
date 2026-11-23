import {test,expect,type Page} from '@playwright/test';import {mkdirSync} from 'node:fs';import {goTo,openAtlas,settle} from './atlas';
/**
 * Agent self-reports (docs/agent-self-reports.md): the Workday tab names each agent's daily report time
 * at the Data Intelligence Center and says it is a draft while n8n isn't showing the workflow published
 * (here n8n isn't connected at all, so no walk is drawn). Shots land in SHOT_DIR when it is set.
 */
const out=process.env.SHOT_DIR??'';
const save=async(page:Page,name:string)=>{if(out){mkdirSync(out,{recursive:true});await page.screenshot({path:`${out}/${name}.png`});}};
for(const [label,width] of [['desktop',1512],['phone',390]] as const)test(`Self-report time in Workday, ${label}`,async({page})=>{
 await page.setViewportSize({width,height:width>600?900:844});await openAtlas(page,{storage:{'registry-prefs-agents':{view:'all'}}});await goTo(page,'Agents');
 await page.getByRole('textbox',{name:'Search agents',exact:true}).fill('atlas-health-monitor');await settle(page,1);
 await page.locator('.reg-row[data-id="atlas-health-monitor"]').click();await settle(page,1);
 await page.getByRole('tab',{name:'Workday',exact:true}).click();await settle(page,1);
 await page.locator('.routine-panel dt').filter({hasText:'Next run'}).scrollIntoViewIfNeeded();await settle(page,1);
 await save(page,`workday-${width}`);
 const row=page.locator('.routine-panel dd').filter({hasText:'Data Intelligence Center'});
 await expect(row).toContainText('Daily at 11:00 (New York) at the Data Intelligence Center');
 await expect(row).toContainText('no walk is drawn');
});
