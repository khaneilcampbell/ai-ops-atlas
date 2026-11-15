import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
// Runs only when SHOT_DIR names a folder; the regular visual checks skip it (software WebGL is slow in CI).
test.skip(!process.env.SHOT_DIR,'Set SHOT_DIR to a folder to take marina screenshots.');
/** No rail viaduct support stands on the harbour marina's stair, pier or dock (Khaneil, 2026-11-07). */
const out=process.env.SHOT_DIR??'artifacts/marina-supports';
type View=[string,[number,number,number],[number,number,number]];
// Marina in the default "By district" layout sits at x 2.5, pier z ~58.
const VIEWS:View[]=[['marina',[2.5,0,57],[-4,7,49]],['marina-side',[2.5,0,57],[10,5,52]]];
for(const light of ['day','night'] as const)test(`marina and viaduct, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 const shots=await page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const list:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);list.push({name,png:canvas.toDataURL('image/png')});}
  return list;
 },VIEWS);
 for(const s of shots)writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
