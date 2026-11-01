import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/**
 * AI agents walking between their Circa apartments and their workplaces (KC, 2026-11-01; see
 * docs/agent-workdays.md). Frames the camera on the agents seen walking, then on Circa and a
 * headquarters door. Runs only when SHOT_DIR names a folder; the regular checks skip it.
 */
const out=process.env.SHOT_DIR??'';
test.skip(!out,'Set SHOT_DIR to a folder to take agent commute screenshots.');
async function shoot(page:import('@playwright/test').Page,prefix:string,phone=false){
 return page.evaluate(async({prefix,phone})=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const mesh=state.scene.getObjectByName('rail-commuters') as import('three').InstancedMesh|undefined;if(!mesh)throw new Error('Crowd mesh not found');
  // Agents follow KC's twelve rail commuters in the crowd mesh (HillsCommunity.tsx).
  const [data,layout,planner,jobs,commute]=await Promise.all(['/src/catalog/index.ts','/src/views/mapLayout.ts','/src/views/map3d/scene.ts','/src/catalog/agentJobs.ts','/src/views/map3d/agentCommutes.ts'].map(u=>import(u)));
  const grouping=JSON.parse(localStorage.getItem('atlas:mapProjectGrouping')??'"district"'),scene=planner.buildScene(layout.layoutMap(data.catalog,[],grouping));
  const n=commute.planAgentCommutes(scene,jobs.agentJobs(data.catalog)).commutes.length,e=mesh.instanceMatrix.array,agents:{x:number;y:number;z:number}[]=[];
  for(let i=12;i<12+n;i++){const k=i*16;if(Math.hypot(e[k],e[k+1],e[k+2])>1e-3)agents.push({x:e[k+12],y:e[k+13],z:e[k+14]});}
  if(!agents.length)throw new Error('No agents walking');
  // The walker with the most other agents near it, so the close-up shows a group.
  const c=agents.map(a=>({a,near:agents.filter(b=>Math.hypot(a.x-b.x,a.z-b.z)<3).length})).sort((x,y)=>y.near-x.near)[0].a;
  const views:[string,[number,number,number],[number,number,number]][]=phone?[['phone',[c.x,c.y,c.z],[c.x+4,c.y+9,c.z+9]]]:[
   ['walking-close',[c.x,c.y,c.z],[c.x+1.6,c.y+1.3,c.z+1.9]],['walking',[c.x,c.y,c.z],[c.x+4,c.y+4.5,c.z+5]],['route',[2,0,2],[10,34,38]]];
  const shots:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);shots.push({name:`${prefix}-${name}`,png:canvas.toDataURL('image/png')});}
  return {shots,walking:agents.length};
 },{prefix,phone});
}
for(const light of ['day','night'] as const)test(`Agent commutes, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,6);
 const r=await shoot(page,light);for(const s of r.shots)writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(r.walking).toBeGreaterThan(2);expect(errors).toEqual([]);
});
test('Agent commutes, phone',async({page})=>{
 test.setTimeout(600_000);await page.setViewportSize({width:390,height:844});mkdirSync(out,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,6);
 const r=await shoot(page,'day',true);for(const s of r.shots)writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.png.split(',')[1],'base64'));
});
