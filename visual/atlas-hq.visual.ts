import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * Atlas Command Center, its lobby and four office floors in cream stone, green glass and brass
 * (Khaneil, 2026-11-17). Writes the map as it opens, day/night camera views around the building,
 * the selected panel and a phone view. Captures of the running app, not concept images.
 */
const out=process.env.SHOT_DIR??'artifacts/atlas-hq';
type View=[string,[number,number,number],[number,number,number]];
async function views(page:import('@playwright/test').Page,list:View[]){
 return page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const shots:{name:string;png:string}[]=[];
  // The map fits near/far to its own view (fogRange.ts); a close-up needs a near plane close to the eye.
  const cam=state.camera as import('three').PerspectiveCamera;cam.near=.05;cam.far=400;cam.updateProjectionMatrix();
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  return shots;
 },list);
}
// Atlas HQ stands at (40.73, 14.39) in the default "By district" layout; the map looks at it from +x/+z.
const X=40.73,Z=14.39;
const VIEWS:View[]=[['concept',[X,.7,Z],[X+2.6,6.2,Z+7.2]],['front',[X,1.4,Z],[X+5.5,5,Z+8]],['close',[X,1.5,Z+.6],[X+2.4,3,Z+4.4]],['roof',[X,1.6,Z],[X+3.5,6.5,Z+4.5]],['side',[X,1.2,Z],[X+6.5,2.6,Z+1.5]],['context',[X+1.5,1,Z-1.5],[X+12.5,13,Z+14.5]]];
for(const light of ['day','night'] as const)test(`Atlas HQ, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 // The map exactly as it opens, before the camera is moved.
 await page.screenshot({path:`${out}/map-${light}.png`});
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Atlas HQ nameplate still opens its panel',async({page})=>{
 mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Atlas Command Center');await settle(page,2);await expect(page.getByRole('complementary',{name:'Inspector'}).getByRole('heading',{name:'Atlas Command Center',exact:true})).toBeVisible();
 await page.screenshot({path:`${out}/selected.png`});
});
test('Atlas HQ on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:`${out}/phone-map.png`});
 for(const s of await views(page,[['phone',[X,1.2,Z],[X+4,4.2,Z+7]]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
