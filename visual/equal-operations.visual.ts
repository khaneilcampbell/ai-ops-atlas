import {test,expect,type Page} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openAtlas,waitForScene} from './atlas';
async function view(page:Page,phone:boolean,point?:[number,number,number]){
 return page.evaluate(async({phone,point})=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)!.store.getState();
  state.setFrameloop('never');state.camera.position.set(25,phone?90:39,19.76);state.camera.lookAt(25,0,19.75);state.camera.updateMatrixWorld();state.gl.render(state.scene,state.camera);
  const r=canvas.getBoundingClientRect(),p=point?state.camera.position.clone().set(...point).project(state.camera):undefined;
  return {png:canvas.toDataURL('image/png'),point:p?{x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}:undefined};
 },{phone,point});
}
for(const phone of [false,true])test(`Equal operations districts ${phone?'phone':'desktop'}`,async({page})=>{
 const out=process.env.SHOT_DIR??'artifacts/equal-operations';mkdirSync(out,{recursive:true});
 if(phone)await page.setViewportSize({width:390,height:844});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light:'day',storage:{mapTraffic:false}});await waitForScene(page);
 const shot=async(name:string)=>{const {png}=await view(page,phone);writeFileSync(`${out}/${phone?'phone':'desktop'}-${name}.png`,Buffer.from(png.split(',')[1],'base64'));};
 await shot('overview');
 if(process.env.OPERATIONS_SELECTION){
  const sites=await page.evaluate(async()=>{
   const catalogUrl='/src/catalog/index.ts',layoutUrl='/src/views/mapLayout.ts',sceneUrl='/src/views/map3d/scene.ts';
   const {catalog}=await import(catalogUrl),{layoutMap}=await import(layoutUrl),{buildScene}=await import(sceneUrl),layout=layoutMap(catalog,[],'district'),scene=buildScene(layout);
   return ['commerce-pipeline','ai-ops-atlas','intelligence-hub'].map(id=>{const d=layout.districts.find((d:{project:{id:string}})=>d.project.id===id),t=scene.towers.find((t:{projectId:string})=>t.projectId===id);return {id,name:d.project.name,ground:[d.ox+1,.61,d.oy+d.size-1],roof:[t.x,t.height+.7,t.z]};});
  });
  for(const s of sites){
   const check=()=>expect(page.locator('.panel-head h2')).toHaveText(s.name);
   const close=()=>page.getByRole('button',{name:'Close details',exact:true}).click();
   // Building geometry, nameplate and empty district ground use the real selection handlers.
   for(const point of [s.roof,s.ground]){
    const {point:p}=await view(page,phone,point as [number,number,number]);await page.mouse.click(p!.x,p!.y);await check();await close();
   }
   await page.locator('.m3-labels [role="button"]').filter({hasText:s.name}).first().dispatchEvent('click');await check();
   await shot(s.id);await close();
  }
 }
 expect(errors).toEqual([]);
});
