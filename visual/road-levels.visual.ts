import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/**
 * Road levels and the Commerce district streets (Khaneil, 2026-11-07): views of the Commerce district,
 * the Marketplace and stations, and the whole island, day and night. Cameras are placed from the live
 * layout so the same views work before and after a layout change. SHOT_DIR picks the output folder.
 */
const out=process.env.SHOT_DIR??'artifacts/road-levels';
type View=[string,[number,number,number],[number,number,number]];
type Spots={commerce:{x:number;z:number};mall?:{x:number;z:number};city:{x:number;z:number;r:number};stations:{id:string;x:number;z:number}[]};
async function spots(page:import('@playwright/test').Page):Promise<Spots>{
 return page.evaluate(async()=>{
  const [{catalog},{layoutMap},{buildScene}]=await Promise.all([import('/src/catalog/index.ts' as string),import('/src/views/mapLayout.ts' as string),import('/src/views/map3d/scene.ts' as string)]);
  const s=buildScene(layoutMap(catalog,[],'district')),c=s.towers.find((t:{projectId:string})=>t.projectId==='commerce-pipeline'),b=s.bounds;
  const stops=(s.communityRail?.loop?.stops??[]).map((p:{id:string;point:[number,number]})=>({id:p.id,x:p.point[0],z:p.point[1]}));
  return {commerce:{x:c.x,z:c.z},mall:s.mall?{x:s.mall.cx,z:s.mall.cz}:undefined,city:{x:(b.x0+b.x1)/2,z:(b.z0+b.z1)/2,r:Math.max(b.x1-b.x0,b.z1-b.z0)/2},stations:stops};
 });
}
async function shoot(page:import('@playwright/test').Page,views:View[]){
 return page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const shots:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  return shots;
 },views);
}
const VIEWS=(s:Spots):View[]=>[
 // Roughly Khaneil's camera: from the south-east, looking down over the Commerce district.
 ['commerce',[s.commerce.x-1,0,s.commerce.z+3],[s.commerce.x+7,12,s.commerce.z+14]],
 ['commerce-south',[s.commerce.x-2,0,s.commerce.z+8],[s.commerce.x+2,9,s.commerce.z+20]],
 ['commerce-low',[s.commerce.x-3,.6,s.commerce.z+6],[s.commerce.x+5,2.4,s.commerce.z+13]],
 ...(s.mall?[['marketplace',[s.mall.x,0,s.mall.z],[s.mall.x+6,9,s.mall.z+12]] as View]:[]),
 ...s.stations.map((p,i):View=>[`station-${i+1}`,[p.x,.6,p.z],[p.x+4,4,p.z+6]]),
 ['overview',[s.city.x,0,s.city.z],[s.city.x+s.city.r*.45,s.city.r*1.5,s.city.z+s.city.r*1.35]],
];
for(const light of ['day','night'] as const)test(`Road levels, ${light}`,async({page})=>{
 test.setTimeout(900_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await shoot(page,VIEWS(await spots(page))))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
for(const light of ['day','night'] as const)test(`Road levels on a phone, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:`${out}/phone-map-${light}.png`});
 const s=await spots(page);
 for(const v of await shoot(page,[['phone-commerce',[s.commerce.x-1,0,s.commerce.z+4],[s.commerce.x+3,10,s.commerce.z+16]]]))writeFileSync(`${out}/${v.name}-${light}.png`,Buffer.from(v.png.split(',')[1],'base64'));
});
