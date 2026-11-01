import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {openAtlas,goTo,selectBuilding,settle,waitForOffice,waitForScene} from './atlas';
test.use({viewport:{width:1280,height:800},deviceScaleFactor:1});

test('Projects keeps one renderer across navigation, drawing nothing while closed',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as unknown as {__draws:number;__city:HTMLCanvasElement|null};w.__draws=0;w.__city=null;
  for(const C of [WebGLRenderingContext,WebGL2RenderingContext])for(const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
   const p=C.prototype as unknown as Record<string,(...args:unknown[])=>unknown>,original=p[key];
   if(original)p[key]=function(...args){w.__draws++;return original.apply(this,args);};
  }
 });
 await openAtlas(page);await waitForScene(page);
 await page.locator('.map3d canvas').evaluate(el=>{(window as unknown as {__city:Element}).__city=el;});
 const read=()=>page.evaluate(()=>(window as unknown as {__draws:number}).__draws);
 for(const destination of ['Agents','Repositories','Agents']){
  await goTo(page,destination);
  await expect(page.locator('.projects-host')).toBeHidden();
  await expect(page.getByRole('button',{name:'Night mode',exact:true})).toHaveCount(0);
  const before=await read();
  // An unrelated UI wake must not restart a hidden canvas's pump.
  await page.evaluate(async()=>{const path='/src/lib/power.ts';(await import(path)).wake(800);});
  await page.clock.runFor(1000);expect(await read()).toBe(before);
  await goTo(page,'Projects');
  expect(await page.locator('.map3d canvas').evaluate(el=>el===(window as unknown as {__city:Element}).__city)).toBe(true);
  await expect(page.locator('.map-loading')).toHaveCount(0);
  await expect.poll(async()=>{await page.clock.runFor(34);return read();}).toBeGreaterThan(before);
 }
 await selectBuilding(page,'Atlas HQ');await page.getByRole('button',{name:'Enter building',exact:true}).click();await settle(page,4);await waitForOffice(page);
 await goTo(page,'Agents');await goTo(page,'Projects');
 await expect(page.getByRole('button',{name:'Exit building',exact:true})).toHaveCount(0);
 expect(await page.locator('.map3d canvas').evaluate(el=>el===(window as unknown as {__city:Element}).__city)).toBe(true);
 mkdirSync('artifacts/projects-resume',{recursive:true});await page.screenshot({path:'artifacts/projects-resume/desktop.png'});
 await page.setViewportSize({width:390,height:844});await settle(page);await page.screenshot({path:'artifacts/projects-resume/phone.png'});
 console.log('PROJECTS_RESUME: same canvas retained across 3 returns; hidden draw calls = 0');
});

test('first visit shows loading until the city module and first frame are ready',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/src/views/map3d/Map3D.tsx',async route=>{await gate;await route.continue();});
 const opening=openAtlas(page);
 try{await expect(page.getByText('Loading city…',{exact:true})).toBeVisible();}finally{release();}
 await opening;await waitForScene(page);await settle(page);
 await expect(page.locator('.map-loading')).toHaveCount(0);
});


test('generated test reports do not reload the open preview',async({page})=>{
 await openAtlas(page,{storage:{mapMode:'2d'}});
 let reloads=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())reloads++;});
 const path='playwright-report/atlas-watch-probe.html';mkdirSync('playwright-report',{recursive:true});
 try{writeFileSync(path,'<!doctype html><title>Generated report probe</title>');await page.waitForTimeout(1000);expect(reloads).toBe(0);}finally{unlinkSync(path);}
});
