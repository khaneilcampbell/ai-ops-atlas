import {transportPlan} from './compact-city-plan';
import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
test('Complete rendered commuter round trip',async({page})=>{
 mkdirSync('artifacts/compact-city',{recursive:true});
 await page.setViewportSize({width:1080,height:700});await page.emulateMedia({reducedMotion:'no-preference'});await page.bringToFront();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'day',storage:{powerMode:'balanced',mapTraffic:true,mapProjectGrouping:'none'}});await waitForScene(page);await settle(page,2);
 await page.screenshot({path:'artifacts/compact-city/after-none-day.png'});
 expect(await page.evaluate(()=>document.hasFocus()&&document.visibilityState==='visible')).toBe(true);
 const plan=(await transportPlan(page)).rail;
 // Exercise the real useFrame callbacks using Fiber's installed manual-advance API.
 // Skip GPU draws between checkpoints; no production hooks, timers, or animation changes.
 const result=await page.evaluate(async(plan)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Installed Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const groups:typeof state.scene.children=[];state.scene.traverse(o=>{if(o.type==='Group'&&Math.abs(o.position.y-2.5)<.001&&o.children.some(c=>'isInstancedMesh' in c))groups.push(o);});
  const train=groups.sort((a,b)=>Math.hypot(a.position.x-plan.hills[0],a.position.z-plan.hills[1])-Math.hypot(b.position.x-plan.hills[0],b.position.z-plan.hills[1]))[0];if(!train)throw new Error('Train not found');
  const people:typeof state.scene.children=[];state.scene.traverse(o=>{if(o.name==='rail-commuter')people.push(o);});
  const render=state.gl.render.bind(state.gl);state.setFrameloop('never');const manual=fiber._roots.get(canvas)!.store.getState();state.gl.render=()=>{};let time=0;
  const travel=plan.length/3.2,checkpoints=[['home',16],['outbound',32+travel/2],['bank',32+travel+16],['return',64+travel*1.5],['arrived',64+travel*2+8]] as const;
  const shots=[],trace=[];
  try{for(const [phase,end]of checkpoints){while(time<end){time=Math.min(end,time+.1);fiber.advance(time,false,manual);}
   const riders=train.children.filter(c=>c.type==='Group'&&Math.abs(c.position.y)<.001&&c.children.some(m=>'isInstancedMesh' in m)),doors=train.children.filter(c=>c.type==='Group'&&Math.abs(c.position.y-.16)<.001);
   trace.push({phase,train:train.position.toArray(),people:people.map(p=>({visible:p.visible,position:p.position.toArray()})),riding:riders.some(c=>c.visible),doors:doors.map(c=>c.rotation.y)});
   const target=phase==='bank'?people[1].position.clone():train.position.clone();if(phase==='home')target.lerp(people[1].position,.5);
   const wide=phase==='home';state.camera.position.set(target.x+(wide?15:phase==='bank'?4:8),target.y+(wide?13:phase==='bank'?4.5:7),target.z+(wide?18:phase==='bank'?7:10));state.camera.lookAt(target);state.camera.updateMatrixWorld();render(state.scene,state.camera);
   shots.push({phase,png:canvas.toDataURL('image/png')});
  }}finally{state.gl.render=render;}
  return {shots,trace};
 },plan);
 for(const s of result.shots)writeFileSync(`artifacts/compact-city/commute-${s.phase}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 writeFileSync('artifacts/compact-city/commute-trace.json',JSON.stringify(result.trace,null,2));
 expect(result.trace[0].people).toHaveLength(6);
 for(const t of result.trace){const riding=t.phase==='outbound'||t.phase==='return';expect(t.riding).toBe(riding);expect(t.people.every(p=>p.visible===!riding)).toBe(true);expect(t.doors.every(d=>riding?Math.abs(d)<.001:Math.abs(d)>1.5)).toBe(true);}
 const final=result.trace[result.trace.length-1].train;expect(Math.hypot(final[0]-plan.hills[0],final[2]-plan.hills[1])).toBeLessThan(.1);expect(errors).toEqual([]);
});
