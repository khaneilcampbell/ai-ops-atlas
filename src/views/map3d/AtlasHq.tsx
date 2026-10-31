import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {HQ,lobby,towerRoof} from './atlasHqPlan';
import {hqGeometry} from './atlasHqGeometry';
import {useQualityLevel} from '../../lib/governor';
import {glassTexture} from './atlasHqTextures';

const noRaycast=()=>null;

/** A white wordmark with the Atlas badge, on clear glass like lettering fixed to the facade. */
function wordmark(text:string,color:string){
 const c=document.createElement('canvas');c.width=1024;c.height=256;const g=c.getContext('2d')!;
 g.fillStyle=color;g.textAlign='center';g.textBaseline='middle';g.font='600 150px -apple-system, "Helvetica Neue", Arial, sans-serif';
 g.shadowColor='rgba(0,0,0,.25)';g.shadowBlur=8;g.fillText(text,512,136,980);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

/**
 * Atlas HQ, the map's centerpiece, after the curving-glass tower design (KC, 2026-10-31). All
 * static merged meshes plus instanced ribs and trees: about a dozen draw calls, no lights of
 * its own. Night raises the glass glow the way the other towers light their windows.
 */
export function AtlasHq({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const k=t.size/HQ.refSize;
 const quality=useQualityLevel();
 const geo=useMemo(()=>hqGeometry(k),[k]);
 useEffect(()=>()=>{for(const v of Object.values(geo))if(v instanceof THREE.BufferGeometry)v.dispose();},[geo]);
 const mats=useMemo(()=>{
  const blue=glassTexture('#5f93bd','#c6deee','#40627f',11),gold=glassTexture('#dcb978','#f8ecc8','#c29c62',29),rib=glassTexture('#86a9c2','#d6e5ee','#5d7b8f',47);
  const glass=(tex:{map:THREE.Texture;glow:THREE.Texture},emissive:string,color='#ffffff')=>focusable(new THREE.MeshStandardMaterial({map:tex.map,emissiveMap:tex.glow,emissive,emissiveIntensity:0,color,roughness:.2,metalness:.18}));
  return {
   textures:[blue.map,blue.glow,gold.map,gold.glow,rib.map,rib.glow],
   blue:glass(blue,'#d6e4ff'),gold:glass(gold,'#ffcf86'),podium:glass(rib,'#ffe2b0'),
   white:focusable(new THREE.MeshStandardMaterial({color:'#eef1f2',roughness:.35,metalness:.4})),
   roof:focusable(new THREE.MeshStandardMaterial({color:'#9aa3a6',roughness:.8})),
   lobby:focusable(new THREE.MeshStandardMaterial({map:gold.map,color:'#fff3d6',emissive:'#ffcf86',emissiveIntensity:.3,roughness:.2,metalness:.1})),
   canopy:focusable(new THREE.MeshStandardMaterial({color:'#f4f6f6',roughness:.3,metalness:.3,emissive:'#ffe2a8',emissiveIntensity:0})),
   pool:focusable(new THREE.MeshStandardMaterial({color:'#6fb7c9',roughness:.12,metalness:.1,emissive:'#3d7f99',emissiveIntensity:0})),
  };
 },[]);
 useEffect(()=>{
  // Cool white in the blue tower, warm in the gold wing, so the two volumes still read apart at night.
  mats.blue.emissiveIntensity=night?.75:0;mats.gold.emissiveIntensity=night?1.05:0;mats.podium.emissiveIntensity=night?.8:0;
  mats.lobby.emissiveIntensity=night?1.4:.3;mats.canopy.emissiveIntensity=night?.25:0;mats.pool.emissiveIntensity=night?.6:0;
 },[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);

 const signs=useMemo(()=>{
  const badge=signTexture(t.identity,t.name),top=wordmark('ATLAS','#f6f8f8'),door=wordmark('ATLAS HQ','#d9b25f');
  const mat=(map:THREE.Texture,glow:number)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:glow,transparent:true,alphaTest:.3,roughness:.4}));
  // Same "Project workers" badge the other headquarters carry when agents or automations work there.
  const worker=t.agents+t.automations>0?mat(signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'),.55):null;
  return {top,door,badge:mat(badge,.55),topMat:mat(top,.9),doorMat:mat(door,.6),worker};
 },[t.identity,t.name,t.agents,t.automations]);
 useEffect(()=>()=>{signs.top.dispose();signs.door.dispose();signs.badge.dispose();signs.topMat.dispose();signs.doorMat.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const ribs:Inst[]=geo.podiumFins.map(f=>({p:[t.x+f.p[0],base,t.z+f.p[2]],s:[.012*k,HQ.podiumLevels*HQ.podiumFloor*k,.022*k],r:f.r,c:'#e9eef0'}));
  const trunks:Inst[]=[],crowns:Inst[]=[];
  geo.trees.forEach((tr,i)=>{
   trunks.push({p:[t.x+tr.x,base+tr.y,t.z+tr.z],s:[.025*k,.14*k,.025*k],c:'#6d5a45'});
   // Olive trees: low, wide, silver-green crowns.
   crowns.push({p:[t.x+tr.x,base+tr.y+.19*k,t.z+tr.z],s:[.095*k,.065*k,.09*k],r:i,c:i%2?'#7f9471':'#8fa37f'});
  });
  return {ribs,trunks,crowns};
 },[geo,t.x,t.z,base,k]);

 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);

 const finsOn=quality<3;
 const L=lobby(k),front=.53*k;
 // Badge and wordmark sit high on the blue tower's front, where the reference carries its name.
 const topY=towerRoof(-.39*k,k)-.42*k;
 return <group>
  <group position={[t.x,base,t.z]}>
   <mesh geometry={geo.towerGlass} material={mats.blue} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.wingGlass} material={mats.gold} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.podiumGlass} material={mats.podium} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.roofs} material={mats.roof} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.bands} material={mats.white} raycast={noRaycast}/>
   {finsOn&&<mesh geometry={geo.fins} material={mats.white} castShadow={quality<2} raycast={noRaycast}/>}
   <mesh geometry={geo.lobby} material={mats.lobby} raycast={noRaycast}/>
   <mesh geometry={geo.canopy} material={mats.canopy} castShadow receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.lawn} material={m.lawn} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.pools} material={mats.pool} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.badge} position={[-.72*k,topY,front-.015*k]} scale={[.19*k,.19*k,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.topMat} position={[-.32*k,topY,front+.02*k]} scale={[.72*k,.18*k,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.doorMat} position={[-.32*k,HQ.canopyY*k+.1*k,L.z+.06*k]} scale={[.7*k,.175*k,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[.52*k,.42*k,.535*k]} scale={[.2*k,.2*k,1]} raycast={noRaycast}/>}
  </group>
  {finsOn&&<Instanced items={parts.ribs} geometry={g.box} material={mats.white}/>}
  <Instanced items={parts.trunks} geometry={g.cyl} material={m.plain}/>
  <Instanced items={parts.crowns} geometry={g.blob} material={m.foliage}/>
 </group>;
}
