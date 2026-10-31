import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** Circa preview shots: wide context with Navy Federal, Vanguard and the highway, a close-up of the LED screen, and the deck. */
// World positions in the default (no grouping) layout: Circa's centre is about (-13.5, -12.6).
const views=[["overview",[-9,3,-12],[-8,15,12]],["dusk",[-12,5,-12],[-4,4,6]],['screen',[-13.5,1.4,-8.3],[-9,4.5,-0.5]],['west',[-13.5,1.6,-13],[-23,7,-11]],['deck',[-13.4,2.3,-12.6],[-9,11,-3]],['towers',[-13.4,6,-12.6],[-14,3,0]]] as const;
for(const light of ['day','night'] as const)test(`Circa twin towers, ${light}`,async({page})=>{
 test.setTimeout(600_000);
 mkdirSync('artifacts/circa',{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light,storage:{mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:`artifacts/circa/default-${light}.png`});
 const shots=await page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const out:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);out.push({name,png:canvas.toDataURL('image/png')});}
  return out;
 },views as unknown as [string,[number,number,number],[number,number,number]][]);
 for(const s of shots)writeFileSync(`artifacts/circa/${s.name}-${light}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
test('Circa on a phone',async({page})=>{
 mkdirSync('artifacts/circa',{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day',storage:{mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:'artifacts/circa/phone-default.png'});
});
