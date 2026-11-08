import {test,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {openAtlas,goTo,settle} from './atlas';
import {sampleGithub,sampleSite} from './propertiesFixtures';
import {NOW} from './github';
for(const width of [1512,1100,390]) for(const mode of ['missing','incidents']) test(`website compact ${width} ${mode}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 let failRefresh=false;
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/properties'){
   const body=sampleSite(u.searchParams.get('domain')!,NOW);
   if(mode==='missing'||failRefresh)return route.fulfill({status:503,json:{message:'Site checks are not available on this device.'}});
   return route.fulfill({json:{...body,checks:{...body.checks,probe:{state:'error',source:'HTTPS request',checkedAt:new Date(NOW).toISOString(),message:'The endpoint did not answer. Check the website connection and retry once the service is available. This extended diagnostic must wrap without clipping controls.'}}}});
  }
  if(u.pathname.startsWith('/api/github')){const body=sampleGithub(u.pathname.slice('/api/github'.length)+u.search,NOW);return route.fulfill({status:body==null?404:200,json:body??{message:'Not Found'}});}
  return route.fulfill({status:404,json:{message:'Not available in fixture'}});
 });
 await openAtlas(page,{storage:{mapMode:'2d'}});await goTo(page,'Mission');await settle(page,4);
 const section=page.locator('#website-management');await section.scrollIntoViewIfNeeded();
 await expect(section.locator('.property-tile')).toHaveCount(18);
 const key=`${width}-${mode}`,dir='artifacts/website-compact';mkdirSync(dir,{recursive:true});
 const height=await section.locator('.property-tile').first().evaluate(e=>e.getBoundingClientRect().height);
 if(process.env.SHOT_PHASE==='before')writeFileSync(`${dir}/${key}.json`,JSON.stringify({height}));
 else {
  expect(height).toBeLessThan(JSON.parse(readFileSync('visual/website-card-sizes.json','utf8'))[key].height*.85);
  if(mode==='missing'){
   await expect(section.locator('.property-coverage')).toHaveCount(2);
   await expect(section.locator('.property-tile').filter({hasText:'Not checked'})).toHaveCount(16);
  }else{await expect(section.locator('.property-incident').first()).toBeVisible();await expect(section).toContainText('The endpoint did not answer');}
  const overflow=await section.evaluate(e=>e.scrollWidth-e.clientWidth);expect(overflow).toBeLessThanOrEqual(1);
  for(const tile of await section.locator('.property-tile').all())expect(await tile.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  const sites=await section.locator('.property').evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y})));
  if(width===1512)expect(sites[0].y).toBeCloseTo(sites[1].y,1);
  if(width<1512)expect(sites[1].y).toBeGreaterThan(sites[0].y);

 }
 await section.evaluate(e=>e.scrollIntoView({block:'start'}));await settle(page,1);
 await page.screenshot({path:`${dir}/${process.env.SHOT_PHASE??'after'}-${key}.png`});
 if(process.env.SHOT_PHASE!=='before'){
  await section.locator('summary').first().focus();await page.keyboard.press('Enter');await expect(section.locator('details').first()).toHaveAttribute('open','');
  writeFileSync(`${dir}/after-${key}.json`,JSON.stringify({height}));
  if(width===1512&&mode==='incidents'){
   failRefresh=true;await section.getByRole('button',{name:'Check now',exact:true}).first().click();await settle(page);
   await expect(section.getByText('Saved results · latest refresh failed. See check details.')).toHaveCount(1);
   await expect(section.locator('.property-tile').filter({hasText:'SSL certificate'}).first()).toContainText('days left');
  }
 }
});
