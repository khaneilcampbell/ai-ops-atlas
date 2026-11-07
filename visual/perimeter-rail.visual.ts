import {test,expect} from '@playwright/test';
import {openAtlas,waitForScene,settle,selectBuilding} from './atlas';
test.use({deviceScaleFactor:1});
for(const width of [1512,390])for(const light of ['day','night'] as const)test(`perimeter rail ${width} ${light}`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light,storage:{powerMode:'saver'}});await waitForScene(page);
 await page.screenshot({path:`docs/perimeter-rail/after-${width}-${light}.png`});
 if(width===1512){
  await selectBuilding(page,'Financial District');await page.getByRole('button',{name:'Financial District Station →',exact:true}).click();await settle(page,2);
  for(const name of ['Financial District Station','Atlas Station','Skyline Station','Stadium Station','Airport Station']){
   if(name!=='Financial District Station'){await page.getByRole('button',{name:`${name} →`,exact:true}).click();await settle(page,2);}
   await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
   await page.screenshot({path:`docs/perimeter-rail/${name.split(' ')[0].toLowerCase()}-${light}.png`});
  }
 }
 expect(errors).toEqual([]);
});
test('one rendered train visits every stop and pauses with Traffic',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await openAtlas(page,{storage:{powerMode:'balanced'}});await waitForScene(page);
 const result=await page.evaluate(async()=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Renderer import missing');
  const fiber:typeof import('@react-three/fiber')=await import(url),state=fiber._roots.get(document.querySelector('canvas')!)!.store.getState(),trains=state.scene.getObjectsByProperty('name','atlas-passenger-train');
  if(trains.length!==1)throw new Error('Expected exactly one passenger train');const train=trains[0],seen=new Set<number>();
  const modules=['/src/catalog/index.ts','/src/views/mapLayout.ts','/src/views/map3d/scene.ts'];const [data,layout,planner]=await Promise.all(modules.map(url=>import(url))),loop=planner.buildScene(layout.layoutMap(data.catalog,[],'district')).communityRail.loop;
  for(let t=0;t<loop.period+1;t+=.1){for(const sub of state.internal.subscribers.filter(s=>String(s.ref.current).includes('service.current')))sub.ref.current(state,.1);if(train.userData.station>=0)seen.add(train.userData.station);}
  state.gl.render(state.scene,state.camera);return {trains:trains.length,visited:seen.size,stops:loop.stops.length,elapsed:train.userData.elapsed};
 });
 expect(result.trains).toBe(1);expect(result.visited).toBe(result.stops);expect(result.elapsed).toBeGreaterThan(60);
 await page.getByRole('checkbox',{name:'Traffic',exact:true}).uncheck();await settle(page,2);
 const paused=await page.evaluate(async()=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1],fiber:typeof import('@react-three/fiber')=await import(url),state=fiber._roots.get(document.querySelector('canvas')!)!.store.getState(),train=state.scene.getObjectByName('atlas-passenger-train')!,before=train.userData.elapsed;
  for(let i=0;i<30;i++)for(const sub of state.internal.subscribers.filter(s=>String(s.ref.current).includes('service.current')))sub.ref.current(state,.1);return {before,after:train.userData.elapsed};
 });expect(paused.after).toBe(paused.before);
});
