import {railJourney} from './rail-journey';
import {test,expect} from '@playwright/test';
import {openAtlas,waitForScene,settle,selectBuilding} from './atlas';
test.use({deviceScaleFactor:1});
for(const width of [1512,390])for(const light of ['day','night'] as const)test(`perimeter rail ${width} ${light}`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light,storage:{powerMode:'saver'}});await waitForScene(page);
 await page.screenshot({path:`docs/perimeter-rail/after-${width}-${light}.png`});
 if(width===1512){
  await selectBuilding(page,'Financial District');await page.getByRole('button',{name:'Financial District Station →',exact:true}).click();await settle(page,2);
  for(const name of ['Financial District Station','Atlas Central Station','Skyline Station','Stadium Station','Airport Station']){
   if(name!=='Financial District Station'){await page.getByRole('button',{name:`${name} →`,exact:true}).click();await settle(page,2);}
   await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
   await page.screenshot({path:`docs/perimeter-rail/${name.split(' ')[0].toLowerCase()}-${light}.png`});
  }
 }
 expect(errors).toEqual([]);
});
test('one rendered train visits every stop and pauses with Traffic',async({page})=>{await railJourney(page);});
