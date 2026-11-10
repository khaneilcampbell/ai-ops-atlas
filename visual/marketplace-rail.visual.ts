import {test,expect} from '@playwright/test';
import {openAtlas,waitForScene,settle,selectBuilding} from './atlas';
const before=process.env.COMPACT_BEFORE==='1';
/** Screenshots go to SHOT_DIR when set, otherwise to the test's own output folder (a Mac-only /private/tmp path broke CI). */
const shot=(name:string,out:(n:string)=>string)=>process.env.SHOT_DIR?`${process.env.SHOT_DIR}/${name}`:out(name);
for(const width of [1512,390])for(const light of (before?['day']:['day','night']) as ('day'|'night')[])test(`compact city ${width} ${light}`,async({page},info)=>{
 await page.setViewportSize({width,height:width===390?844:900});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);
 await page.screenshot({path:shot(`${before?'before':'after'}-${width}-${light}.png`,n=>info.outputPath(n))});
 if(!before){
  await expect(page.locator('.m3-plaque').filter({hasText:'Atlas Hills'})).toHaveCount(0);
  if(width===1512){
   for(let i=0;i<3;i++){const station=page.locator('.m3-plaque').filter({hasText:'Workflow Automation Hub'});if(await station.count())break;await page.getByRole('button',{name:'Zoom in',exact:true}).click();await settle(page,2);}
   await selectBuilding(page,'Workflow Automation Hub');
   await expect(page.locator('.panel').getByText('Workflow Automation Hub',{exact:true}).first()).toBeVisible();
   await page.screenshot({path:shot(`station-${light}.png`,n=>info.outputPath(n))});
  }
 }
 expect(errors).toEqual([]);
});
