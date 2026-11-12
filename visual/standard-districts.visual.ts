import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openAtlas} from './atlas';
for(const mode of ['day','night','phone'] as const)test(`Standard district selection, ${mode}`,async({page})=>{
 test.setTimeout(240000);const out=process.env.SHOT_DIR??'artifacts/standard-districts';mkdirSync(out,{recursive:true});
 if(mode==='phone')await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:mode==='night'?'night':'day',storage:{mapTraffic:false}});await page.clock.resume();
 for(const [id,name] of [['intelligence-hub','Agent Operations Center'],['benjaire-site','Business Operations HQ']] as const){
  await page.clock.resume();const plaque=page.locator('.m3-plaque').filter({hasText:name}).first();
  await expect(plaque).toHaveCount(1);await plaque.dispatchEvent('click');await page.waitForTimeout(100);await page.clock.pauseAt(new Date((await page.evaluate(()=>Date.now()))+10000));
  await expect(page.getByRole('complementary',{name:'Inspector'}).getByRole('heading',{name,exact:true})).toBeVisible();
  if(mode==='phone'){
   await page.screenshot({path:`${out}/${id}-${mode}.png`});
   await page.clock.resume();await page.getByRole('button',{name:'Close details',exact:true}).click();await page.waitForTimeout(100);continue;
  }
  const png=await page.evaluate(async({id,phone})=>{
   const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
   const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
   const paths={catalog:'/src/catalog/index.ts',layout:'/src/views/mapLayout.ts'};
   const {catalog}=await import(paths.catalog),{layoutMap}=await import(paths.layout);
   const d=layoutMap(catalog,[],'district').districts.find((d:{project:{id:string}})=>d.project.id===id),x=d.ox+d.size/2,z=d.oy+d.size/2;
   const k=phone?1.8:1;state.camera.position.set(x+12*k,16*k,z+18*k);state.camera.lookAt(x,1,z);state.camera.updateMatrixWorld();state.gl.render(state.scene,state.camera);
   return canvas.toDataURL('image/png');
  },{id,phone:mode==='phone'});
  writeFileSync(`${out}/${id}-${mode}.png`,Buffer.from(png.split(',')[1],'base64'));
 }
});
