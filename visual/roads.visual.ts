import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** One road standard across the city: streets, bridges, ramps (KC, 2026-10-31). Runs only with SHOT_DIR. */
const out=process.env.SHOT_DIR??'';
type View=[string,[number,number,number],[number,number,number]];
async function views(page:import('@playwright/test').Page,list:View[]){
 return page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const shots:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name,png:canvas.toDataURL('image/png')});}
  return shots;
 },list);
}
// World positions in the default "By district" layout.
const VIEWS:View[]=[
 ['vanguard-street',[-2,0,-10],[-2,7,0]],
 ['financial-wide',[8,0,-13],[8,20,8]],
 ['financial-ramp',[20,0,-19],[13,10,-7]],
 ['west-street',[-3,0,4],[5,8,14]],
 ['west-top',[-2.5,0,1],[-2.5,13,1.5]],
 ['vanguard-top',[-1.2,0,-5.4],[-1.2,6,-5.39]],
 ['freight-street',[9,0,12],[9,10,24]],
 ['airport-ramp',[18,0,43],[18,10,54]],
 ['overview',[6,0,12],[40,55,60]],
];
for(const light of ['day','night'] as const)test(`roads, ${light}`,async({page})=>{
 test.skip(!out,'Set SHOT_DIR to take road screenshots');
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,VIEWS))writeFileSync(`${out}/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('roads on a phone',async({page})=>{
 test.skip(!out,'Set SHOT_DIR to take road screenshots');
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 for(const s of await views(page,[['phone-financial',[2,0,-10],[6,16,8]]]))writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
