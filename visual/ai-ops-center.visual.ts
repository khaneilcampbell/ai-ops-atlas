import {test,expect,type Page} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene,selectBuilding} from './atlas';
/**
 * Atlas AI Operations Center and the Product & Growth Tower, swapped (Khaneil, 2026-11-25): the tower on the Financial
 * District's west waterfront plot, the center in the tower's old Commerce spot. Fixed camera
 * views over the plot, so the same script shoots the base branch (before) and this one (after), then the center
 * selected and its interior, at desktop and iPhone width.
 * Run: AIOPS_SHOTS=1 SHOT_DIR=... npx playwright test -c visual ai-ops-center
 */
const out=process.env.SHOT_DIR??'artifacts/ai-ops-center';
test.skip(!process.env.AIOPS_SHOTS,'Screenshots on request only (AIOPS_SHOTS=1).');
const T=[-1,3.5,-11];
const VIEWS:[string,number[],number[]][]=[['iso',[16,17,8],T],['close',[8,9,0],[-1,4.5,-11]],['street',[4,2.2,-3.2],[-1,5,-11]],['top',[-1,34,-10.4],[-1,0,-10.5]],['water',[-9,10,-30],[-1,4,-11]],
 // Swap (Khaneil, 2026-11-25): the AI Operations Center in the Product & Growth Tower's old Commerce spot.
 ['commerce-iso',[26,14,17],[14.75,3,5]],['commerce-close',[20,6.5,11],[14.75,3.2,5]]];
async function shoot(page:Page,prefix:string){
 const shots=await page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  return views.map(([name,p,t])=>{state.camera.position.set(p[0],p[1],p[2]);state.camera.lookAt(t[0],t[1],t[2]);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);return {name,png:canvas.toDataURL('image/png')};});
 },VIEWS);
 for(const s of shots)writeFileSync(`${out}/${prefix}-${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
}
for(const [device,vp] of [['desktop',{width:1512,height:900}],['phone',{width:390,height:844}]] as const)for(const light of ['day','night'] as const)test(`AI Operations Center, ${device} ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});await page.setViewportSize(vp);
 await openAtlas(page,{light});await waitForScene(page);await settle(page,3);
 await shoot(page,`${device}-${light}`);
 if(light==='night'||!(await page.locator('.m3-plaque[title^="Atlas AI Operations Center ·"]').count()))return;
 await selectBuilding(page,'Atlas AI Operations Center');await settle(page,3);
 await expect(page.getByText('Knowledge & Research',{exact:false}).first()).toBeVisible();
 await page.screenshot({path:`${out}/${device}-selected.png`});
 await page.getByRole('button',{name:'Enter building'}).first().click();await settle(page,5);
 await page.screenshot({path:`${out}/${device}-inside-all.png`});
 for(const f of ['Lobby','Floor 1','Floor 3']){await page.getByRole('button',{name:f,exact:true}).first().click();await settle(page,3);await page.screenshot({path:`${out}/${device}-inside-${f.replace(' ','').toLowerCase()}.png`});}
});
