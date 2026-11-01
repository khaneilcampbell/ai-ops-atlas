import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** BMW beside the Financial District, and the Hills train stop in Financial Park (KC, 2026-10-31). */
const out=process.env.SHOT_DIR??'artifacts/bmw-park-station';
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
// World positions in the default "By district" layout.
const VIEWS:View[]=[['overview',[24,0,-9],[30,34,30]],['bmw',[41,1.5,-8],[46,9,5]],['park-station',[12,1.5,-13],[16,10,0]],['behind',[22,2,-12],[30,16,-38]]];
for(const light of ['day','night'] as const)test(`BMW and Financial Park station, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:`${out}/default-${light}.png`});
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('BMW and station nameplates open their panels',async({page})=>{
 mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'BMW');await settle(page,2);await expect(page.getByRole('heading',{name:'BMW',exact:true})).toBeVisible();await page.screenshot({path:`${out}/bmw-selected.png`});
 await selectBuilding(page,'Financial District');await settle(page,2);
 await page.getByRole('button',{name:'Financial District Station →',exact:true}).click();await settle(page,3);await expect(page.getByRole('heading',{name:'Financial District Station',exact:true})).toBeVisible();
 await page.screenshot({path:`${out}/station-selected.png`});
});
test('BMW and Financial Park on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone-overview',[24,0,-10],[36,30,22]]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
