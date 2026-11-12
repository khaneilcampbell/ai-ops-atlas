import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openAtlas,waitForScene} from './atlas';
for(const phone of [false,true])test(`Command and Commerce street ${phone?'phone':'desktop'}`,async({page})=>{
 const out=process.env.SHOT_DIR??'artifacts/command-commerce-street';mkdirSync(out,{recursive:true});
 if(phone)await page.setViewportSize({width:390,height:844});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'day',storage:{mapTraffic:false}});await waitForScene(page);
 const png=await page.evaluate(async(phone)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  // Fixed framing on main and the draft, looking directly down at both street frontages.
  state.camera.position.set(15.875,phone?50:24,14.76);state.camera.lookAt(15.875,0,14.75);state.camera.updateMatrixWorld();state.gl.render(state.scene,state.camera);
  return canvas.toDataURL('image/png');
 },phone);
 writeFileSync(`${out}/${phone?'phone':'desktop'}.png`,Buffer.from(png.split(',')[1],'base64'));expect(errors).toEqual([]);
});
