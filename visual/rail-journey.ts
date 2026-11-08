import {expect,type Page} from '@playwright/test';
import {openAtlas,settle} from './atlas';
/** Exercise Fiber's public manual-advance API, never callback source-string matching. */
export async function railJourney(page:Page){
 await page.setViewportSize({width:1080,height:700});await page.bringToFront();
 // The frozen clock delays browser media events. Deliver the real query change explicitly.
 await page.addInitScript(()=>{const match=window.matchMedia.bind(window),queries:MediaQueryList[]=[];Object.assign(window,{__railQueries:queries});window.matchMedia=q=>{const m=match(q);queries.push(m);return m;};});
 await openAtlas(page,{storage:{powerMode:'balanced'}});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{for(const q of (window as unknown as {__railQueries:MediaQueryList[]}).__railQueries)q.dispatchEvent(new Event('change'));});
 await settle(page,3);

 const result=await page.evaluate(async()=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Renderer import missing');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,store=fiber._roots.get(canvas)!.store,state=store.getState();
  const train=state.scene.getObjectByName('atlas-passenger-train');if(!train)throw new Error('Passenger train missing');
  const [data,layout,planner,passengers]=await Promise.all(['/src/catalog/index.ts','/src/views/mapLayout.ts','/src/views/map3d/scene.ts','/src/views/map3d/loopPassengers.ts'].map(u=>import(u)));
  const loop=planner.buildScene(layout.layoutMap(data.catalog,[],'district')).communityRail.loop,riders=passengers.planLoopPassengers(loop);
  const mesh=state.scene.getObjectByName('rail-commuters') as import('three').InstancedMesh;if(!mesh)throw new Error('Commuter mesh missing');
  state.setFrameloop('never');const render=state.gl.render;state.gl.render=()=>{};
  const visited=new Set<number>(),faults:string[]=[];let walking=0,last:number[][]=[];
  try{for(let t=.1;t<loop.period+1;t+=.1){fiber.advance(t,false,store.getState());if(train.userData.station>=0)visited.add(train.userData.station);
   const current:number[][]=[];for(let i=0;i<riders.length;i++){const e=mesh.instanceMatrix.array,k=i*16,visible=Math.hypot(e[k],e[k+1],e[k+2])>.001,p=[e[k+12],e[k+14]];current.push(visible?p:[]);if(!visible)continue;walking++;
    const routes=[riders[i].out.points,riders[i].destinationWalk.points];let nearest=Infinity;for(const r of routes)for(let j=1;j<r.length;j++){const a=r[j-1],b=r[j],dx=b[0]-a[0],dz=b[2]-a[2],u=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[2])*dz)/(dx*dx+dz*dz||1)));nearest=Math.min(nearest,Math.hypot(p[0]-a[0]-u*dx,p[1]-a[2]-u*dz));}
    if(nearest>.02)faults.push(`Passenger ${i} left its route`);if(last[i]?.length&&Math.hypot(p[0]-last[i][0],p[1]-last[i][1])>.12)faults.push(`Passenger ${i} jumped`);
   }last=current;if(faults.length)break;}
  }finally{state.gl.render=render;}
  return {trains:state.scene.getObjectsByProperty('name','atlas-passenger-train').length,visited:visited.size,stops:loop.stops.length,elapsed:train.userData.elapsed,walking,faults};
 });
 expect(result.trains).toBe(1);expect(result.visited,JSON.stringify(result)).toBe(4);expect(result.stops).toBe(4);expect(result.elapsed).toBeGreaterThan(60);expect(result.walking).toBeGreaterThan(0);expect(result.faults).toEqual([]);
 await page.getByRole('button',{name:'Traffic',exact:true}).click();await settle(page,1);
 const paused=await page.evaluate(async()=>{const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1],fiber:typeof import('@react-three/fiber')=await import(url),store=fiber._roots.get(document.querySelector('canvas')!)!.store,state=store.getState(),train=state.scene.getObjectByName('atlas-passenger-train')!,before=train.userData.elapsed;const render=state.gl.render;state.gl.render=()=>{};try{for(let t=1000;t<1003;t+=.1)fiber.advance(t,false,store.getState());}finally{state.gl.render=render;}return {before,after:train.userData.elapsed};});
 expect(paused.before).toBeGreaterThan(60);expect(paused.after).toBe(paused.before);
}
