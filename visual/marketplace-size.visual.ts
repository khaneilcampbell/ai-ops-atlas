import {test,type Page} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * Atlas Marketplace one step smaller (Khaneil, 2026-11-08). Fixed camera views over the Marketplace lot,
 * so the same script shoots main (before) and the branch (after).
 * Run: MARKETPLACE_SHOTS=1 SHOT_DIR=... npx playwright test -c visual marketplace-size
 */
const out=process.env.SHOT_DIR??'artifacts/marketplace-size';
test.skip(!process.env.MARKETPLACE_SHOTS,'Screenshots on request only (MARKETPLACE_SHOTS=1).');
const VIEWS:[string,number[],number[]][]=[['south-west',[16,12,46],[27,1,30]],['east',[46,12,33],[27,1,27]],['top',[27,30,32],[27,0,30]]];
async function shoot(page:Page,prefix:string){
 const shots=await page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  return views.map(([name,p,t])=>{state.camera.position.set(p[0],p[1],p[2]);state.camera.lookAt(t[0],t[1],t[2]);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);return {name,png:canvas.toDataURL('image/png')};});
 },VIEWS);
 for(const s of shots)writeFileSync(`${out}/${prefix}-${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
}
for(const light of ['day','night'] as const)test(`Marketplace, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Product Marketplace');await settle(page,3);
 await page.screenshot({path:`${out}/desktop-selected-${light}.png`});
 await shoot(page,`desktop-${light}`);
});
test('Marketplace on a phone',async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);
 await selectBuilding(page,'Product Marketplace');await settle(page,3);
 await page.screenshot({path:`${out}/phone-selected.png`});
});
