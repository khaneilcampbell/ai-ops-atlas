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
// Atlas HQ stands at (40.73, 15.13) in the default "By district" layout, about 4 map units across
// (ATLAS_HQ_SIZE); the map looks at it from +x/+z. Views are framed for that size.
const X=40.73,Z=15.13,F=1.6;
const v=(t:[number,number,number],e:[number,number,number]):[[number,number,number],[number,number,number]]=>[[X+t[0]*F,t[1]*F,Z+t[2]*F],[X+e[0]*F,e[1]*F,Z+e[2]*F]];
const VIEWS:View[]=[['concept',...v([0,.7,0],[2.6,6.2,7.2])],['front',...v([0,1.4,0],[5.5,5,8])],['close',...v([0,1.2,.6],[2.4,3,4.4])],['roof',...v([0,1.6,0],[3.5,6.5,4.5])],['side',...v([0,1.2,0],[6.5,2.6,1.5])],['context',...v([1.5,1,-1.5],[12.5,13,14.5])]];
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
 for(const s of await views(page,[['phone',...v([0,1.2,0],[4,4.2,7])]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
