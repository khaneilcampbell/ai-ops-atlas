import {test,expect} from '@playwright/test';
import {PNG} from 'pngjs';
import {mkdirSync} from 'node:fs';
import {openAtlas,settle,waitForScene} from './atlas';
for(const light of ['day','night'] as const)test(`map zoom stays bounded and draws the complete ${light} canvas`,async({page})=>{
 test.setTimeout(600_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);
 const state=async(mode:'read'|'disturb',dpr=1)=>page.evaluate(async({mode,dpr})=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text();
  const path=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1];const fiber=await import(path);
  const canvas=document.querySelector('.map3d canvas') as HTMLCanvasElement,s=fiber._roots.get(canvas).store.getState();
  if(mode==='disturb'){
   s.setDpr(dpr);s.gl.setViewport(0,0,100,100);s.gl.setScissor(0,0,100,100);s.gl.setScissorTest(true);s.invalidate();
  }
  // Vector4-compatible target, without importing a second Three build.
  const viewport={x:0,y:0,z:0,w:0,copy(v:{x:number;y:number;z:number;w:number}){Object.assign(this,v);return this;}};
  s.gl.getViewport(viewport);
  return {distance:s.camera.position.y/s.camera.matrixWorld.elements[9],viewport:[viewport.x,viewport.y,viewport.z,viewport.w],width:s.size.width,height:s.size.height,scissor:s.gl.getScissorTest(),error:s.gl.getContext().getError()};
 },{mode,dpr});
 const home=await state('read');
 for(let i=0;i<20;i++)await page.getByRole('button',{name:'Zoom out',exact:true}).click();await settle(page,2);
 const far=await state('read');expect(far.distance).toBeLessThanOrEqual(home.distance*1.06);
 mkdirSync('artifacts/map-zoom',{recursive:true});await page.screenshot({path:`artifacts/map-zoom/${light}-overview.png`});
 for(const dpr of [1,2,1.5]){
  await state('disturb',dpr);
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();await settle(page,3);
  const s=await state('read');expect(s.viewport).toEqual([0,0,s.width,s.height]);expect(s.scissor).toBe(false);expect(s.error).toBe(0);
  const png=PNG.sync.read(await page.locator('.map3d canvas').screenshot());let black=0;
  for(let i=0;i<png.data.length;i+=4)if(png.data[i]<2&&png.data[i+1]<2&&png.data[i+2]<2)black++;
  expect(black/(png.width*png.height),'no large pure-black viewport patch').toBeLessThan(.05);
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();await settle(page,1);
 }
 for(let i=0;i<10;i++)await page.getByRole('button',{name:'Zoom in',exact:true}).click();await settle(page,3);
 const close=PNG.sync.read(await page.locator('.map3d canvas').screenshot());let black=0;
 for(let i=0;i<close.data.length;i+=4)if(close.data[i]<2&&close.data[i+1]<2&&close.data[i+2]<2)black++;
 expect(black/(close.width*close.height),'no black patch at close zoom').toBeLessThan(.05);
 expect((await state('read')).error).toBe(0);
 await page.screenshot({path:`artifacts/map-zoom/${light}-zoom.png`});expect(errors).toEqual([]);
});
