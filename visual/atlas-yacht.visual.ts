import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openAtlas,waitForScene,settle} from './atlas';
/**
 * Atlas yacht screenshots: close views of the yacht at her berth (stern quarter, profile, the
 * passerelle, from above), the yacht selected with its panel, and every deck inside. Written only
 * when SHOT_DIR is set; no baseline comparison.
 */
const out=process.env.SHOT_DIR;
type View=[string,[number,number,number],[number,number,number]];
for(const width of [1512,390])for(const light of ['day','night'] as const)test(`Atlas yacht ${width} ${light}`,async({page})=>{
 test.skip(!out,'Set SHOT_DIR to write the yacht screenshots');
 test.setTimeout(600_000);mkdirSync(out!,{recursive:true});
 await page.setViewportSize({width,height:width===390?844:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('console error:',m.text());});
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 const tag=width===390?'phone':'desktop';
 const shots=await page.evaluate(async(phone)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const [data,layout,planner,marina,yacht]=await Promise.all(['/src/catalog/index.ts','/src/views/mapLayout.ts','/src/views/map3d/scene.ts','/src/views/map3d/marinaPlan.ts','/src/views/map3d/yachtPlan.ts'].map(u=>import(u)));
  const scene=planner.buildScene(layout.layoutMap(data.catalog,[],'district')),b=yacht.yachtBerth(marina.marinaSite(scene,planner.TERRACE_H)),k=phone?1.7:1,w=planner.WATER_Y;
  const views:View[]=[
   ['stern',[b.x,w+.6,b.z],[b.x-5*k,w+2.2*k,b.z+4.5*k]],
   ['profile',[b.x,w+.6,b.z],[b.x+.5,w+1.2,b.z+7.5*k]],
   ['bow',[b.x,w+.6,b.z],[b.x+6*k,w+2*k,b.z+3.5*k]],
   ['passerelle',[b.gangway.x,w+.3,b.gangway.z0],[b.gangway.x-1.8*k,w+1.6*k,b.gangway.z0-2.6*k]],
   ['top',[b.x,w,b.z],[b.x+.01,w+9*k,b.z+3*k]],
   ['marina',[b.x-2,w+.8,b.z-1],[b.x+4*k,w+6*k,b.z+11*k]],
  ];
  const result:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);result.push({name,png:canvas.toDataURL('image/png')});}
  return result;
 },width===390);
 for(const s of shots)writeFileSync(`${out}/${tag}-${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 const plaque=page.locator('.m3-plaque[title$="Planned yacht"]');
 if(await plaque.count()){
  await plaque.first().dispatchEvent('click');await settle(page,4);
  if(light==='day')await page.screenshot({path:`${out}/${tag}-selected-${light}.png`});
  await page.getByRole('button',{name:'Enter yacht'}).first().click();await page.locator('.skyline-interior').waitFor();await settle(page,6);
  await page.screenshot({path:`${out}/${tag}-interior-all-${light}.png`});
  for(const [name,file] of [['Sun deck','sun'],['Bridge deck','bridge'],['Main deck','main'],['Lower deck','lower']]){
   await page.locator('.skyline-floor-picker button',{hasText:name}).click();await settle(page,8);
   await page.screenshot({path:`${out}/${tag}-interior-${file}-${light}.png`});
  }
 }
 expect(errors).toEqual([]);
});
