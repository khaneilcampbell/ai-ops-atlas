import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** Atlas HQ rebuilt as a curving glass tower (KC, 2026-10-31). Writes day/night camera views around it. */
const out=process.env.SHOT_DIR??'artifacts/atlas-hq';
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
// Atlas HQ stands at (2.5, 14.75) in the default "By district" layout; the map looks at it from +x/+z.
const VIEWS:View[]=[['front',[2.5,3,14.75],[11,7.5,27]],['close',[2.6,1,15.4],[5.2,1.8,19.6]],['roof',[2.5,2.5,14.75],[6.5,9,19.5]],['side',[2.5,2.6,14.5],[11,4,15.5]],['context',[4,1,13],[15,13,29]]];
for(const light of ['day','night'] as const)test(`Atlas HQ, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Atlas HQ nameplate still opens its panel',async({page})=>{
 mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Atlas HQ');await settle(page,2);await expect(page.getByRole('complementary',{name:'Inspector'}).getByRole('heading',{name:'Atlas HQ',exact:true})).toBeVisible();
 await page.screenshot({path:`${out}/selected.png`});
});
test('Atlas HQ on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone',[2.5,2.4,14.75],[9,6,24]]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
