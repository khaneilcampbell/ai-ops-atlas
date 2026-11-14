import {test,expect,type Page} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openAtlas,waitForScene,settle} from './atlas';
/**
 * The yacht out at sea (Khaneil, 2026-11-14: "I should be able to select the yacht wherever its at... see the Atlas city
 * wherever I am when Im inside the yacht"). Written only when SHOT_DIR is set; no baseline comparison. Works on main
 * too, for before shots. Reduced motion stops the train, so the spec sets the travel clock itself to a moment on her
 * cruise, selects her, renders a wide view over the sea, then enters her and shoots each view.
 */
const out=process.env.SHOT_DIR;

/** Puts the travel clock `u` of the way through her cruise and returns her berth and where she is now. */
async function sail(page:Page,u:number){
 return page.evaluate(async(u)=>{
  const [data,layout,planner,loops]=await Promise.all(['/src/catalog/index.ts','/src/views/mapLayout.ts','/src/views/map3d/scene.ts','/src/views/map3d/travelLoops.ts'].map(x=>import(x)));
  const scene=planner.buildScene(layout.layoutMap(data.catalog,[],'district')),plan=loops.travelPlan(scene);
  if(!plan?.yacht)throw new Error('No yacht cruise on this map');
  loops.TRAVEL_CLOCK.live=true;loops.TRAVEL_CLOCK.t=plan.yacht.depart+loops.TRAVEL.sail*u+plan.yacht.period*3;
  const b=plan.yacht.berth,at=loops.yachtPoseAt(loops.yachtCourse(b),loops.TRAVEL.sail*u);
  return {berth:{x:b.x,z:b.z},at,water:planner.WATER_Y as number};
 },u);
}

/** Renders the map from a fixed camera over the sea, framing both the mooring and the yacht. */
async function wide(page:Page,s:{berth:{x:number;z:number};at:{x:number;z:number};water:number},phone:boolean){
 return page.evaluate(async({s,phone})=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)!.store.getState();
  const cx=(s.berth.x+s.at.x)/2,cz=(s.berth.z+s.at.z)/2,span=Math.hypot(s.at.x-s.berth.x,s.at.z-s.berth.z)+8,k=phone?1.9:1;
  state.advance(performance.now());state.advance(performance.now());
  state.camera.position.set(cx-span*.15*k,s.water+span*.75*k,cz+span*.85*k);state.camera.lookAt(cx,s.water,cz);state.camera.updateMatrixWorld();
  state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);
  return canvas.toDataURL('image/png');
 },{s,phone});
}
const png=(path:string,data:string)=>writeFileSync(path,Buffer.from(data.split(',')[1],'base64'));

for(const width of [1512,390])for(const light of ['day','night'] as const)test(`yacht ride ${width} ${light}`,async({page})=>{
 test.skip(!out,'Set SHOT_DIR to write the yacht ride screenshots');
 test.skip(width===390&&light==='night','Phone shots in daylight only');
 test.setTimeout(900_000);mkdirSync(out!,{recursive:true});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:width===390?844:900});
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 const tag=width===390?'phone':'desktop',phone=width===390;
 const s=await sail(page,.4);await settle(page,2);
 await page.locator('.m3-plaque[title$="Planned yacht"]').first().dispatchEvent('click');await settle(page,4);
 await page.screenshot({path:`${out}/${tag}-selected-at-sea-${light}.png`});
 png(`${out}/${tag}-selected-wide-${light}.png`,await wide(page,s,phone));
 await page.getByRole('button',{name:'Enter yacht'}).first().click();await page.locator('.skyline-interior').waitFor();await settle(page,8);
 await page.screenshot({path:`${out}/${tag}-inside-all-${light}.png`});
 for(const [name,file] of [['Sun deck','sun'],['Main deck','main']]){
  await page.locator('.skyline-floor-picker button',{hasText:name}).click();await settle(page,6);
  await page.screenshot({path:`${out}/${tag}-inside-${file}-${light}.png`});
 }
 const sunView=page.getByRole('button',{name:'Sun deck view'});
 if(await sunView.count()){await sunView.click();await settle(page,6);await page.screenshot({path:`${out}/${tag}-inside-sundeck-view-${light}.png`});}
 expect(errors).toEqual([]);
});
