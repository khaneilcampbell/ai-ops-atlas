import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** New York style avenues and one-way cross streets (Khaneil, 2026-11-13). Writes day/night camera views. */
// Runs only when SHOT_DIR names a folder; the regular visual checks skip it (software WebGL is slow in CI).
const out=process.env.SHOT_DIR;
test.skip(!out,'Set SHOT_DIR to a folder to take New York street screenshots.');
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
// The "By district" layout: the whole city from above, then each new avenue stretch close up.
const VIEWS:View[]=[['overview',[12,0,22],[12,62,70]],['west-avenue',[-3.5,0,45],[4,9,55]],['middle-avenue',[10,0,26],[10,22,44]],['east-avenue',[43,0,36],[34,10,46]]];
for(const [size,viewport] of [['desktop',{width:1512,height:900}],['iphone',{width:390,height:844}]] as const)for(const light of ['day','night'] as const)test(`New York streets, ${size} ${light}`,async({page})=>{
 test.setTimeout(600_000);await page.setViewportSize(viewport);mkdirSync(out!,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${size}-${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
