import {transportPlan} from './compact-city-plan';
import {test,expect} from '@playwright/test';import {openAtlas,settle,selectBuilding,waitForScene} from './atlas';
for(const light of ['day','night'] as const)test(`Compact connected city: ${light}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light,storage:{powerMode:'saver'}});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:`artifacts/compact-city/after-${light}.png`});
 await selectBuilding(page,'Financial District');await settle(page,2);await page.screenshot({path:`artifacts/compact-city/financial-${light}.png`});
 await page.getByRole('button',{name:'Financial District Station →',exact:true}).click();await settle(page,3);await expect(page.getByRole('heading',{name:'Financial District Station',exact:true})).toBeVisible();
 await page.screenshot({path:`artifacts/compact-city/financial-station-${light}.png`});
 await page.getByRole('button',{name:'Back to Atlas Hills',exact:true}).click();await settle(page,2);await page.screenshot({path:`artifacts/compact-city/hills-connections-${light}.png`});
 await page.getByRole('button',{name:'Atlas Hills Station →',exact:true}).click();await settle(page,2);await page.screenshot({path:`artifacts/compact-city/hills-station-${light}.png`});
 await page.getByRole('button',{name:'Back to Atlas Hills',exact:true}).click();await settle(page,2);await page.getByRole('button',{name:'Enter building',exact:true}).click();await settle(page,3);
 const nav=page.getByRole('navigation',{name:'Choose Atlas Hills floor',exact:true});await expect(nav).toBeVisible();await nav.getByRole('button',{name:'Floor 1',exact:true}).click();await settle(page,2);await expect(page.getByRole('heading',{name:'Floor 1 · Workspaces',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Exit Atlas Hills and return to city',exact:true}).click();await settle(page,2);expect(errors).toEqual([]);
});
for(const light of ['day','night'] as const)test(`Final perimeter and local connections: ${light}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openAtlas(page,{light,storage:{powerMode:'saver'}});await waitForScene(page);await settle(page,2);await page.screenshot({path:`artifacts/compact-city/after-${light}.png`});
 await selectBuilding(page,'Financial District');await settle(page,2);await page.screenshot({path:`artifacts/compact-city/financial-${light}.png`});
 await page.getByRole('button',{name:'Financial District Station →',exact:true}).click();await settle(page,2);await page.screenshot({path:`artifacts/compact-city/financial-station-${light}.png`});
 await page.getByRole('button',{name:'Back to Atlas Hills',exact:true}).click();await settle(page,2);await page.screenshot({path:`artifacts/compact-city/hills-connections-${light}.png`});expect(errors).toEqual([]);
});
for(const light of ['day','night'] as const)test(`Overview fit includes the highway: ${light}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openAtlas(page,{light,storage:{powerMode:'saver'}});await waitForScene(page);await settle(page,2);
 const highway=(await transportPlan(page)).highway;
 const projected=await page.evaluate(async(points)=>{const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Renderer import missing');const fiber:typeof import('@react-three/fiber')=await import(url),state=fiber._roots.get(document.querySelector('canvas')!)!.store.getState();return (points as [number,number][]).map(([x,z])=>{const v=state.camera.position.clone().set(x,.7,z).project(state.camera);return [v.x,v.y];});},highway);
 expect(Math.max(...projected.map(p=>Math.abs(p[0])))).toBeLessThan(.98);expect(Math.min(...projected.map(p=>p[1]))).toBeGreaterThan(-.92);expect(Math.max(...projected.map(p=>p[1]))).toBeLessThan(.9);
 await page.screenshot({path:`artifacts/compact-city/after-${light}.png`});expect(errors).toEqual([]);
});
