import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** Experian preview shots: the glass office tower (stable ID `residence`) from the street, up close and in context. */
// Preview shots only (no baselines): runs only when EXPERIAN_SHOTS=1, like CIRCA_SHOTS, so the CI baseline run stays under its time limit.
test.skip(!process.env.EXPERIAN_SHOTS,'Set EXPERIAN_SHOTS=1 to take Experian preview screenshots.');
// World positions in the default (no grouping) layout: the tower's centre is about (18.6, -9.85), front door facing +z.
const views=[['front',[18.6,5.5,-9.8],[23,7,7]],['close',[18.6,4.2,-8.5],[21.5,4.8,-3.2]],['context',[20,5,-11],[11,15,9]],['side',[18.6,5,-9.8],[27,6,-2]]] as const;
const out=process.env.EXPERIAN_OUT??'artifacts/experian';
for(const light of ['day','night'] as const)test(`Experian tower, ${light}`,async({page})=>{
 test.setTimeout(600_000);
 mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light,storage:{mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
 const shots=await page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const shots:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  return shots;
 },views as unknown as [string,[number,number,number],[number,number,number]][]);
 for(const s of shots)writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Experian on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day',storage:{mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:`${out}/phone.png`});
});
