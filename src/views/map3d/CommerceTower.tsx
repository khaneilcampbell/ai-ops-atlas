import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {COMMERCE,commerceFront,commerceTop} from './commerceTowerPlan';
import {commerceGeometry} from './commerceTowerGeometry';
import {glassTexture} from './atlasHqTextures';
import {useQualityLevel} from '../../lib/governor';

const noRaycast=()=>null;

/** The lobby wordmark: plain warm letters, no reference signage. */
function wordmark(text:string){
 const c=document.createElement('canvas');c.width=1024;c.height=192;const g=c.getContext('2d')!;
 g.fillStyle='#f4e2b8';g.textAlign='center';g.textBaseline='middle';g.font='600 118px -apple-system, "Helvetica Neue", Arial, sans-serif';
 (g as CanvasRenderingContext2D&{letterSpacing?:string}).letterSpacing='16px';g.shadowColor='rgba(0,0,0,.3)';g.shadowBlur=6;g.fillText(text,512,100,1000);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

/**
 * Commerce Pipeline as the teardrop tower. Static merged meshes and two instanced sets (olive
 * trees), no lights and no per-frame work. The lightest quality level drops the fins; night
 * lights the curtain wall cool and the gold ribbon and lobby warm.
 */
export function CommerceTower({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const k=t.size/COMMERCE.refSize,quality=useQualityLevel();
 const height=commerceTop(k,t.customHeight);
 const geo=useMemo(()=>commerceGeometry(k,height),[k,height]);
 useEffect(()=>()=>{for(const v of Object.values(geo))if(v instanceof THREE.BufferGeometry)v.dispose();},[geo]);
 const mats=useMemo(()=>{
  const silver=glassTexture('#7f9fb8','#d4e2ec','#56718a',73),gold=glassTexture('#d7b06c','#f7e6bd','#b98d4f',89);
  const glass=(tex:{map:THREE.Texture;glow:THREE.Texture},emissive:string)=>focusable(new THREE.MeshStandardMaterial({map:tex.map,emissiveMap:tex.glow,emissive,emissiveIntensity:0,roughness:.18,metalness:.25}));
  return {
   textures:[silver.map,silver.glow,gold.map,gold.glow],
   glass:glass(silver,'#dbe7ff'),gold:glass(gold,'#ffc978'),
   fin:focusable(new THREE.MeshStandardMaterial({color:'#e6ebee',roughness:.35,metalness:.5,side:THREE.DoubleSide})),
   roof:focusable(new THREE.MeshStandardMaterial({color:'#8f989c',roughness:.85})),
   white:focusable(new THREE.MeshStandardMaterial({color:'#f2f3f1',roughness:.45,metalness:.2})),
   rail:focusable(new THREE.MeshStandardMaterial({color:'#cfe3ec',roughness:.1,metalness:.2,transparent:true,opacity:.45,depthWrite:false})),
   canopy:focusable(new THREE.MeshStandardMaterial({color:'#f6f7f6',roughness:.3,metalness:.35,emissive:'#ffe2a8',emissiveIntensity:0})),
   pool:focusable(new THREE.MeshStandardMaterial({color:'#5fb3cc',roughness:.1,metalness:.1,emissive:'#3b84a0',emissiveIntensity:0})),
  };
 },[]);
 useEffect(()=>{
  mats.glass.emissiveIntensity=night?.7:0;mats.gold.emissiveIntensity=night?1.15:0;
  mats.canopy.emissiveIntensity=night?.3:0;mats.pool.emissiveIntensity=night?.65:0;
 },[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);
 const signs=useMemo(()=>{
  const word=wordmark('COMMERCE'),badge=signTexture(t.identity,t.name);
  const mat=(map:THREE.Texture,glow:number)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:glow,transparent:true,alphaTest:.3,roughness:.4}));
  // Same "Project workers" badge the other headquarters carry when agents or automations work there.
  const worker=t.agents+t.automations>0?mat(signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'),.55):null;
  return {word,wordMat:mat(word,.6),badge:mat(badge,.5),worker};
 },[t.identity,t.name,t.agents,t.automations]);
 useEffect(()=>()=>{signs.word.dispose();signs.wordMat.dispose();signs.badge.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const trunks:Inst[]=[],crowns:Inst[]=[];
  geo.trees.forEach((tr,i)=>{
   trunks.push({p:[t.x+tr.x,base+tr.y,t.z+tr.z],s:[.025*k,.13*k,.025*k],c:'#6d5a45'});
   crowns.push({p:[t.x+tr.x,base+tr.y+.18*k,t.z+tr.z],s:[.09*k,.065*k,.085*k],r:i,c:i%2?'#7f9471':'#8fa37f'});
  });
  return {trunks,crowns};
 },[geo,t.x,t.z,base,k]);
 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);
 const front=commerceFront(k),signY=(COMMERCE.canopy.y+.06)*k-.02*k;
 const finsOn=quality<3;
 return <group>
  <group position={[t.x,base,t.z]}>
   <mesh geometry={geo.glass} material={mats.glass} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.gold} material={mats.gold} castShadow receiveShadow {...handlers}/>
   {finsOn&&<mesh geometry={geo.fins} material={mats.fin} castShadow={quality<2} raycast={noRaycast}/>}
   <mesh geometry={geo.roof} material={mats.roof} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.bands} material={mats.fin} raycast={noRaycast}/>
   <mesh geometry={geo.lobby} material={mats.gold} receiveShadow {...handlers}/>
   <mesh geometry={geo.podiumGlass} material={mats.glass} receiveShadow {...handlers}/>
   <mesh geometry={geo.slabs} material={mats.white} castShadow receiveShadow {...handlers}/>
   {finsOn&&<mesh geometry={geo.ribs} material={mats.fin} raycast={noRaycast}/>}
   <mesh geometry={geo.lawn} material={m.lawn} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.pool} material={mats.pool} raycast={noRaycast}/>
   <mesh geometry={geo.canopy} material={mats.canopy} castShadow receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.rail} material={mats.rail} raycast={noRaycast}/>
   {/* The wordmark sits on the canopy's front edge, with the badge and workers sign either side. */}
   <mesh geometry={g.plane} material={signs.wordMat} position={[front.x,signY,front.z]} scale={[.9*k,.9/(1024/192)*k,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.badge} position={[front.x-.5*k,.26*k,front.wall-.1*k]} scale={[.17*k,.17*k,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[front.x+.5*k,.26*k,front.wall-.1*k]} scale={[.17*k,.17*k,1]} raycast={noRaycast}/>}
  </group>
  <Instanced items={parts.trunks} geometry={g.cyl} material={m.plain}/>
  <Instanced items={parts.crowns} geometry={g.blob} material={m.foliage}/>
 </group>;
}

