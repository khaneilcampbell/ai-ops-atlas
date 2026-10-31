import {test,expect,type Page} from '@playwright/test';import {openAtlas,settle,waitForScene} from './atlas';
async function sceneState(page:Page,advance=false){return page.evaluate(async(advance)=>{
 const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Map renderer missing');
 const fiber:typeof import('@react-three/fiber')=await import(url),root=fiber._roots.get(document.querySelector('canvas')!),state=root.store.getState(),materialsUrl='/src/views/map3d/materials.ts',materials=await import(materialsUrl);
 if(advance){const mode=state.frameloop,render=state.gl.render.bind(state.gl),subscribers=state.internal.subscribers;state.setFrameloop('never');const manual=root.store.getState();
  state.gl.render=()=>{};state.internal.subscribers=subscribers.filter(s=>s.priority<=0);
  try{for(let i=1;i<=120;i++)fiber.advance(i/30,false,manual);}finally{state.internal.subscribers=subscribers;state.gl.render=render;render(state.scene,state.camera);state.setFrameloop(mode);}
 }
 return {night:materials.night.value,cars:!!state.scene.getObjectByName('atlas-road-traffic'),truck:state.scene.getObjectByName('atlas-freight-truck')?.visible,roads:!!state.scene.getObjectByName('atlas-road-infrastructure')};
},advance);}
for(const reduced of [false,true])test(`Map buttons respond to clicks (${reduced?'reduced':'normal'} motion)`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await openAtlas(page,{light:'day',storage:{powerMode:reduced?'saver':'balanced'}});await waitForScene(page);
 const night=page.getByRole('button',{name:'Night mode',exact:true}),traffic=page.getByRole('button',{name:'Traffic',exact:true});
 expect(await sceneState(page)).toMatchObject({night:0,cars:true,truck:true,roads:true});
 await night.click();await expect(night).toHaveAttribute('aria-pressed','true');await settle(page,1);expect((await sceneState(page,true)).night).toBe(1);
 await page.screenshot({path:`artifacts/map-controls/night-${reduced?'reduced':'normal'}.png`});
 await night.click();await expect(night).toHaveAttribute('aria-pressed','false');await settle(page,1);expect((await sceneState(page,true)).night).toBe(0);
 await traffic.click();await expect(traffic).toHaveAttribute('aria-pressed','false');await settle(page,1);expect(await sceneState(page)).toMatchObject({cars:false,truck:false,roads:true});
 await page.screenshot({path:`artifacts/map-controls/traffic-off-${reduced?'reduced':'normal'}.png`});
 await traffic.click();await expect(traffic).toHaveAttribute('aria-pressed','true');await settle(page,1);expect(await sceneState(page)).toMatchObject({cars:true,truck:true,roads:true});expect(errors).toEqual([]);
});
