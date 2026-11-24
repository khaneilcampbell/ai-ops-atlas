import {test,expect,type Page} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * Business Operations HQ in the Financial District's east corner (Khaneil, 2026-11-24). Fixed camera views
 * over the corner plot, so the same script shoots the base branch (before) and this one (after), then the
 * HQ and Supplier Hub selected, at desktop and iPhone width.
 * Run: BOH_SHOTS=1 SHOT_DIR=... npx playwright test -c visual business-hq
 */
const out=process.env.SHOT_DIR??'artifacts/business-hq';
test.skip(!process.env.BOH_SHOTS,'Screenshots on request only (BOH_SHOTS=1).');
const VIEWS:[string,number[],number[]][]=[['street',[22,14,4],[36,3,-11]],['bay',[56,18,6],[36,3,-11]],['top',[36,40,-9.5],[36,0,-9.6]],['yard',[54,15,-27],[39,1,-13]]];
async function shoot(page:Page,prefix:string){
 const shots=await page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  return views.map(([name,p,t])=>{state.camera.position.set(p[0],p[1],p[2]);state.camera.lookAt(t[0],t[1],t[2]);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);return {name,png:canvas.toDataURL('image/png')};});
 },VIEWS);
 for(const s of shots)writeFileSync(`${out}/${prefix}-${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
}
for(const [device,vp] of [['desktop',{width:1512,height:900}],['phone',{width:390,height:844}]] as const)for(const light of ['day','night'] as const)test(`Business Operations HQ, ${device} ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});await page.setViewportSize(vp);
 await openAtlas(page,{light});await waitForScene(page);await settle(page,3);
 await page.screenshot({path:`${out}/${device}-${light}-map.png`});
 await shoot(page,`${device}-${light}`);
 if(light==='night')return;
 if(!(await page.locator('.m3-plaque[title^="Business Operations HQ ·"]').count()))return;
 await selectBuilding(page,'Business Operations HQ');await settle(page,3);
 await expect(page.getByText('Budget & Forecasting',{exact:false}).first()).toBeVisible();
 await page.screenshot({path:`${out}/${device}-selected-hq.png`});
 // Click the annex model itself (its own click target), projected from the map to the screen.
 const at=await page.evaluate(async()=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)return null;
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)!.store.getState();
  const annex=state.scene.getObjectByName('annex_glass') as import('three').Mesh|undefined;if(!annex)return null;
  annex.geometry.computeBoundingBox();const c=annex.geometry.boundingBox!.getCenter(annex.position.clone());annex.localToWorld(c);c.project(state.camera);
  const r=canvas.getBoundingClientRect();return {x:r.left+(c.x+1)/2*r.width,y:r.top+(1-c.y)/2*r.height};
 });
 if(at){await page.mouse.click(at.x,at.y);await settle(page,3);}
 if(!(await page.getByText('Annex · Part of Business Operations HQ').count())){await page.getByRole('button',{name:'Vendor & Supplier Hub →'}).first().click();await settle(page,3);}
 await expect(page.getByText('Annex · Part of Business Operations HQ')).toBeVisible();
 await page.screenshot({path:`${out}/${device}-selected-annex.png`});
});
