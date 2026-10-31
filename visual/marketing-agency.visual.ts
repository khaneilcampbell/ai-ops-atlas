import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** Benjaire Marketing Agency exterior on the new bay lot (KC, 2026-10-31). Writes PNGs, compares nothing. */
const out=process.env.SHOT_DIR??'artifacts/marketing-agency';
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
const VIEWS:View[]=[['context',[23,0,3],[38,18,26]],['kc-angle',[24,0,4],[6,16,24]],['corner',[23,1.6,2.2],[31,3.2,11.5]],['front',[22.5,1.8,2.2],[21,4.5,14]],['behind',[23,1.5,2],[16,6,-9]],['top',[23,0,3.5],[23.01,24,14]]];
for(const light of ['day','night'] as const)test(`Benjaire Marketing Agency, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Benjaire Marketing Agency nameplate opens its panel',async({page})=>{
 mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Benjaire Marketing Agency');await settle(page,2);
 await expect(page.getByRole('heading',{name:'Benjaire Marketing Agency',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/Enter building/})).toBeVisible();
 await page.screenshot({path:`${out}/selected.png`});
});
test('Benjaire Marketing Agency on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone',[23,0,3],[34,22,24]]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
async function floorMarkers(page:import('@playwright/test').Page,count:number){
 for(let i=0;i<20&&(await page.locator('[data-floor-label]').count())!==count;i++){await page.waitForTimeout(150);await settle(page,2);}
 await expect(page.locator('[data-floor-label]')).toHaveCount(count);
}
for(const [light,size] of [['day',{width:1440,height:900}],['night',{width:1440,height:900}],['phone',{width:390,height:844}]] as const)test(`Benjaire Marketing Agency interior, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize(size);await openAtlas(page,{light:light==='night'?'night':'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Benjaire Marketing Agency');await settle(page,2);
 await page.getByRole('button',{name:'Enter building',exact:true}).click();await settle(page,4);
 await expect(page.locator('.skyline-interior')).toBeVisible();
 const nav=page.getByRole('navigation',{name:'Choose Benjaire Marketing Agency floor'});
 await floorMarkers(page,4);await settle(page,3);await page.screenshot({path:`${out}/interior-all-${light}.png`});
 for(const [label,name] of [['Lobby','lobby'],['Floor 1','floor1'],['Floor 2','floor2'],['Floor 3','floor3']] as const){
  if(light==='phone'&&name!=='lobby')continue;
  await nav.getByRole('button',{name:label,exact:true}).click();await floorMarkers(page,1);await settle(page,3);
  await page.screenshot({path:`${out}/interior-${name}-${light}.png`});
 }
 await page.getByRole('button',{name:/Exit Benjaire Marketing Agency/}).click();await settle(page,3);
 await expect(page.locator('.skyline-interior')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('Benjaire Marketing Agency walk-through test reaches every floor and walks out',async({page})=>{
 test.setTimeout(1_200_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Benjaire Marketing Agency');await settle(page,2);
 await page.getByRole('button',{name:'Enter building',exact:true}).click();await settle(page,4);await floorMarkers(page,4);
 await page.getByRole('button',{name:'Walk-through test'}).click();await settle(page,3);
 const note=page.locator('.skyline-interior-note');const seen=new Set<string>();
 // The walker follows the clock, so jump ahead and draw a couple of frames at each stop.
 for(let i=0;i<40&&!(await note.textContent())?.includes('complete');i++){
  await page.clock.fastForward(2500);await settle(page,2);
  const text=await note.textContent()??'';const m=text.match(/Walk-through test · (Lobby|Floor \d)/);if(m)seen.add(m[1]);
  if([2,7,12].includes(i))await page.screenshot({path:`${out}/walk-${i}.png`});
 }
 await expect(note).toContainText('Walk-through test complete');
 expect([...seen].sort()).toEqual(['Floor 1','Floor 2','Floor 3','Lobby']);
 expect(errors).toEqual([]);
});
