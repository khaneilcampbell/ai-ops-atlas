import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openAtlas,settle,waitForScene} from './atlas';

for(const mode of ['day','night','phone'] as const)test(`Marketing façade sign, ${mode}`,async({page})=>{
 const out=process.env.SHOT_DIR??'artifacts/marketing-sign';mkdirSync(out,{recursive:true});
 if(mode==='phone')await page.setViewportSize({width:390,height:844});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:mode==='night'?'night':'day'});await waitForScene(page);await settle(page,1);
 const png=await page.evaluate(async(phone)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text();
  const url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];
  if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url);
  const canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();
  if(!state)throw new Error('Map renderer not found');
  const paths={catalog:'/src/catalog/index.ts',layout:'/src/views/mapLayout.ts',scene:'/src/views/map3d/scene.ts',agency:'/src/views/map3d/marketingAgencyPlan.ts'};
  const {catalog}=await import(paths.catalog);
  const {layoutMap}=await import(paths.layout);
  const {buildScene,TERRACE_H}=await import(paths.scene);
  const {AGENCY}=await import(paths.agency);
  const a=buildScene(layoutMap(catalog,[],'district')).agency!;
  const x=a.x+AGENCY.word.x,y=TERRACE_H+AGENCY.word.y,z=a.z+AGENCY.depth+.008;
  state.camera.position.set(x,y,z+(phone?5.2:2.2));state.camera.lookAt(x,y,z);state.camera.updateMatrixWorld();
  state.gl.render(state.scene,state.camera);return canvas.toDataURL('image/png');
 },mode==='phone');
 writeFileSync(`${out}/${mode}.png`,Buffer.from(png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
