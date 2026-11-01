import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * The GitHub HQ rebuilt as a stacked-slab tower with terrace stairs and trees (KC, 2026-10-31).
 * Writes day/night camera views around it when GITHUB_TOWER_SHOTS=1.
 */
const out=process.env.SHOT_DIR??'artifacts/github-tower';
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
// The GitHub HQ stands at (12.25, 29.25) in the default "By district" layout; the map looks at it from +x/+z.
const [X,Z]=[12.25,29.25];
const at=(dx:number,y:number,dz:number):[number,number,number]=>[X+dx,y,Z+dz];
const VIEWS:View[]=[['front',at(0,4.2,0),at(11,6.5,8)],['close',at(.3,2.6,.6),at(2.8,3.4,4.2)],['terraces',at(.2,5.5,.4),at(3.2,6.2,3.6)],['roof',at(0,8,0),at(3.6,11,4.6)],['side',at(0,4,0),at(10,5,2)],['context',at(0,3.5,0),at(14,12,16)],['podium',at(3,1,.3),at(7.5,3.6,6.5)],['podium-top',at(2.5,1,0),at(5.5,7.5,6)]];
test.skip(!process.env.GITHUB_TOWER_SHOTS,'Screenshots only: set GITHUB_TOWER_SHOTS=1');
for(const light of ['day','night'] as const)test(`GitHub tower, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('GitHub tower nameplate still opens its panel',async({page})=>{
 mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'GitHub Profile');await settle(page,2);await expect(page.getByRole('complementary',{name:'Inspector'}).getByRole('heading',{name:'GitHub Profile',exact:true})).toBeVisible();
 await page.screenshot({path:`${out}/selected.png`});
});
test('GitHub tower on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone',at(0,4,0),at(6,7,10)]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
test('GitHub tower selected on a phone',async({page})=>{
 test.setTimeout(300_000);mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'GitHub Profile');await settle(page,3);
 await page.screenshot({path:`${out}/selected-phone.png`});
});
