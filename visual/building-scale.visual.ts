import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** Building sizes set against the Financial District (KC, 2026-11-04). Writes day/night and phone views. */
// Runs only when SHOT_DIR names a folder; the regular visual checks skip it (software WebGL is slow in CI).
const out=process.env.SHOT_DIR;
test.skip(!out,'Set SHOT_DIR to a folder to take building-scale screenshots.');
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
// "By district": the project headquarters in front, the Financial District behind them.
const VIEWS:View[]=[
 ['skyline',[12,4,0],[40,22,58]],
 ['side',[10,5,4],[58,10,14]],
];
for(const light of ['day','night'] as const)test(`Building scale, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out!,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Building scale, phone',async({page})=>{
 test.setTimeout(600_000);await page.setViewportSize({width:390,height:844});mkdirSync(out!,{recursive:true});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone',[16,4,8],[34,20,52]]]))writeFileSync(`${out}/${s.name}-day.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
