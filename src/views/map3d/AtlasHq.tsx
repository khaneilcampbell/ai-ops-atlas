import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {HQ} from './atlasHqPlan';
import {glassTexture} from './atlasHqTextures';
import {HQ_PALETTE as P} from './atlasHqPalette';
import {packNormals} from './packGeometry';
import {CC,ccBay,ccEntrance,ccRoofGarden,ccTop,type CcBox} from './commandCenterPlan';
import {ccGeometry} from './commandCenterGeometry';

const noRaycast=()=>null;

/** "Atlas / Command Center" in two lines, dark green on the cream stone bay. */
function nameplate(){
 const c=document.createElement('canvas');c.width=512;c.height=256;const g=c.getContext('2d')!;
 g.fillStyle='#23463a';g.textAlign='center';g.textBaseline='middle';
 g.font='600 96px Georgia, "Times New Roman", serif';g.fillText('Atlas',256,78,480);
 g.font='600 64px Georgia, "Times New Roman", serif';g.fillText('Command Center',256,182,490);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

/**
 * Atlas Command Center (Khaneil, 2026-11-17): the lobby and four office floors you enter, as a
 * cream stone and green glass block with a stone entrance bay, a brass canopy and a planted roof.
 * Static merged meshes plus a few instanced sets: about a dozen draw calls and no lights of its
 * own. Night lights the windows the way the other buildings light theirs.
 */
export function AtlasHq({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const k=t.size/HQ.refSize;
 const geo=useMemo(()=>packNormals(ccGeometry(k)),[k]);
 useEffect(()=>()=>{for(const v of Object.values(geo))if(v instanceof THREE.BufferGeometry)v.dispose();},[geo]);
 const mats=useMemo(()=>{
  const green=glassTexture(...P.towerGlass,11,P.mullion),warm=glassTexture('#e9dcb8','#fbf2dc','#d9ccb0',29,P.mullion);
  return {
   textures:[green.map,green.glow,warm.map,warm.glow],
   glass:focusable(new THREE.MeshStandardMaterial({map:green.map,emissiveMap:green.glow,emissive:P.towerGlow,emissiveIntensity:0,roughness:.2,metalness:.18})),
   lobby:focusable(new THREE.MeshStandardMaterial({map:warm.map,color:'#fff8e8',emissive:P.wingGlow,emissiveIntensity:.25,roughness:.2,metalness:.1})),
   // Honed stone: rough and not metallic, so it reads cream in daylight.
   stone:focusable(new THREE.MeshStandardMaterial({color:P.stone,roughness:.78,metalness:0})),
   brass:focusable(new THREE.MeshStandardMaterial({color:P.brass,roughness:.36,metalness:.65})),
   roof:focusable(new THREE.MeshStandardMaterial({color:P.stoneShade,roughness:.9})),
  };
 },[]);
 useEffect(()=>{mats.glass.emissiveIntensity=night?.85:0;mats.lobby.emissiveIntensity=night?1.3:.25;},[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);

 const signs=useMemo(()=>{
  const name=nameplate();
  const mat=(map:THREE.Texture,glow:number)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:glow,transparent:true,alphaTest:.3,roughness:.4}));
  // Same "Project workers" badge the other headquarters carry when agents or automations work there.
  const worker=t.agents+t.automations>0?mat(signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'),.55):null;
  return {name,badge:mat(signTexture(t.identity,t.name),.55),nameMat:mat(name,.15),worker};
 },[t.identity,t.name,t.agents,t.automations]);
 useEffect(()=>()=>{signs.name.dispose();signs.badge.dispose();signs.nameMat.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const place=([x,y,z,w,h,d,c]:CcBox):Inst=>({p:[t.x+x,base+y,t.z+z],s:[w,h,d],c});
  const door=ccEntrance(k),garden=ccRoofGarden(k);
  const trunks:Inst[]=[],crowns:Inst[]=[];
  geo.trees.forEach((tr,i)=>{
   trunks.push({p:[t.x+tr.x,base+tr.y,t.z+tr.z],s:[.025*k,.12*k,.025*k],c:'#6d5a45'});
   crowns.push({p:[t.x+tr.x,base+tr.y+.17*k,t.z+tr.z],s:[.09*k,.065*k,.085*k],r:i,c:i%2?'#7f9471':'#8fa37f'});
  });
  return {door:[...door.boxes,...garden.hedges].map(place),lamps:door.lamps.map(place),trunks,crowns};
 },[geo,t.x,t.z,base,k]);

 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);

 // The name and badge sit on the stone bay's face, above the brass canopy.
 const bay=ccBay(k),face=bay.front+.004*k,top=ccTop(k);
 return <group>
  <group position={[t.x,base,t.z]}>
   <mesh geometry={geo.glass} material={mats.glass} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.lobby} material={mats.lobby} receiveShadow {...handlers}/>
   <mesh geometry={geo.stone} material={mats.stone} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.brass} material={mats.brass} raycast={noRaycast}/>
   <mesh geometry={geo.roof} material={mats.roof} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.lawn} material={m.lawn} receiveShadow raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.badge} position={[0,top-.17*k,face]} scale={[.13*k,.13*k,1]} raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.nameMat} position={[0,(CC.lobby+2.1*CC.storey)*k,face]} scale={[.36*k,.18*k,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[.55*k,.4*k,(CC.cz+CC.b)*k+.03*k]} scale={[.16*k,.16*k,1]} raycast={noRaycast}/>}
  </group>
  <Instanced items={parts.door} geometry={g.box} material={m.plain}/>
  <Instanced items={parts.lamps} geometry={g.box} material={night?m.lamp:m.plain} shadow={false}/>
  <Instanced items={parts.trunks} geometry={g.cyl} material={m.plain}/>
  <Instanced items={parts.crowns} geometry={g.blob} material={m.foliage}/>
 </group>;
}
