import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/**
 * Drives the real map renderer through one full commuter period (both commuter groups of six, plus the visitor groups) and checks what is
 * drawn: commuters only appear on their own walking routes, never jump, ride only while the train is
 * moving with its doors shut, and the bullet train stops at both Atlas Hills and Financial Park.
 */
test('Complete rendered commuter round trip',async({page})=>{
 test.setTimeout(240_000);
 mkdirSync('artifacts/compact-city',{recursive:true});
 await page.setViewportSize({width:1080,height:700});await page.emulateMedia({reducedMotion:'no-preference'});await page.bringToFront();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'day',storage:{powerMode:'balanced',mapTraffic:true,mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:'artifacts/compact-city/after-none-day.png'});
 expect(await page.evaluate(()=>document.hasFocus()&&document.visibilityState==='visible')).toBe(true);
 // Exercise the real useFrame callbacks using Fiber's installed manual-advance API.
 // Skip GPU draws between checkpoints; no production hooks, timers, or animation changes.
 const result=await page.evaluate(async()=>{
  const [data,layout,planner,commute,walkers]=await Promise.all(['/src/catalog/index.ts','/src/views/mapLayout.ts','/src/views/map3d/scene.ts','/src/views/map3d/railCommuters.ts','/src/views/map3d/districtWalkers.ts'].map(url=>import(url)));
  const grouping=JSON.parse(localStorage.getItem('atlas:mapProjectGrouping')??'"district"'),scene=planner.buildScene(layout.layoutMap(data.catalog,[],grouping));
  const plan=commute.planRailCommuters(scene.community,scene.financial,scene.communityRail),rail=scene.communityRail;if(!plan||!rail)throw new Error('Commuter plan not found');
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Installed Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  type Obj=typeof state.scene.children[number];
  const cars:Obj[]=[];state.scene.traverse(o=>{if(o.type==='Group'&&Math.abs(o.position.y-2.5)<.001&&o.children.some(c=>'isInstancedMesh' in c)&&o.children.some(c=>c.type==='Group'&&Math.abs(c.position.y-.16)<.001))cars.push(o);});
  if(cars.length!==3)throw new Error(`Expected 3 carriages, found ${cars.length}`);
  const mesh=state.scene.getObjectByName('rail-commuters') as import('three').InstancedMesh|undefined;if(!mesh)throw new Error('Commuter mesh not found');
  const segments=plan.commuters.flatMap((p:{hills:{points:number[][]};financial:{points:number[][]}})=>[p.hills.points,p.financial.points].flatMap(r=>r.slice(1).map((b,i)=>[r[i],b])));
  const offRoute=(x:number,z:number)=>Math.min(...segments.map(([a,b]:number[][])=>{const dx=b[0]-a[0],dz=b[2]-a[2],l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/l));return Math.hypot(a[0]+dx*t-x,a[2]+dz*t-z);}));
  const people=()=>Array.from({length:mesh.count},(_,i)=>{const e=mesh.instanceMatrix.array,k=i*16;return {visible:Math.hypot(e[k],e[k+1],e[k+2])>1e-3,x:e[k+12],z:e[k+14]};});
  const centre=()=>cars[1].position,near=(p:number[])=>Math.min(...cars.map(c=>Math.hypot(c.position.x-p[0],c.position.z-p[1])));
  const render=state.gl.render.bind(state.gl);state.setFrameloop('never');const manual=fiber._roots.get(canvas)!.store.getState();state.gl.render=()=>{};
  const span=plan.periodCycles*plan.cycle+plan.cycle,shots:{phase:string;png:string}[]=[],seen={walking:0,outbound:false,back:false,hills:false,financial:false},faults:string[]=[];
  let last=people(),lastTrain=near(rail.hills),maxWalking=0;
  const shoot=(phase:string,target:{x:number;y:number;z:number},far:number)=>{state.camera.position.set(target.x+far,target.y+far*.85,target.z+far*1.2);state.camera.lookAt(target.x,target.y,target.z);state.camera.updateMatrixWorld();render(state.scene,state.camera);shots.push({phase,png:canvas.toDataURL('image/png')});};
  shoot('home',centre(),15);
  try{for(let time=.1;time<=span;time+=.1){fiber.advance(time,false,manual);
   const now=people(),open=cars.every(c=>c.children.filter(d=>d.type==='Group'&&Math.abs(d.position.y-.16)<.001).every(d=>Math.abs(d.rotation.y)>1.5)),riding=cars.some(c=>c.children.some(r=>r.type==='Group'&&Math.abs(r.position.y)<.001&&r.visible)),toHills=near(rail.hills);
   if(riding&&open)faults.push(`riders shown with open doors at ${time.toFixed(1)}s`);
   if(open&&toHills<.1)seen.hills=true;if(open&&near(rail.financial)<.1)seen.financial=true;
   if(riding&&!open){const out=toHills>lastTrain+1e-4,back=toHills<lastTrain-1e-4;if(out&&!seen.outbound){seen.outbound=true;shoot('outbound',centre(),8);}if(back&&!seen.back){seen.back=true;shoot('return',centre(),8);}}
   const walking=now.filter(p=>p.visible);seen.walking=Math.max(seen.walking,walking.length);
   if(walking.length>maxWalking&&walking.length>=6){maxWalking=walking.length;const x=walking.reduce((s,p)=>s+p.x,0)/walking.length,z=walking.reduce((s,p)=>s+p.z,0)/walking.length;const prior=shots.findIndex(s=>s.phase==='walking');if(prior>=0)shots.splice(prior,1);shoot('walking',{x,y:2.2,z},6);}
   now.forEach((p,i)=>{if(!p.visible)return;const off=offRoute(p.x,p.z);if(off>.2)faults.push(`commuter ${i} ${off.toFixed(2)} off route at ${time.toFixed(1)}s`);if(last[i].visible&&Math.hypot(p.x-last[i].x,p.z-last[i].z)>.12)faults.push(`commuter ${i} jumped at ${time.toFixed(1)}s`);});
   last=now;lastTrain=toHills;if(faults.length>5)break;}
   shoot('arrived',centre(),8);
  }finally{state.gl.render=render;}
  return {shots,seen,faults,count:mesh.count,planned:plan.commuters.length+walkers.planDistrictWalkers(scene.financial).length};
 });
 for(const s of result.shots)writeFileSync(`artifacts/compact-city/commute-${s.phase}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 writeFileSync('artifacts/compact-city/commute-trace.json',JSON.stringify({seen:result.seen,faults:result.faults},null,2));
 // One body per planned person: the rail riders (two commuter groups of six plus the visitor
 // groups) and the Financial District sidewalk walkers, all in the same instanced mesh (#162).
 expect(result.count).toBe(result.planned);
 expect(result.count).toBeGreaterThanOrEqual(12);
 expect(result.faults).toEqual([]);
 expect(result.seen).toMatchObject({outbound:true,back:true,hills:true,financial:true});
 expect(result.seen.walking).toBeGreaterThanOrEqual(6);
 expect(errors).toEqual([]);
});
