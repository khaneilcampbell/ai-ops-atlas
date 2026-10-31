import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {RIBBON,podiumRing,ribbonTop} from './ribbonTowerPlan';
import {ribbonGeometry} from './ribbonTowerGeometry';
import {glassTexture} from './atlasHqTextures';
import {useQualityLevel} from '../../lib/governor';

const noRaycast=()=>null;

function wordmark(text:string){
 const c=document.createElement('canvas');c.width=1024;c.height=192;const g=c.getContext('2d')!;
 g.fillStyle='#c9a36a';g.textAlign='center';g.textBaseline='middle';g.font='500 128px "Helvetica Neue", Arial, sans-serif';
 (g as CanvasRenderingContext2D&{letterSpacing?:string}).letterSpacing='18px';g.fillText(text,512,100,1000);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

/**
 * Benjaire HQ as the ribbon tower. Static merged meshes and a few instances, no lights. The
 * lightest quality level keeps every other ribbon; night warms the windows behind them.
 */
export function RibbonTower({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const k=t.size/RIBBON.refSize,quality=useQualityLevel();
 const height=ribbonTop(k,t.customHeight);
 const geo=useMemo(()=>ribbonGeometry(k,height),[k,height]);
 useEffect(()=>()=>{for(const v of Object.values(geo))if(v instanceof THREE.BufferGeometry)v.dispose();},[geo]);
 const mats=useMemo(()=>{
  const dark=glassTexture('#2a333c','#5b6874','#1f262c',61);
  return {
   textures:[dark.map,dark.glow],
   glass:focusable(new THREE.MeshStandardMaterial({map:dark.map,emissiveMap:dark.glow,emissive:'#ffd6a0',emissiveIntensity:0,roughness:.15,metalness:.35})),
   ribbon:focusable(new THREE.MeshStandardMaterial({color:'#e9dfcc',roughness:.35,metalness:.45})),
   white:focusable(new THREE.MeshStandardMaterial({color:'#f3f1ec',roughness:.6})),
   pglass:focusable(new THREE.MeshStandardMaterial({color:'#3a4650',roughness:.15,metalness:.4,emissive:'#ffd6a0',emissiveIntensity:0})),
   sky:focusable(new THREE.MeshStandardMaterial({color:'#7fa3b8',roughness:.05,metalness:.5,emissive:'#bfe3ff',emissiveIntensity:0})),
   umbrella:focusable(new THREE.MeshStandardMaterial({color:'#faf8f2',roughness:.7})),
  };
 },[]);
 useEffect(()=>{
  mats.glass.emissiveIntensity=night?.95:0;mats.pglass.emissiveIntensity=night?.6:0;mats.sky.emissiveIntensity=night?.5:0;
 },[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);
 const signs=useMemo(()=>{
  const word=wordmark('BENJAIRE'),badge=signTexture(t.identity,t.name);
  const mat=(map:THREE.Texture,glow:number)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:glow,transparent:true,alphaTest:.3,roughness:.4}));
  const worker=t.agents+t.automations>0?mat(signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'),.55):null;
  return {word,wordMat:mat(word,.45),badge:mat(badge,.5),worker};
 },[t.identity,t.name,t.agents,t.automations]);
 useEffect(()=>()=>{signs.word.dispose();signs.wordMat.dispose();signs.badge.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const d=geo.details,steps:Inst[]=[],posts:Inst[]=[],tops:Inst[]=[],shrubs:Inst[]=[];
  for(const s of d.stair)steps.push({p:[t.x+s.x,base+s.y,t.z+s.z],s:[s.w,.05*k,.07*k],r:.5,c:'#ece9e2'});
  for(const u of d.umbrellas){posts.push({p:[t.x+u.x,base+u.y,t.z+u.z],s:[.012*k,.13*k,.012*k],c:'#8a8f93'});tops.push({p:[t.x+u.x,base+u.y+.12*k,t.z+u.z],s:[.15*k,.05*k,.15*k]});}
  // Lush planting along the terrace edges, a few on each level.
  for(let l=0;l<RIBBON.podium.levels;l++){const ring=podiumRing(l,k),y=base+(l+1)*RIBBON.podium.floor*k;for(let i=l;i<ring.length;i+=7){const [x,z]=ring[i];shrubs.push({p:[t.x+x*.94,y+.045*k,t.z+z*.94],s:[.05*k,.04*k,.05*k],c:i%2?'#5f8f4a':'#77a35a'});}}
  return {steps,posts,tops,shrubs};
 },[geo,t.x,t.z,base,k]);
 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);
 const front=podiumRing(0,k).reduce((z,[,pz])=>Math.max(z,pz),0);
 return <group>
  <group position={[t.x,base,t.z]}>
   <mesh geometry={geo.glass} material={mats.glass} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.ribbonsEven} material={mats.ribbon} castShadow={quality<2} receiveShadow raycast={noRaycast}/>
   {quality<3&&<mesh geometry={geo.ribbonsOdd} material={mats.ribbon} castShadow={quality<2} receiveShadow raycast={noRaycast}/>}
   <mesh geometry={geo.crown} material={mats.ribbon} castShadow receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.garden} material={m.lawn} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.slabs} material={mats.white} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.podiumGlass} material={mats.pglass} receiveShadow {...handlers}/>
   <mesh geometry={geo.planters} material={m.lawn} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.skylight} material={mats.sky} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.wordMat} position={[-.12*k,RIBBON.podium.floor*k*.5,front*.94+.01*k]} scale={[.62*k,.116*k,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.badge} position={[-.52*k,RIBBON.podium.floor*k*.5,front*.92+.01*k]} scale={[.13*k,.13*k,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[.3*k,RIBBON.podium.floor*k*.5,front*.94+.012*k]} scale={[.12*k,.12*k,1]} raycast={noRaycast}/>}
  </group>
  <Instanced items={parts.steps} geometry={g.box} material={m.plain}/>
  <Instanced items={parts.posts} geometry={g.cyl} material={m.plain}/>
  <Instanced items={parts.tops} geometry={g.cone} material={mats.umbrella}/>
  <Instanced items={parts.shrubs} geometry={g.blob} material={m.foliage}/>
 </group>;
}
