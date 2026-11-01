import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/**
 * Night screenshots of the buildings that used to stay dark after sunset (KC, 2026-10-31): the
 * stadium, BMW, the Skyline shops, the Hills garage and the airport service building, plus four
 * overviews. Screenshots only, written when SHOT_DIR is set; no baseline comparison.
 */
const out=process.env.SHOT_DIR;
type View=[string,[number,number,number],[number,number,number]];
// World positions in the default "By district" layout.
const VIEWS:View[]=[
 ['overview-south',[10,0,0],[10,60,75]],['overview-north',[10,0,0],[10,60,-80]],
 ['stadium',[-8,1,12],[-20,14,0]],['bmw',[36,2,-8],[44,8,4]],['shops',[10,1,36],[2,10,22]],
 ['hills-garage',[24,1,52],[16,9,40]],['airport',[-2,1,42],[-2,22,15]],
];
test('Buildings show their lights at night',async({page})=>{
 test.skip(!out,'Set SHOT_DIR to write the night screenshots');
 test.setTimeout(600_000);mkdirSync(out!,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'night'});await waitForScene(page);await settle(page,3);
 const shots=await page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const result:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);result.push({name,png:canvas.toDataURL('image/png')});}
  return result;
 },VIEWS);
 for(const s of shots)writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
