import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openAtlas,selectBuilding,settle,waitForScene} from './atlas';
test.use({viewport:{width:1400,height:900},deviceScaleFactor:1});

for(const light of ['day','night'] as const)test(`financial solid surfaces select the same building as their plaque, ${light}`,async({page})=>{
 test.setTimeout(600_000);
 await openAtlas(page,{light});await waitForScene(page);await selectBuilding(page,'Financial District');
 const buildings=[['records','Wells Fargo'],['budget','American Express'],['banks','Chase'],['investments','Robinhood'],['insurance','Navy Federal Credit Union'],['business-finance','Benjaire Finance'],['financial-planning','Vanguard'],['harbor-residence','The Ritz-Carlton']];
 for(const [id,name] of (light==='day'?buildings:buildings.slice(0,2))){
  await selectBuilding(page,'Financial District');console.log('checking',name);
  // The plaque frames this tower; the second click is a real pointer click on its solid roof.
  await selectBuilding(page,name);
  const point=await page.evaluate(async({key})=>{
   const source=await(await fetch('/src/views/map3d/models.tsx')).text();
   const fiberUrl=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)![1];
   const threeUrl=source.match(/from\s*["']([^"']*three\.js[^"']*)["']/)![1];
   const fiber=await import(fiberUrl),T=await import(threeUrl);
   const canvas=document.querySelector('.map3d canvas') as HTMLCanvasElement;
   const state=fiber._roots.get(canvas).store.getState();
   const candidates:{x:number;y:number;area:number}[]=[];
   state.scene.traverse((o:import('three').InstancedMesh)=>{
    const keys=o.userData.selectionKeys as string[]|undefined;
    if(!o.isInstancedMesh||!keys||!o.geometry.type.includes('Box'))return;
    const matrix=new T.Matrix4(),pos=new T.Vector3(),q=new T.Quaternion(),scale=new T.Vector3();
    keys.forEach((k,i)=>{if(k!==key)return;o.getMatrixAt(i,matrix);matrix.decompose(pos,q,scale);
     if(scale.x<1||scale.z<1||scale.y>.4)return;
     const world=new T.Vector3(pos.x,pos.y+scale.y/2+.002,pos.z).applyMatrix4(o.matrixWorld);
     const projected=world.clone().project(state.camera),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(projected.x,projected.y),state.camera);
     const hits=ray.intersectObjects(state.scene.children,true);
     const hit=hits.find((h:import('three').Intersection)=>h.object.userData.selectionKeys);
     if(!hit||hit.object.userData.selectionKeys[hit.instanceId!]!==key)return;
     const r=canvas.getBoundingClientRect();candidates.push({x:r.left+(projected.x+1)*r.width/2,y:r.top+(1-projected.y)*r.height/2,area:scale.x*scale.z});
    });
   });
   return candidates.sort((a,b)=>b.area-a.area)[0];
  },{key:`service:financial:${id}`});
  expect(point,`${name} needs a directly pickable solid roof`).toBeTruthy();
  await page.mouse.click(point.x,point.y);await settle(page,2);
  await expect(page.getByLabel('Inspector',{exact:true})).toContainText(name);
  await expect(page.locator('.m3-plaque.selected')).toContainText(name);
 }
 mkdirSync('artifacts/building-selection',{recursive:true});await page.screenshot({path:`artifacts/building-selection/${light}.png`});
});
