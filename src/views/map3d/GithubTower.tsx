import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,patterned,signTexture} from './materials';
import {GITHUB_TOWER,githubTowerHeight,planGithubTower} from './githubTowerPlan';
import {githubTowerGeometry} from './githubTowerGeometry';
import {useQualityLevel} from '../../lib/governor';

const noRaycast=()=>null;

/**
 * Floor-to-ceiling glass: thin mullions on dark glass by day; at night the panes glow warm, a few
 * left dark so the floors don't read as one lit stripe.
 */
function glassTextures(){
 const make=(lit:boolean)=>{
  const c=document.createElement('canvas');c.width=128;c.height=64;const g=c.getContext('2d')!;
  const panes=6,w=c.width/panes;
  for(let i=0;i<panes;i++){
   if(lit){const on=[1,1,0,1,1,1][i];g.fillStyle=on?(i%2?'#ffd9a1':'#ffe6bd'):'#1a1612';}
   else{const grad=g.createLinearGradient(0,0,0,c.height);grad.addColorStop(0,'#71838f');grad.addColorStop(1,'#34414b');g.fillStyle=grad;}
   g.fillRect(i*w,0,w,c.height);
  }
  g.fillStyle=lit?'#000':'#c9ccc8';
  for(let i=0;i<=panes;i++)g.fillRect(i*w-1.5,0,3,c.height);
  g.fillRect(0,c.height*.12,c.width,2);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
 };
 return {map:make(false),glow:make(true)};
}

