import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** Atlas Mansion (in Atlas Hills) redesign (KC, 2026-10-31). Writes day/night camera views around the estate. */
const out=process.env.SHOT_DIR??'artifacts/hills-mansion';
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
// In the default "By district" layout the estate's corner is at (5, 44.725); the mansion centre is (18, 54.725).
const VIEWS:View[]=[['front',[16,2,55.5],[25,7.5,67]],['close',[18,2,56.5],[21.5,3.2,62.5]],['pool',[11.5,1.2,55],[16,5,63]],['side',[18,2.2,54.7],[29,5,57]],['roof',[18,3.6,54.7],[22.5,11,61]],['context',[15,1,56],[32,19,76]],
 // Hills community (houses, shops, clubs) south of the estate wall, in the same mansion theme.
 ['community',[15,1,80],[30,13,97]],['community-close',[10,1,77],[14.5,4.2,85.5]]];
const ONLY=process.env.VIEWS?.split(',');
for(const light of ['day','night'] as const)test(`Hills mansion, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS.filter(v=>!ONLY||ONLY.includes(v[0]))))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Hills mansion on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone',[17,2,55.5],[24,7,66]]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
