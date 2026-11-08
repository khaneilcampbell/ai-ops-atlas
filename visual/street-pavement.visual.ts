import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/**
 * Street sidewalks, junction zebras and building-matched plazas (KC, 2026-11-08): a close view over
 * the central districts and the whole island, day and night. SHOT_DIR picks the output folder.
 */
const out=process.env.SHOT_DIR??'artifacts/street-pavement';
type View=[string,[number,number,number],[number,number,number]];
for(const light of ['day','night'] as const)test(`Street pavement, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 const shots=await page.evaluate(async()=>{
  const [{catalog},{layoutMap},{buildScene}]=await Promise.all([import('/src/catalog/index.ts' as string),import('/src/views/mapLayout.ts' as string),import('/src/views/map3d/scene.ts' as string)]);
  const s=buildScene(layoutMap(catalog,[],'district')),t=s.towers.find((x:{projectId:string})=>x.projectId==='soc-lab')??s.towers[0],b=s.bounds;
  const cx=(b.x0+b.x1)/2,cz=(b.z0+b.z1)/2,r=Math.max(b.x1-b.x0,b.z1-b.z0)/2;
  const views:View[]=[['district',[t.x+1,0,t.z+1],[t.x+5,7,t.z+9]],['overview',[cx,0,cz],[cx+r*.45,r*1.5,cz+r*1.35]],['top',[cx,0,cz],[cx,r*2.2,cz+.01]]];
  // The avenue north from Benjaire HQ into the Financial District: from above, and at street level.
  const hq=s.towers.find((x:{projectId:string})=>x.projectId==='benjaire-site');
  if(hq)views.push(['avenue',[hq.x+3,0,hq.z-3],[hq.x+3.5,6,hq.z+5]],['street',[hq.x+3.2,.6,hq.z-8],[hq.x+3.6,1.6,hq.z+3]]);
  // Looking up the avenue past Benjaire HQ to the Financial District's street side.
  if(hq)views.push(['approach',[hq.x+2.6,.4,hq.z-10],[hq.x+5.6,2.2,hq.z+9]]);
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  return views.map(([name,target,eye])=>{state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);return {name,png:canvas.toDataURL('image/png')};});
 });
 for(const s of shots)writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
