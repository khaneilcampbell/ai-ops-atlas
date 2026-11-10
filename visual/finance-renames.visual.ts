import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/** Preview shots of the business-finance and budget towers (signs, nameplates, inspector). Runs only when FINANCE_RENAME_SHOTS=1. */
test.skip(!process.env.FINANCE_RENAME_SHOTS,'Set FINANCE_RENAME_SHOTS=1 to take finance rename preview screenshots.');
const out=process.env.FINANCE_RENAME_OUT??'artifacts/finance-renames';
/** Plaque names to select: FINANCE_RENAME_NAMES="Corvane Capital,Ellery Budget Center" (defaults to the current names). */
const names=(process.env.FINANCE_RENAME_NAMES??'Corvane Capital,Budget & Forecasting Center').split(',');
/** Stable ids; each sign mesh is matched to its brand by its sign background colour. */
const ids=['business-finance','budget'];
for(const light of ['day','night'] as const)test(`finance renames, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light,storage:{mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
 const shots=await page.evaluate(async(ids)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const brands:{id:string;signBackground:string}[]=(await import('/src/views/map3d/financialBrands.ts' as string)).FINANCIAL_BRANDS;
  /** A sign's brand, read from its canvas: the top-left pixel is the brand's sign background. */
  const hex=(m:import('three').Mesh)=>{const c=((m.material as import('three').MeshStandardMaterial).map?.image as HTMLCanvasElement).getContext('2d')!.getImageData(4,4,1,1).data;return '#'+[c[0],c[1],c[2]].map(v=>v.toString(16).padStart(2,'0')).join('');};
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const signs:import('three').Mesh[]=[];state.scene.traverse((o:import('three').Object3D)=>{const m=o as import('three').Mesh;const p=(m.geometry as {parameters?:{width?:number;height?:number}}|undefined)?.parameters;if(m.isMesh&&p?.width===2.55&&p?.height===.65)signs.push(m);});
  const shots:{name:string;png:string}[]=[];
  for(const id of ids){const bg=brands.find(b=>b.id===id)!.signBackground,mine=signs.filter(m=>hex(m)===bg),front=mine.find(m=>m.rotation.y===0),side=mine.find(m=>m.rotation.y!==0);if(!front||!side)throw new Error(`Sign for ${id} not found`);const s=front.position,e=side.position;
   for(const [name,eye,target] of [['sign',[s.x+.6,s.y-.4,s.z+3.4],[s.x,s.y-.1,s.z]],['side-sign',[e.x+3.4,e.y-.4,e.z+.6],[e.x,e.y-.1,e.z]],['tower',[e.x+9,e.y-1,s.z+8],[s.x,s.y*.55,e.z]]] as const){
    state.camera.position.set(eye[0],eye[1],eye[2]);state.camera.lookAt(target[0],target[1],target[2]);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name:`${id}-${name}`,png:canvas.toDataURL('image/png')});
   }}
  return shots;
 },ids);
 for(const s of shots)writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
for(const [i,id] of ids.entries())test(`${id} selected, desktop and phone`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});
 for(const [label,size] of [['desktop',{width:1512,height:900}],['phone',{width:390,height:844}]] as const){
  await page.setViewportSize(size);await openAtlas(page,{light:'day',storage:{mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
  await selectBuilding(page,'Financial District');await selectBuilding(page,names[i]);await settle(page,3);
  await page.screenshot({path:`${out}/${id}-selected-${label}.png`});
 }
});
