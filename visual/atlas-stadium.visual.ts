import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,waitForScene,settle} from './atlas';
/**
 * Atlas Stadium screenshots: the overview, close views by day and night, the concourse with
 * Stadium Station, and the stadium selected with its panel. Written only when SHOT_DIR is set;
 * no baseline comparison.
 */
const out=process.env.SHOT_DIR;
type View=[string,[number,number,number],[number,number,number]];
for(const width of [1512,390])for(const light of ['day','night'] as const)test(`Atlas Stadium ${width} ${light}`,async({page})=>{
 test.skip(!out,'Set SHOT_DIR to write the stadium screenshots');
 test.setTimeout(600_000);mkdirSync(out!,{recursive:true});
 await page.setViewportSize({width,height:width===390?844:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 const tag=width===390?'phone':'desktop';
 await page.screenshot({path:`${out}/${tag}-overview-${light}.png`});
 // Camera views worked out from the stadium's own lot, so they follow it if the layout moves.
 const shots=await page.evaluate(async(phone)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const [data,layout,planner]=await Promise.all(['/src/catalog/index.ts','/src/views/mapLayout.ts','/src/views/map3d/scene.ts'].map(u=>import(u)));
  const scene=planner.buildScene(layout.layoutMap(data.catalog,[],'district')),s=scene.stadium,stop=scene.communityRail?.loop?.stops.find((x:{id:string})=>x.id==='service:stadium-station');
  const cx=s.x+s.w/2,cz=s.z+s.d/2,k=phone?1.6:1;
  const views:View[]=[
   ['close',[cx,1.6,cz],[cx+8*k,6.5*k,cz+9*k]],
   ['low',[cx,1.8,cz],[cx+10*k,2.6,cz-3*k]],
   ['top',[cx,0,cz],[cx+.01,16*k,cz+6*k]],
   ...(stop?[['station',[(cx+stop.point[0])/2+2,1,(cz+stop.point[1])/2],[cx+12*k,7*k,stop.point[1]+8*k]] as View]:[]),
  ];
  const result:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);result.push({name,png:canvas.toDataURL('image/png')});}
  return result;
 },width===390);
 const {writeFileSync}=await import('node:fs');
 for(const s of shots)writeFileSync(`${out}/${tag}-${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 if(light==='day'){
  // Old and new plaques share the title ending, so the same spec shoots before and after.
  await page.locator('.m3-plaque[title$="Stadium · Planned venue"]').first().dispatchEvent('click');await settle(page,4);
  await page.screenshot({path:`${out}/${tag}-selected-${light}.png`});
 }
 expect(errors).toEqual([]);
});