function wordmark(text:string){
 const c=document.createElement('canvas');c.width=512;c.height=128;const g=c.getContext('2d')!;
 g.fillStyle='#f4f6f0';g.textAlign='center';g.textBaseline='middle';g.font='600 92px "Helvetica Neue", Arial, sans-serif';
 g.fillText(text,256,68,500);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

/**
 * The GitHub HQ as a stacked-slab tower (see githubTowerPlan). Five merged meshes plus instanced
 * trees and cushions, no lights. Lighter quality levels drop the small details' shadows, then
 * the tree trunks and balustrades.
 */
export function GithubTower({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const quality=useQualityLevel();
 const height=t.customHeight??githubTowerHeight(t.height);
 const plan=useMemo(()=>planGithubTower(t.size,height),[t.size,height]);
 const geo=useMemo(()=>githubTowerGeometry(plan),[plan]);
 useEffect(()=>()=>{for(const v of Object.values(geo))v.dispose();},[geo]);
 const mats=useMemo(()=>{
  const tex=glassTextures();
  return {
   textures:[tex.map,tex.glow],
   concrete:focusable(patterned('#e5e5e2','stone',{roughness:.88})),
   glass:focusable(new THREE.MeshStandardMaterial({map:tex.map,emissiveMap:tex.glow,emissive:'#ffffff',emissiveIntensity:0,roughness:.12,metalness:.4})),
   lobby:focusable(new THREE.MeshStandardMaterial({color:'#3a4650',roughness:.15,metalness:.4,emissive:'#ffd6a0',emissiveIntensity:0})),
   rails:focusable(new THREE.MeshStandardMaterial({color:'#b4d3df',transparent:true,opacity:.3,roughness:.1,metalness:.1,depthWrite:false})),
  };
 },[]);
 useEffect(()=>{mats.glass.emissiveIntensity=night?.9:0;mats.lobby.emissiveIntensity=night?.7:0;},[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);
 const signs=useMemo(()=>{
  const word=wordmark('GitHub'),badge=signTexture(t.identity,t.name);
  const mat=(map:THREE.Texture,glow:number)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:glow,transparent:true,alphaTest:.3,roughness:.4}));
  const worker=t.agents+t.automations>0?signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'):null;
  return {textures:[word,badge,worker].filter((x):x is THREE.CanvasTexture=>!!x),word:mat(word,.5),badge:mat(badge,.55),worker:worker?mat(worker,.55):null};
 },[t.identity,t.name,t.agents,t.automations]);
 useEffect(()=>()=>{for(const x of signs.textures)x.dispose();signs.word.dispose();signs.badge.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const cushions:Inst[]=[],trunks:Inst[]=[],crowns:Inst[]=[],soil:Inst[]=[],shrubs:Inst[]=[];
  const w=(x:number,y:number,z:number):[number,number,number]=>[t.x+x,base+y,t.z+z];
  for(const s of plan.stairs)for(const c of s.cushions)cushions.push({p:w((c.x0+c.x1)/2,c.y0,(c.z0+c.z1)/2),s:[c.x1-c.x0,c.y1-c.y0,c.z1-c.z0],c:GITHUB_TOWER.cushion});
  for(const [i,tr] of plan.trees.entries()){
   trunks.push({p:w(tr.x,tr.y,tr.z),s:[.016,tr.trunk,.016],c:'#6b5a48'});
   const greens=['#5f8f4a','#6f9c50','#557f43'];
   crowns.push({p:w(tr.x,tr.y+tr.trunk+tr.crown*.55,tr.z),s:[tr.crown,tr.crown*1.15,tr.crown],c:greens[i%3]});
   crowns.push({p:w(tr.x+tr.crown*.5,tr.y+tr.trunk+tr.crown*.2,tr.z+tr.crown*.3),s:[tr.crown*.62,tr.crown*.62,tr.crown*.62],c:greens[(i+1)%3]});
  }
  for(const p of plan.planters){soil.push({p:w((p.x0+p.x1)/2,p.y1,(p.z0+p.z1)/2),s:[(p.x1-p.x0)*.86,.008,(p.z1-p.z0)*.86],c:'#6f9c50'});
   shrubs.push({p:w(p.x0+(p.x1-p.x0)*.25,p.y1+.02,p.z1-(p.z1-p.z0)*.25),s:[.035,.03,.035],c:'#7aa35a'});}
  // Shrubs along the podium's front terrace.
  const [lower,upper]=plan.podium;
  for(let x=lower.x0+.1*plan.k;x<lower.x1-.08*plan.k;x+=.11*plan.k)shrubs.push({p:w(x,lower.y1+.05,(upper.z1+lower.z1)/2),s:[.045,.035,.045],c:x%2>1?'#5f8f4a':'#77a35a'});
  return {cushions,trunks,crowns,soil,shrubs};
 },[plan,t.x,t.z,base]);
 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);
 const detailShadow=quality<2;
 const [lower,upper]=plan.podium,k=plan.k;
 const signY=(lower.y1+upper.y1-GITHUB_TOWER.slab)/2,badge=.15*k,crownY=plan.height+GITHUB_TOWER.core.crown*.5,mark=GITHUB_TOWER.core.crown*.72;
 return <group>
  <group name="github-tower" position={[t.x,base,t.z]}>
   <mesh geometry={geo.concrete} material={mats.concrete} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.glass} material={mats.glass} receiveShadow {...handlers}/>
   <mesh geometry={geo.lobby} material={mats.lobby} receiveShadow {...handlers}/>
   <mesh geometry={geo.garden} material={m.lawn} receiveShadow raycast={noRaycast}/>
   {quality<3&&<mesh geometry={geo.rails} material={mats.rails} raycast={noRaycast}/>}
   {/* Lobby sign on the upper podium tier, at the Financial District's sign scale. */}
   <mesh geometry={g.plane} material={signs.word} position={[.06*k,signY,upper.z1+.004]} scale={[.42*k,.105*k,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.badge} position={[-.3*k,signY,upper.z1+.005]} scale={[badge,badge,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[.38*k,signY,upper.z1+.005]} scale={[badge*.8,badge*.8,1]} raycast={noRaycast}/>}
   {/* The GitHub mark on the core's crown, front and side, above the roof garden. */}
   <mesh geometry={g.plane} material={signs.badge} position={[0,crownY,plan.core.z1+.004]} scale={[mark,mark,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.badge} position={[plan.core.x1+.004,crownY,(plan.core.z0+plan.core.z1)/2]} rotation={[0,Math.PI/2,0]} scale={[mark,mark,1]} raycast={noRaycast}/>
  </group>
  <Instanced items={parts.cushions} geometry={g.box} material={m.plain} shadow={detailShadow}/>
  <Instanced items={parts.crowns} geometry={g.blob} material={m.foliage} shadow={detailShadow}/>
  {quality<3&&<Instanced items={parts.trunks} geometry={g.trunk} material={m.plain} shadow={false}/>}
  <Instanced items={parts.soil} geometry={g.box} material={m.plain} shadow={false}/>
  <Instanced items={parts.shrubs} geometry={g.blob} material={m.foliage} shadow={false}/>
 </group>;
}
