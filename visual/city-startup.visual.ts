import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,settle,waitForScene} from './atlas';
test.use({deviceScaleFactor:2});
test('startup has no loading message and navigation remains usable during file loading',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/src/views/map3d/Map3D.tsx',async route=>{await gate;await route.continue();});
 const opening=openAtlas(page,{light:'night'});
 try{
  await expect(page.locator('.nav-item').first()).toBeVisible();
  await expect(page.getByText(/Loading city|Preparing city|Drawing buildings|taking longer/)).toHaveCount(0);
  await expect(page.locator('.map-loading')).toHaveCount(0);
  await page.locator('.nav-item',{hasText:'Agents'}).first().click();
  release();await opening;await settle(page);
  await expect(page.locator('.projects-host')).toBeHidden();
 }finally{release();}
});
test('first city draw uses bounded resolution and then restores saved quality',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as unknown as {__firstDpr?:number};
  for(const C of [WebGLRenderingContext,WebGL2RenderingContext])for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
   const p=C.prototype as unknown as Record<string,(...args:unknown[])=>unknown>,original=p[name];if(!original)continue;
   p[name]=function(...args){const canvas=(this as unknown as WebGLRenderingContext).canvas as HTMLCanvasElement;if(w.__firstDpr===undefined&&canvas.clientWidth)w.__firstDpr=canvas.width/canvas.clientWidth;return original.apply(this,args);};
  }
 });
 await openAtlas(page,{light:'night',storage:{powerMode:'balanced'}});await waitForScene(page);await settle(page,2);
 expect(await page.evaluate(()=>(window as unknown as {__firstDpr:number}).__firstDpr)).toBeCloseTo(1,1);
 await expect(page.locator('.map-loading')).toHaveCount(0);
 expect(await page.locator('.map3d canvas').evaluate(el=>(el as HTMLCanvasElement).width/el.getBoundingClientRect().width)).toBeGreaterThan(1);
 mkdirSync('artifacts/city-startup',{recursive:true});await page.screenshot({path:'artifacts/city-startup/ready-night.png'});
});
