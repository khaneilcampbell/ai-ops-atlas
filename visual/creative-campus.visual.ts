import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** Atlas Creative Campus on its island west of the airport (Khaneil, 2026-11-24). Writes PNGs, compares nothing. */
const out=process.env.SHOT_DIR??'artifacts/creative-campus';
type View=[string,[number,number,number],[number,number,number]];
async function views(page:import('@playwright/test').Page,list:View[]){
 return page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const shots:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.far=Math.max(state.camera.far,600);state.camera.updateProjectionMatrix();state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  return shots;
 },list);
}
// World positions in the default "By district" layout: the island sits west of the airport.
const VIEWS:View[]=[['aerial',[-57,0,35],[-35,22,62]],['plaza',[-56,0,36],[-46,9,50]],['bridge',[-48,0,46],[-30,14,64]],['top',[-57,0,35],[-56.99,48,35.5]]];
for(const light of ['day','night'] as const)test(`Atlas Creative Campus, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1512,height:945});await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
async function floorMarkers(page:import('@playwright/test').Page,count:number){
 // The interior is a lazy chunk; wait by wall-clock time for its floors to mount.
 const until=Date.now()+45_000;
 while(Date.now()<until&&(await page.locator('[data-floor-label]').count())!==count){await page.waitForTimeout(250);await settle(page,2);}
 await expect(page.locator('[data-floor-label]')).toHaveCount(count);
}
for(const [light,size] of [['day',{width:1512,height:945}],['night',{width:1512,height:945}],['phone',{width:390,height:844}]] as const)test(`Atlas Creative Campus interior, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize(size);await openAtlas(page,{light:light==='night'?'night':'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Atlas Creative Campus');await settle(page,2);
 await expect(page.getByText('open desks are ready')).toBeVisible();
 await page.screenshot({path:`${out}/panel-${light}.png`});
 await page.getByRole('button',{name:'Enter building',exact:true}).click();await settle(page,4);
 await expect(page.locator('.skyline-interior')).toBeVisible();
 const nav=page.getByRole('navigation',{name:'Choose Atlas Creative Campus floor'});
 await floorMarkers(page,5);await settle(page,3);await page.screenshot({path:`${out}/interior-all-${light}.png`});
 for(const [label,name] of [['Lobby','lobby'],['Floor 2','floor2'],['Floor 4','floor4']] as const){
  await nav.getByRole('button',{name:label,exact:true}).click();await floorMarkers(page,1);await settle(page,3);
  await page.screenshot({path:`${out}/interior-${name}-${light}.png`});
 }
 await page.getByRole('button',{name:/Exit Atlas Creative Campus/}).click();await settle(page,3);
 await expect(page.locator('.skyline-interior')).toHaveCount(0);
 expect(errors).toEqual([]);
});
