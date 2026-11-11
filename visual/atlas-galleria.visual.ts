import {test,expect,type Page} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * Atlas Galleria (KC, 2026-11-07): the shopping mall that replaced the Marketplace Gardens. Fixed
 * camera views over the old garden lot, so the same script shoots main (before) and the branch
 * (after); the interior views run only where the Galleria exists.
 * Run: GALLERIA_SHOTS=1 SHOT_DIR=... npx playwright test -c visual atlas-galleria
 */
const out=process.env.SHOT_DIR??'artifacts/atlas-galleria';
test.skip(!process.env.GALLERIA_SHOTS,'Screenshots on request only (GALLERIA_SHOTS=1).');
const VIEWS:[string,number[],number[]][]=[
 ['east',[46,12,33],[27,1,27]],['top',[29.3,27,29],[29.3,0,27.6]],['entrance',[38.5,4.2,31],[29.5,2,26]],['north-west',[18,9,15],[29,2,26]],
];
async function shoot(page:Page,prefix:string){
 const shots=await page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  return views.map(([name,p,t])=>{state.camera.position.set(p[0],p[1],p[2]);state.camera.lookAt(t[0],t[1],t[2]);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);return {name,png:canvas.toDataURL('image/png')};});
 },VIEWS);
 for(const s of shots)writeFileSync(`${out}/${prefix}-${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
}
for(const light of ['day','night'] as const)test(`Galleria exterior, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Product Marketplace');await settle(page,3);
 await shoot(page,`desktop-${light}`);
 const galleria=page.locator('.m3-plaque[title^="Retail & Amenities Center ·"]');
 if(await galleria.count()){await selectBuilding(page,'Retail & Amenities Center');await settle(page,3);await page.screenshot({path:`${out}/desktop-selected-${light}.png`});}
});
test('Galleria interior',async({page})=>{
 test.setTimeout(900_000);mkdirSync(out,{recursive:true});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 test.skip(!(await page.locator('.m3-plaque[title^="Retail & Amenities Center ·"]').count()),'No Galleria on this build.');
 await selectBuilding(page,'Retail & Amenities Center');await settle(page,3);
 await page.getByRole('button',{name:'Enter building',exact:true}).click();await page.clock.runFor(1200);await settle(page,4);await waitForScene(page);
 const nav=page.getByRole('navigation',{name:'Choose Retail & Amenities Center floor'});await expect(nav).toBeVisible();
 for(const [label,slug] of [['Basement','basement'],['Ground','ground'],['Floor 1','floor1'],['Floor 2','floor2'],['All floors','all']]){await nav.getByRole('button',{name:label,exact:true}).click();await settle(page,4);await waitForScene(page);await page.screenshot({path:`${out}/interior-${slug}.png`});}
});
test('Galleria on a phone',async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Product Marketplace');await settle(page,3);await shoot(page,'phone');
 if(await page.locator('.m3-plaque[title^="Retail & Amenities Center ·"]').count()){await selectBuilding(page,'Retail & Amenities Center');await settle(page,3);await page.screenshot({path:`${out}/phone-selected.png`});}
});
