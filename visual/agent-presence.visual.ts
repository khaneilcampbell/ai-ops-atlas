import {test,expect,type Page} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {goTo,openAtlas,settle,waitForScene} from './atlas';
/**
 * Presence schedules (docs/agent-workdays.md): the Workday tab editor, and scheduled agents on the
 * map at the frozen clock (2026-10-28 15:00 UTC, a Wednesday, 11:00 in New York). The schedules
 * below put one agent on each walk state. Map shots run only when SHOT_DIR names a folder.
 */
const out=process.env.SHOT_DIR??'';
const ny=(work:string,home:string,start:string,end:string)=>({home,work,days:[1,2,3,4,5],start,end,timeZone:'America/New_York'});
export const SCHEDULES={
 'atlas-release-manager':ny('ai-ops-atlas','circa','11:10','19:00'), // walking to work, halfway
 'atlas-health-monitor':ny('ai-ops-atlas','residence','06:00','10:30'), // outdoors near home
 'benjaire-ops-monitor':ny('benjaire-site','circa','06:00','10:55'), // walking home
 'benjaire-inquiry-manager':ny('benjaire-site','circa','09:00','17:00'), // at work, inside
};
const save=async(page:Page,name:string)=>{if(out){mkdirSync(out,{recursive:true});await page.screenshot({path:`${out}/${name}.png`});}};
async function openWorkday(page:Page,id:string,width:number,storage:Record<string,unknown>={}){
 await page.setViewportSize({width,height:width>600?900:844});await openAtlas(page,{storage:{'registry-prefs-agents':{view:'all'},...storage}});await goTo(page,'Agents');
 await page.getByRole('textbox',{name:'Search agents',exact:true}).fill(id);await settle(page,1);
 await page.locator(`.reg-row[data-id="${id}"]`).click();await settle(page,1);
 await page.getByRole('tab',{name:'Workday',exact:true}).click();await settle(page,1);
}
for(const [label,width] of [['desktop',1512],['phone',390]] as const)test(`Presence editor, ${label}`,async({page})=>{
 await openWorkday(page,'atlas-release-manager',width);
 const editor=page.getByTestId('presence-editor');
 await expect(editor).toContainText('never starts, stops or reports a run');
 await expect(page.getByTestId('presence-now')).toContainText('No schedule saved');
 await editor.scrollIntoViewIfNeeded();await save(page,`editor-empty-${width}`);
 await editor.getByLabel('Starts').fill('11:10');await editor.getByLabel('Ends').fill('19:00');
 await editor.getByLabel('Time zone').selectOption('America/New_York');
 await editor.getByRole('button',{name:'Save schedule'}).click();await settle(page,1);
 await expect(page.getByTestId('presence-now')).toHaveText('Walking to work');
 // Presence and activity stay two answers: walking to work is not a run.
 await expect(page.getByTestId('presence-activity')).not.toContainText('Walking');
 await editor.getByRole('checkbox').first().scrollIntoViewIfNeeded();
 for(const box of await editor.getByRole('checkbox').all())if(await box.isChecked())await box.uncheck();
 await expect(editor.getByRole('alert')).toHaveText('Choose at least one working day.');
 await expect(editor.getByRole('button',{name:'Save schedule'})).toBeDisabled();
 await save(page,`editor-saved-${width}`);
});
test('Presence at work, desktop',async({page})=>{
 await openWorkday(page,'benjaire-inquiry-manager',1512,{'agent-presence':SCHEDULES});
 await expect(page.getByTestId('presence-now')).toHaveText('At its workplace');
 await page.getByTestId('presence-editor').scrollIntoViewIfNeeded();await save(page,'editor-at-work-1512');
});
for(const [label,width] of [['desktop',1512],['phone',390]] as const)test(`Presence on the map, ${label}`,async({page})=>{
 test.skip(!out,'Set SHOT_DIR to a folder to take presence map screenshots.');test.setTimeout(600_000);mkdirSync(out,{recursive:true});
 await page.setViewportSize({width,height:width>600?900:844});await openAtlas(page,{storage:{'agent-presence':process.env.BEFORE?{}:SCHEDULES}});await waitForScene(page);await settle(page,6);
 const shots=await page.evaluate(async({ids,phone,schedules})=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const mesh=state.scene.getObjectByName('rail-commuters') as import('three').InstancedMesh;
  const [data,layout,planner,jobs,commute]=await Promise.all(['/src/catalog/index.ts','/src/views/mapLayout.ts','/src/views/map3d/scene.ts','/src/catalog/agentJobs.ts','/src/views/map3d/agentCommutes.ts'].map(u=>import(u)));
  const scene=planner.buildScene(layout.layoutMap(data.catalog,[],'district')),plan=commute.planAgentCommutes(scene,jobs.agentJobs(data.catalog,schedules));
  const e=mesh.instanceMatrix.array,res:{name:string;png:string}[]=[];
  for(const id of ids){   // Same spot either way: from the schedule's route, so the before shot shows the place empty.
   const c=plan.commutes.find((x:{agentId:string})=>x.agentId===id),at=commute.agentAt(c,0,new Date());const x=at.x,z=at.z;
   let j=-1,bd=1e9;for(let n=0;n<mesh.count;n++){const d=Math.hypot(e[n*16+12]-x,e[n*16+14]-z);if(d<bd){bd=d;j=n;}}// The walker's own height on the terrace; the before shot (no walker there) uses the same height.
   const y=bd<1e-3?e[j*16+13]:.78;
   // The crowd mesh sits in a placed group: frame the walker in world space.
   mesh.updateWorldMatrix(true,false);const w=mesh.matrixWorld.elements,wx=w[0]*x+w[4]*y+w[8]*z+w[12],wy=w[1]*x+w[5]*y+w[9]*z+w[13],wz=w[2]*x+w[6]*y+w[10]*z+w[14];
   const eye:[number,number,number]=phone?[wx+2.5,wy+4,wz+5]:[wx+1.8,wy+1.3,wz+2.2];state.camera.position.set(...eye);state.camera.lookAt(wx,wy,wz);
   // The map fits near/far to its own view (fogRange.ts); a close-up needs a near plane close to the eye.
   const cam=state.camera as import('three').PerspectiveCamera;cam.near=.05;cam.far=400;cam.updateProjectionMatrix();if(state.scene.fog&&'near' in state.scene.fog){state.scene.fog.near=50;state.scene.fog.far=400;}state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);
   res.push({name:`${id}-${at.where}`,png:canvas.toDataURL('image/png')});}
  return res;
 },{ids:['atlas-release-manager','atlas-health-monitor','benjaire-ops-monitor'],phone:width<600,schedules:SCHEDULES});
 for(const s of shots)writeFileSync(`${out}/map-${s.name}-${width}${process.env.BEFORE?'-before':''}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(shots.map(s=>s.name)).toEqual(['atlas-release-manager-to-work','atlas-health-monitor-outdoors','benjaire-ops-monitor-to-home']);
});
