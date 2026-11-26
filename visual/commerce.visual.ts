import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * Commerce Pipeline rebuilt as a twisting teardrop glass tower on a garden podium, with its district
 * widened to fit (Khaneil, 2026-11-01). Writes day/night camera views around it; the tower's position is
 * read from the live layout, so the same views work before and after the district grows.
 */
const out=process.env.SHOT_DIR??'artifacts/commerce';
type View=[string,[number,number,number],[number,number,number]];
async function views(page:import('@playwright/test').Page,list:(c:{x:number;z:number;s:number})=>View[]){
 // The tower's live position, read from the drawn scene (the layout can differ from the default grouping's).
 const at=await page.evaluate(async()=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),state=fiber._roots.get(document.querySelector('canvas')!)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const g=state.scene.getObjectByName('commerce-tower');const inner=g?.children[0];
  if(!inner){// Older builds don't name the tower's group: fall back to the district layout.
   const [{catalog},{layoutMap},{buildScene}]=await Promise.all([import('/src/catalog/index.ts' as string),import('/src/views/mapLayout.ts' as string),import('/src/views/map3d/scene.ts' as string)]);
   const t=buildScene(layoutMap(catalog,[],'district')).towers.find((t:{projectId:string})=>t.projectId==='commerce-pipeline');return {x:t.x,z:t.z,s:t.size};
  }
  const p=inner.getWorldPosition(new (inner.position.constructor as {new():typeof inner.position})());return {x:p.x,z:p.z,s:0};
 });
 return page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const shots:{name:string;png:string}[]=[];
  // Close views need a near clip plane closer than the map's own.
  const cam=state.camera as import('three').PerspectiveCamera,near=cam.near;cam.near=.05;cam.updateProjectionMatrix();
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  cam.near=near;cam.updateProjectionMatrix();
  return shots;
 },list(at));
}
// The district's tool buildings stand on its four corners (about 3.3 out on each axis), so every
// camera looks in along an axis between them rather than across a corner.
const VIEWS=({x,z}:{x:number;z:number}):View[]=>[
 ['front',[x,3,z],[x+1.6,5.5,z+10.5]],
 // Realism pass (2026-11-24): from the street, the crown, and the lobby through its clear glass.
 ['hero',[x,4.6,z+.4],[x+3.4,2.4,z+10.5]],
 ['crown',[x,7.5,z],[x+3.2,10.5,z+8]],
 ['lobby',[x,1.1,z+1.8],[x+.9,1.4,z+4.8]],
 ['close',[x,1.4,z+.6],[x+1.4,2.2,z+5.2]],
 ['podium',[x+.3,1.2,z+.3],[x+1.8,4.6,z+5.4]],
 ['side',[x,2.6,z],[x+9.5,4,z+.6]],
 ['district',[x,.8,z],[x+1.5,17,z+12]],
 // The grounds round the podium (2026-11-24): forecourt, drop-off lane, ramps and corner lawns from above.
 ['grounds',[x,.7,z+.2],[x+.6,11,z+5.5]],
 // Khaneil's street-level angle from the south-east (2026-11-24 screenshot).
 ['street',[x-.5,1,z+1],[x+5,7,z+9]],
 ['context',[x+1,1,z-1],[x+14,16,z+16]],
];
for(const light of ['day','night'] as const)test(`Commerce district, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Commerce Pipeline nameplate still opens its panel',async({page})=>{
 mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Product & Growth Tower');await settle(page,2);await expect(page.getByRole('complementary',{name:'Inspector'}).getByRole('heading',{name:'Product & Growth Tower',exact:true})).toBeVisible();
 await page.screenshot({path:`${out}/selected.png`});
});
test('Commerce district on a phone',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,({x,z})=>[['phone',[x,2.4,z],[x+1.2,6,z+10]]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
