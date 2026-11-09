import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** Financial District brought down to the city's scale (KC, 2026-11-09). Writes day/night camera views. */
// Runs only when SHOT_DIR names a folder; the regular visual checks skip it (software WebGL is slow in CI).
const out=process.env.SHOT_DIR;
test.skip(!out,'Set SHOT_DIR to a folder to take Financial District scale screenshots.');
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
// "By district" layout: the district runs x -18..35, z -17..-2, with the headquarters south of it (z 4..43).
const VIEWS:View[]=[['skyline',[8,4,-6],[30,13,34]],['district',[8,3,-10],[10,19,20]],['ellipse',[-14,4,-10],[-1,9,9]]];
for(const light of ['day','night'] as const)test(`Financial District scale, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out!,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Financial District scale, phone',async({page})=>{
 test.setTimeout(600_000);mkdirSync(out!,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone',[8,4,-8],[22,22,40]]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
