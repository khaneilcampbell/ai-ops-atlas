import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * The Intelligence Hub rebuilt as a ribbed corner building with planted loggia bays (Khaneil, 2026-11-08).
 * Writes day/night camera views around it when INTELLIGENCE_HUB_SHOTS=1.
 */
const out=process.env.SHOT_DIR??'artifacts/intelligence-hub';
type View=[string,[number,number,number],[number,number,number]];
async function views(page:import('@playwright/test').Page,list:View[]){
 return page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  // Views are relative to the building, wherever the layout puts it (the app's layout differs from the bare catalog's).
  const hub=state.scene.getObjectByName('intelligence-hub'),X=hub?.position.x??29.25,Z=hub?.position.z??17.25;
  const shots:{name:string;png:string}[]=[];
  for(const [name,t,e]of views){state.camera.position.set(X+e[0],e[1],Z+e[2]);state.camera.lookAt(X+t[0],t[1],Z+t[2]);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  return shots;
 },list);
}
// Offsets from the building (found by name; before the rebuild it stood at 29.25, 17.25); the map looks at it from +x/+z.
const at=(dx:number,y:number,dz:number):[number,number,number]=>[dx,y,dz];
const VIEWS:View[]=[['front',at(0,5.6,0),at(14,8,14)],['corner',at(0,2.4,0),at(5.5,3,5.5)],['bays',at(0,6.2,0),at(4.6,6.8,4.6)],['street',at(0,1.3,0),at(3.6,1.6,3.6)],['roof',at(0,10,0),at(5,13,6)],['side',at(0,5.6,0),at(20,7,3)],['back',at(0,5.6,0),at(-12,8,-14)],['context',at(0,4,0),at(22,16,24)]];
test.skip(!process.env.INTELLIGENCE_HUB_SHOTS,'Screenshots only: set INTELLIGENCE_HUB_SHOTS=1');
for(const light of ['day','night'] as const)test(`Intelligence Hub, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Intelligence Hub nameplate still opens its panel',async({page})=>{
 mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Agent Operations Center');await settle(page,2);await expect(page.getByRole('complementary',{name:'Inspector'}).getByRole('heading',{name:'Agent Operations Center',exact:true})).toBeVisible();
 await page.screenshot({path:`${out}/selected.png`});
});
test('Intelligence Hub on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone',at(0,5.6,0),at(14,9,16)]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
