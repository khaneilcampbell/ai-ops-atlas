import {test,expect} from '@playwright/test';
import {openAtlas,waitForScene,settle,selectBuilding} from './atlas';
const before=process.env.COMPACT_BEFORE==='1';
for(const width of [1512,390])for(const light of (before?['day']:['day','night']) as ('day'|'night')[])test(`compact city ${width} ${light}`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:900});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);
 await page.screenshot({path:`/private/tmp/atlas-compact-city/docs/compact-city/${before?'before':'after'}-${width}-${light}.png`});
 if(!before){
  await expect(page.locator('.m3-plaque').filter({hasText:'Atlas Hills'})).toHaveCount(0);
  if(width===1512){
   for(let i=0;i<3;i++){const station=page.locator('.m3-plaque').filter({hasText:'Atlas Central Station'});if(await station.count())break;await page.getByRole('button',{name:'Zoom in',exact:true}).click();await settle(page,2);}
   await selectBuilding(page,'Atlas Central Station');
   await expect(page.locator('.panel').getByText('Atlas Central Station',{exact:true}).first()).toBeVisible();
   await page.screenshot({path:`/private/tmp/atlas-compact-city/docs/compact-city/station-${light}.png`});
  }
 }
 expect(errors).toEqual([]);
});
