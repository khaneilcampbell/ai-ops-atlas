import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** People in the Financial District: sidewalk walkers and train riders to Atlas Hills (KC, 2026-10-31). */
// Runs only when SHOT_DIR names a folder; the regular visual checks skip it (software WebGL is slow in CI).
const out=process.env.SHOT_DIR??'';
test.skip(!out,'Set SHOT_DIR to a folder to take crowd screenshots.');
type View=[string,[number,number,number],[number,number,number]];
async function views(page:import('@playwright/test').Page,list:View[]){
 return page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const shots:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  return shots;
 },list);
}
// World positions in the default "By district" layout: the north sidewalk, the station, and the Hills village.
const VIEWS:View[]=[['sidewalk',[10,.3,-3.5],[12,3.2,1.5]],['district',[12,0,-4],[14,16,14]],['station',[12,1.5,-12],[17,7,-3]]];
for(const light of ['day','night'] as const)test(`Financial District people, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,6);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Financial District people, phone',async({page})=>{
 await page.setViewportSize({width:390,height:844});mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,6);
 for(const s of await views(page,[['phone-district',[12,0,-4],[14,22,20]]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
