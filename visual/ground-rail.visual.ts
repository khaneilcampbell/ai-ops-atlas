import {test,expect} from '@playwright/test';import {writeFileSync,mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
// Runs only when SHOT_DIR names a folder; the regular visual checks skip it (software WebGL is slow in CI).
test.skip(!process.env.SHOT_DIR,'Set SHOT_DIR to a folder to take ground-level railway screenshots.');
/** The shore railway runs on the ground; Events Arena Station and the walk to the yacht dock (Khaneil, 2026-11-15). */
const out=process.env.SHOT_DIR??'artifacts/ground-rail';
// PHONE=1 takes the same views at iPhone width.
if(process.env.PHONE)test.use({viewport:{width:390,height:844}});
const suffix=process.env.PHONE?'-phone':'';
type View=[string,[number,number,number],[number,number,number]];
// Default "By district" layout: Events Arena Station at x -6.3, z 58; the marina's pier walk at x 2.5.
const VIEWS:View[]=[
 ['arena-station',[-2,0,55],[9,9,71]],
 ['marina-crossing',[2.5,.6,57.6],[7,3.6,63]],
 // Harbour platform (Khaneil, 2026-11-16): the seaward platform face, its boardwalk and the dog-leg stair to the pier.
 ['harbour-platform',[-1.5,.4,58.9],[1.5,4.4,66]],
 ['harbour-stair',[1.2,-.4,59.7],[6,2.4,64]],
 ['gateway-city',[3.1,.8,56.3],[7.5,3.2,51]],
 ['gateway-bridge',[3.4,.9,57.9],[9.5,3.2,55.5]],
 ['gateway-boardwalk',[3,.6,58.9],[6.5,2.6,63.5]],
 ['station-close',[-6.3,.8,57.4],[-1.5,3,63.5]],
 ['station-ramp',[-5.3,.3,54.5],[-0.5,3.4,47.5]],
 ['shore-corner',[44,0,55],[54,7,66]],
 ['financial-station',[12,.6,-19.5],[16,5,-28]],
 ['overview',[9,0,22],[9,60,100]],
];
// VIEWS=a,b takes only the named views.
const only=process.env.VIEWS?.split(',');
for(const light of ['day','night'] as const)test(`ground railway, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openAtlas(page,{light});await waitForScene(page);await settle(page,2);
 const shots=await page.evaluate(async(views)=>{
  const source=await(await fetch('/src/views/map3d/HillsCommunity.tsx')).text(),url=source.match(/from\s*["']([^"']*react-three_fiber[^"']*)["']/)?.[1];if(!url)throw new Error('Fiber import not found');
  const fiber:typeof import('@react-three/fiber')=await import(url),canvas=document.querySelector('canvas')!,state=fiber._roots.get(canvas)?.store.getState();if(!state)throw new Error('Map renderer not found');
  const list:{name:string;png:string}[]=[];
  for(const [name,target,eye]of views){state.camera.position.set(...eye);state.camera.lookAt(...target);state.camera.updateMatrixWorld();state.gl.shadowMap.needsUpdate=true;state.gl.render(state.scene,state.camera);list.push({name,png:canvas.toDataURL('image/png')});}
  return list;
 },only?VIEWS.filter(v=>only.includes(v[0])):VIEWS);
 for(const s of shots)writeFileSync(`${out}/${s.name}-${light}${suffix}.png`,Buffer.from(s.png.split(',')[1],'base64'));
 expect(errors).toEqual([]);
});
