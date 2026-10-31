import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** Financial District night-lighting preview shots: both tower rows, the crowns, and the whole district, by day and night. */
// Preview shots only (no baselines): runs only when FINANCIAL_LIGHTS_SHOTS=1, so the CI baseline run stays under its time limit.
test.skip(!process.env.FINANCIAL_LIGHTS_SHOTS,'Set FINANCIAL_LIGHTS_SHOTS=1 to take Financial District lighting screenshots.');
// World positions in the default (no grouping) layout: the district spans x -9..35, z -19..-4, fronts facing +z.
const views=[['district',[13,5,-11],[13,15,15]],['east',[25,6,-11],[25,8,5]],['west',[-1,5,-11],[1,7,5]],['crowns',[21,11,-12],[13,15,1]],['street',[12,3,-10],[16,2.4,-3.4]]] as const;
const out=process.env.FINANCIAL_LIGHTS_OUT??'artifacts/financial-lights';
for(const light of ['day','night'] as const)test(`Financial District lights, ${light}`,async({page})=>{
 test.setTimeout(600_000);
 mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light,storage:{mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
 // The default view goes through the real render loop, so it includes the night bloom.
 await page.screenshot({path:`${out}/overview-${light}.png`});
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
for(const light of ['day','night'] as const)test(`Financial District on a phone, ${light}`,async({page})=>{
 test.setTimeout(300_000);
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light,storage:{mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:`${out}/phone-${light}.png`});
});
