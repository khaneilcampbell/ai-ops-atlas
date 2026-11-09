import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,settle,waitForScene} from './atlas';
const out=process.env.SHOT_DIR??'artifacts/commons',before=process.env.COMMONS_BEFORE==='1';
for(const mode of ['day','night','phone'] as const)test(`Atlas Commons ${mode}`,async({page})=>{
 test.setTimeout(300000);mkdirSync(out,{recursive:true});
 if(mode==='phone')await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:mode==='night'?'night':'day'});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:`${out}/overview-${mode}.png`});
 await page.evaluate(async()=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw Error('Fiber import unavailable');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)!.store.getState();
  state.camera.position.set(23,12,53);state.camera.lookAt(16,0.6,39.5);state.camera.updateMatrixWorld();
  const controls=state.controls as unknown as {target:{set:(x:number,y:number,z:number)=>void};update:()=>void}|null;controls?.target.set(16,.6,39.5);controls?.update();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);
 });
 await settle(page,1);await page.screenshot({path:`${out}/park-${mode}.png`});
 if(!before){
  const plaque=page.getByRole('button',{name:/^Atlas Commons Planned/});await expect(plaque).toBeVisible();await plaque.click();
  await expect(page.getByRole('heading',{name:'Atlas Commons',exact:true})).toBeVisible();
  await expect(page.getByText('Visual public space. No agents, bookings or services activated.',{exact:true})).toBeVisible();
  await page.screenshot({path:`${out}/selected-${mode}.png`});
 }
});
