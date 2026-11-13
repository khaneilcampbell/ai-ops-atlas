import {test,expect,type Page} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
// Runs only when SHOT_DIR names a folder; the regular visual checks skip it (software WebGL is slow in CI).
test.skip(!process.env.SHOT_DIR,'Set SHOT_DIR to a folder to take station screenshots.');
/** Every perimeter loop station has the Dubai-style shell and glazed skybridge from #158 (KC, 2026-11-07). */
const STATIONS=['Financial District Station','Workflow Automation Hub','Events Arena Station'];
const slug=(name:string)=>name.split(' ')[0].toLowerCase();
const out=process.env.SHOT_DIR??'artifacts/financial-station';
async function openStation(page:Page){
 await selectBuilding(page,'Financial District');await settle(page,2);
 await page.getByRole('button',{name:'Financial District Station →',exact:true}).click();await settle(page,3);
 await expect(page.getByRole('heading',{name:'Financial District Station',exact:true})).toBeVisible();
}
/** Close views around the camera target the station selection framed, rendered straight from the fiber root. */
async function closeViews(page:Page){
 return page.evaluate(async()=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  // Where the framed view's centre ray meets platform height.
  const cam=state.camera,dir=cam.getWorldDirection(cam.position.clone()),k=(2.5-cam.position.y)/dir.y,c={x:cam.position.x+dir.x*k,y:1.5,z:cam.position.z+dir.z*k};
  const shots:{name:string;png:string}[]=[];
  for(const [name,dx,dy,dz]of [['close-north',5,6,-11],['close-park',-4,5,9]] as const){state.camera.position.set(c.x+dx,c.y+dy,c.z+dz);state.camera.lookAt(c.x,c.y+1,c.z);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  return shots;
 });
}
for(const light of ['day','night'] as const)test(`Financial District Station, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 await openStation(page);
 for(const name of STATIONS){
  if(name!==STATIONS[0]){await page.getByRole('button',{name:`${name} →`,exact:true}).click();await settle(page,3);await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();}
  await page.screenshot({path:`${out}/desktop-${slug(name)}-selected-${light}.png`});
  for(const s of await closeViews(page))writeFileSync(`${out}/desktop-${slug(name)}-${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 }
 expect(errors).toEqual([]);
});
test('Financial District Station on a phone',async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await openStation(page);await page.screenshot({path:`${out}/phone-financial-selected-day.png`});
 await page.getByRole('button',{name:'Events Arena Station →',exact:true}).click();await settle(page,3);await page.screenshot({path:`${out}/phone-stadium-selected-day.png`});
});
