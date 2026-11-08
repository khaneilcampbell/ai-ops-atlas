import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * The Portfolio Site rebuilt as a G+8 apartment building with planted balconies (KC, 2026-11-08).
 * Writes day/night camera views around it when PORTFOLIO_SITE_SHOTS=1 (PORTFOLIO_X/Z place the
 * cameras for a 'before' run, when the generic tower has no named object).
 */
const out=process.env.SHOT_DIR??'artifacts/portfolio-site';
type View=[string,[number,number,number],[number,number,number]];
async function views(page:import('@playwright/test').Page,list:View[]){
 return page.evaluate(async([views,at0])=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  // Views are relative to the building, wherever the layout puts it (the app's layout differs from the bare catalog's).
  const hub=state.scene.getObjectByName('portfolio-site'),X=hub?.position.x??at0[0],Z=hub?.position.z??at0[1];
  const shots:{name:string;png:string}[]=[];
  for(const [name,t,e]of views){state.camera.position.set(X+e[0],e[1],Z+e[2]);state.camera.lookAt(X+t[0],t[1],Z+t[2]);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  return shots;
 },[list,[Number(process.env.PORTFOLIO_X??0),Number(process.env.PORTFOLIO_Z??0)]] as const);
}
// Offsets from the building (found by name); the map looks at it from +x/+z.
const at=(dx:number,y:number,dz:number):[number,number,number]=>[dx,y,dz];
const VIEWS:View[]=[['front',at(0,3.8,0),at(3.6,2.8,11.5)],['corner',at(0,3.8,0),at(8.5,3.8,8.5)]];
test.skip(!process.env.PORTFOLIO_SITE_SHOTS,'Screenshots only: set PORTFOLIO_SITE_SHOTS=1');
for(const light of ['day','night'] as const)test(`Portfolio Site, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Portfolio Site nameplate still opens its panel',async({page})=>{
 mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Portfolio Site');await settle(page,2);await expect(page.getByRole('complementary',{name:'Inspector'}).getByRole('heading',{name:'Portfolio Site',exact:true})).toBeVisible();
 await page.screenshot({path:`${out}/selected.png`});
});
test('Portfolio Site on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone',at(0,3.8,0),at(8.5,4.8,11)]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
