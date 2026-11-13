import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openAtlas,waitForScene,settle} from './atlas';
/**
 * Travel loops screenshots (travelLoops.ts): the map's clock is stepped by hand to moments in the loops and the camera
 * framed on each place: people leaving Team Residence Towers, the van at the airport terminal, the train and van at
 * Events Arena Station, guests boarding the yacht, her casting off and out at sea, a close-up of the walkers' arms and legs and glowing shirts, the airport and arena traffic, shoppers close up, the car at the Vendor & Supplier Hub. Written
 * only when SHOT_DIR is set; no baseline comparison. Runs on main too (for before shots): it imports nothing new.
 */
const out=process.env.SHOT_DIR;
for(const width of [1512,390])test(`travel loops ${width}`,async({page})=>{
 test.skip(!out,'Set SHOT_DIR to write the travel loop screenshots');
 test.setTimeout(900_000);mkdirSync(out!,{recursive:true});
 await page.setViewportSize({width,height:width===390?844:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 // Motion on: the frozen clock delays media events, so deliver the reduced-motion change explicitly (rail-journey.ts).
 await page.addInitScript(()=>{const match=window.matchMedia.bind(window),queries:MediaQueryList[]=[];Object.assign(window,{__q:queries});window.matchMedia=q=>{const m=match(q);queries.push(m);return m;};});
 await openAtlas(page,{storage:{powerMode:'balanced'}});await waitForScene(page);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{for(const q of (window as unknown as {__q:MediaQueryList[]}).__q)q.dispatchEvent(new Event('change'));});
 await settle(page,3);
 const tag=width===390?'phone':'desktop';
 const shots=await page.evaluate(async(phone)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,store=fiber._roots.get(canvas)!.store,state=store.getState();
  const [data,layout,planner,marina,yacht,airport,stadium]=await Promise.all(['/src/catalog/index.ts','/src/views/mapLayout.ts','/src/views/map3d/scene.ts','/src/views/map3d/marinaPlan.ts','/src/views/map3d/yachtPlan.ts','/src/views/map3d/airport.ts','/src/views/map3d/stadiumGeometry.ts'].map(u=>import(u)));
  const scene=planner.buildScene(layout.layoutMap(data.catalog,[],'district')),b=yacht.yachtBerth(marina.marinaSite(scene,planner.TERRACE_H)),T=planner.TERRACE_H,W=planner.WATER_Y,k=phone?1.8:1;
  const circa=scene.financial.buildings.find((x:{id:string})=>x.id==='circa'),home=[scene.financial.x+circa.x,scene.financial.z+circa.z],[ax,az]=airport.airportPoint(scene.airport,-.7,6),[gx,gz]=stadium.stadiumGate(scene.stadium),v=scene.galleria.entrance;
  // [name, train-clock second, target, eye]
  const views:[string,number,number[],number[]][]=[
   ['airport-dropoff',46,[ax+1,T,az+2],[ax+9*k,T+7*k,az+9*k]],
   ['team-residence',70,[home[0]+6,T,home[1]+6],[home[0]+12*k,T+9*k,home[1]+16*k]],
   ['figures-closeup',71,[home[0]+6,T+.1,home[1]+6],[home[0]+6+1.1*k,T+.75*k,home[1]+6+1.6*k]],
   ['arena-dropoff',88,[gx+3,T,gz+3],[gx+12*k,T+9*k,gz-4*k]],
   // Buses, luxury cars, SUVs and shipping trucks on the streets between the airport and the arena (travelLoops.ts).
   ['arena-traffic',96,[gx+2,T,gz+6],[gx+20*k,T+16*k,gz-10*k]],
   // Travellers on their way from Events Arena Station to the yacht, close up: glowing shirts.
   ['glow-shirts',98,[-8.5,T+.1,52.3],[-8.5+3*k,T+2.2*k,52.3-3.6*k]],
   ['airport-traffic',112,[ax,T,az+4],[ax+18*k,T+15*k,az+18*k]],
   // Shoppers outside the Vendor & Supplier Hub, close up: everyone in the city has arms and legs.
   ['shoppers-closeup',120,[v.x,T,v.z-1.5],[v.x+2.4*k,T+1.6*k,v.z-4.2*k]],
   ['yacht-boarding',139,[b.x-2,W+.5,b.z-1.5],[b.x+3*k,W+5*k,b.z+8*k]],
   ['yacht-casting-off',158,[b.x+4,W,b.z+3],[b.x-4*k,W+11*k,b.z+16*k]],
   ['vendor-dropoff',185,[v.x+2,T,v.z-3],[v.x+11*k,T+8*k,v.z-10*k]],
   // Halfway round her cruise, well out at sea south of the city (travelLoops.ts yachtCourse).
   ['yacht-at-sea',234,[b.x+8,W,b.z+18],[b.x+4*k,W+34*k,b.z-26*k]],
  ];
  state.setFrameloop('never');const render=state.gl.render;state.gl.render=()=>{};
  const result:{name:string;png:string}[]=[];let clock=0;
  try{for(const [name,time,target,eye]of views){
   while(clock<time){clock+=.1;fiber.advance(clock,false,store.getState());}
   state.camera.position.set(eye[0],eye[1],eye[2]);state.camera.lookAt(target[0],target[1],target[2]);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;
   render.call(state.gl,state.scene,state.camera);result.push({name,png:canvas.toDataURL('image/png')});
  }}finally{state.gl.render=render;}
  return result;
 },width===390);
 for(const s of shots)writeFileSync(`${out}/${tag}-${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
