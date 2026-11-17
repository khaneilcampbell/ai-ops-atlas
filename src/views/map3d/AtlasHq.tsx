import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {HQ,HQ_COLORS as C,entrance,hqTop,plateScale,storey} from './atlasHqPlan';
import {hqGeometry} from './atlasHqGeometry';
import {useQualityLevel} from '../../lib/governor';
import {glassTexture} from './atlasHqTextures';
import {packNormals} from './packGeometry';

const noRaycast=()=>null;

/** A wordmark on clear glass, like lettering fixed to the facade or the canopy fascia. */
function wordmark(text:string,color:string){
 const c=document.createElement('canvas');c.width=1024;c.height=256;const g=c.getContext('2d')!;
 g.fillStyle=color;g.textAlign='center';g.textBaseline='middle';g.font='600 150px -apple-system, "Helvetica Neue", Arial, sans-serif';
 g.shadowColor='rgba(0,0,0,.25)';g.shadowBlur=8;g.fillText(text,512,136,980);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

/**
 * Atlas Command Center, the map's centerpiece: a corporate headquarters with a lobby and four
 * office floors, built from its interior's floor plate (Khaneil, 2026-11-17). All static merged
 * meshes plus a few instanced trees: under a dozen draw calls, no lights of its own. Night lights
 * the office windows the way the other towers do.
 */
export function AtlasHq({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const k=t.size/HQ.refSize;
 const quality=useQualityLevel();
 const geo=useMemo(()=>packNormals(hqGeometry(k)),[k]);
 useEffect(()=>()=>{for(const v of Object.values(geo))if(v instanceof THREE.BufferGeometry)v.dispose();},[geo]);
 const mats=useMemo(()=>{
  // Office glass: a forest-green spandrel under every floor slab; lobby glass: a brass band at its head.
  const office=glassTexture('#6f97a6','#d3e6ea',C.green,11),lobby=glassTexture('#a9c7cf','#eef5f4',C.brass,29);
  const glass=(tex:{map:THREE.Texture;glow:THREE.Texture},emissive:string)=>focusable(new THREE.MeshStandardMaterial({map:tex.map,emissiveMap:tex.glow,emissive,emissiveIntensity:0,roughness:.2,metalness:.18}));
  const plain=(color:string,roughness:number,metalness:number)=>focusable(new THREE.MeshStandardMaterial({color,roughness,metalness}));
  return {
   textures:[office.map,office.glow,lobby.map,lobby.glow],
   glass:glass(office,'#ffe6bf'),lobby:glass(lobby,'#ffd99a'),
   stone:plain(C.stone,.75,.05),green:plain(C.green,.55,.2),brass:plain(C.brass,.35,.7),roof:plain('#9aa3a6',.8,0),
  };
 },[]);
 useEffect(()=>{mats.glass.emissiveIntensity=night?.8:0;mats.lobby.emissiveIntensity=night?1.3:.15;},[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);

 const signs=useMemo(()=>{
  const badge=signTexture(t.identity,t.name),top=wordmark('ATLAS','#f6f8f8'),door=wordmark('ATLAS','#e8cf98');
  const mat=(map:THREE.Texture,glow:number)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:glow,transparent:true,alphaTest:.3,roughness:.4}));
  // Same "Project workers" badge the other headquarters carry when agents or automations work there.
  const worker=t.agents+t.automations>0?mat(signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'),.55):null;
  return {top,door,badge:mat(badge,.55),topMat:mat(top,.9),doorMat:mat(door,.7),worker};
 },[t.identity,t.name,t.agents,t.automations]);
 useEffect(()=>()=>{signs.top.dispose();signs.door.dispose();signs.badge.dispose();signs.topMat.dispose();signs.doorMat.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const trunks:Inst[]=[],crowns:Inst[]=[];
  geo.trees.forEach((tr,i)=>{
   trunks.push({p:[t.x+tr.x,base,t.z+tr.z],s:[.025*k,.16*k,.025*k],c:'#6d5a45'});
   crowns.push({p:[t.x+tr.x,base+.2*k,t.z+tr.z],s:[.08*k,.1*k,.08*k],r:i,c:i%2?'#5f7f58':'#6d8c62'});
  });
  return {trunks,crowns};
 },[geo,t.x,t.z,base,k]);

 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);

 const E=entrance(k),front=HQ.plate.b*plateScale(k),h=storey(k),w=HQ.plate.a*plateScale(k);
 // The name sits on the top floor's front, the entrance mark on the canopy fascia.
 const topY=hqTop(k)-h*.55;
 return <group>
  <group position={[t.x,base,t.z]}>
   <mesh geometry={geo.glass} material={mats.glass} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.lobby} material={mats.lobby} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.stone} material={mats.stone} castShadow receiveShadow {...handlers}/>
   {quality<3&&<mesh geometry={geo.panels} material={mats.green} castShadow={quality<2} raycast={noRaycast}/>}
   <mesh geometry={geo.brass} material={mats.brass} raycast={noRaycast}/>
   <mesh geometry={geo.roof} material={mats.roof} receiveShadow raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.badge} position={[-w*.62,topY,front+.03*k]} scale={[h*.62,h*.62,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.topMat} position={[w*.12,topY,front+.03*k]} scale={[w*1.2,w*.3,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.doorMat} position={[0,E.y+E.t+E.w*.1,E.z1-.01*k]} scale={[E.w*.9,E.w*.22,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[w*.62,h*.55,front+.03*k]} scale={[h*.5,h*.5,1]} raycast={noRaycast}/>}
  </group>
  <Instanced items={parts.trunks} geometry={g.cyl} material={m.plain}/>
  <Instanced items={parts.crowns} geometry={g.blob} material={m.foliage}/>
 </group>;
}
