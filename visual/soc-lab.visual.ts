import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * The SOC Lab rebuilt as a braced glass tower with three cyan-lit green terraces (KC, 2026-11-09).
 * Writes day/night camera views around it when SOC_LAB_SHOTS=1.
 */
const out=process.env.SHOT_DIR??'artifacts/soc-lab';
type View=[string,[number,number,number],[number,number,number]];
async function views(page:import('@playwright/test').Page,list:View[]){
 const fallback=(process.env.SOC_LAB_AT??'25.8,6.3').split(',').map(Number);
 return page.evaluate(async({views,fallback})=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  // Views are relative to the building, wherever the layout puts it (the app's layout differs from the bare catalog's).
  const lab=state.scene.getObjectByName('soc-lab'),X=lab?.position.x??fallback[0],Z=lab?.position.z??fallback[1];
  console.log(`SOC_LAB_AT=${X},${Z}`);
  const shots:{name:string;png:string}[]=[];
  for(const [name,t,e]of views){state.camera.position.set(X+e[0],e[1],Z+e[2]);state.camera.lookAt(X+t[0],t[1],Z+t[2]);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  return shots;
 },{views:list,fallback});
}
// Offsets from the building (found by name, or SOC_LAB_AT=x,z for the generic tower before the rebuild); the map looks at it from +x/+z.
const at=(dx:number,y:number,dz:number):[number,number,number]=>[dx,y,dz];
const VIEWS:View[]=[['front',at(0,5.2,0),at(9,7,13)],['terraces',at(-.2,6,.6),at(3.5,7.4,6)],['spine',at(0,5,0),at(10,6,2.5)],['lobby',at(-.2,.6,.7),at(.5,1.1,3.3)],['crown',at(0,10.2,0),at(3.6,12.6,4.4)],['back',at(0,5,0),at(-10,8,-12)],['context',at(0,4,0),at(22,16,24)]];
test.skip(!process.env.SOC_LAB_SHOTS,'Screenshots only: set SOC_LAB_SHOTS=1');
for(const light of ['day','night'] as const)test(`SOC Lab, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().startsWith('SOC_LAB_AT'))console.log(m.text());});
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('SOC Lab nameplate still opens its panel',async({page})=>{
 mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Security Operations Center');await settle(page,2);await expect(page.getByRole('complementary',{name:'Inspector'}).getByRole('heading',{name:'Security Operations Center',exact:true})).toBeVisible();
 await page.screenshot({path:`${out}/selected.png`});
});
test('SOC Lab on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone',at(0,5.2,0),at(10,8,14)]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
