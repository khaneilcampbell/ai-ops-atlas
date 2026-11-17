import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {HQ} from './atlasHqPlan';
import {HQ_PALETTE as P} from './atlasHqPalette';
import {ccFacadeTexture,ccLobbyTexture,ccNameplate} from './commandCenterTextures';
import {packNormals} from './packGeometry';
import {CC,ccBay,ccEntrance,ccRoofGarden,type CcBox} from './commandCenterPlan';
import {ccGeometry} from './commandCenterGeometry';

const noRaycast=()=>null;

/**
 * Atlas Command Center (Khaneil, 2026-11-17, after his concept image): the lobby and four office
 * floors you enter, as a cream stone block with a grid of slabs and piers framing warm-lit,
 * green-framed windows, a stone entrance bay with the gold Atlas mark and name, a gold-lit lobby
 * under a brass canopy and planters round the roof.
 * Static merged meshes plus a few instanced sets: about a dozen draw calls and no lights of its
 * own. Night lights the windows the way the other buildings light theirs.
 */
export function AtlasHq({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const k=t.size/HQ.refSize;
 const geo=useMemo(()=>packNormals(ccGeometry(k)),[k]);
 useEffect(()=>()=>{for(const v of Object.values(geo))if(v instanceof THREE.BufferGeometry)v.dispose();},[geo]);
 const mats=useMemo(()=>{
  const face=ccFacadeTexture(),warm=ccLobbyTexture();
  return {
   textures:[face.map,face.glow,warm.map,warm.glow],
   // Stone and window in one texture: matte enough for the stone, the offices glowing warm even by day.
   glass:focusable(new THREE.MeshStandardMaterial({map:face.map,emissiveMap:face.glow,emissive:P.towerGlow,emissiveIntensity:.3,roughness:.6,metalness:.05})),
   lobby:focusable(new THREE.MeshStandardMaterial({map:warm.map,emissiveMap:warm.glow,emissive:P.wingGlow,emissiveIntensity:.55,roughness:.35,metalness:.1})),
   // Honed stone: rough and not metallic, so it reads cream in daylight.
   stone:focusable(new THREE.MeshStandardMaterial({color:P.stone,roughness:.78,metalness:0})),
   brass:focusable(new THREE.MeshStandardMaterial({color:P.brass,roughness:.36,metalness:.65})),
   roof:focusable(new THREE.MeshStandardMaterial({color:P.stoneShade,roughness:.9})),
  };
 },[]);
 useEffect(()=>{mats.glass.emissiveIntensity=night?1:.3;mats.lobby.emissiveIntensity=night?1.4:.55;},[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);

 const signs=useMemo(()=>{
  const name=ccNameplate();
  const mat=(map:THREE.Texture,glow:number)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:glow,transparent:true,alphaTest:.3,roughness:.4}));
  // Same "Project workers" badge the other headquarters carry when agents or automations work there.
  const worker=t.agents+t.automations>0?mat(signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'),.55):null;
  return {name,nameMat:mat(name,.12),worker};
 },[t.agents,t.automations]);
 useEffect(()=>()=>{signs.name.dispose();signs.nameMat.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const place=([x,y,z,w,h,d,c]:CcBox):Inst=>({p:[t.x+x,base+y,t.z+z],s:[w,h,d],c});
  const door=ccEntrance(k),garden=ccRoofGarden(k);
  const trunks:Inst[]=[],crowns:Inst[]=[];
  geo.trees.forEach((tr,i)=>{
   trunks.push({p:[t.x+tr.x,base+tr.y,t.z+tr.z],s:[.025*k,.12*k,.025*k],c:'#6d5a45'});
   crowns.push({p:[t.x+tr.x,base+tr.y+.17*k,t.z+tr.z],s:[.09*k,.065*k,.085*k],r:i,c:i%2?'#7f9471':'#8fa37f'});
  });
  // Round shrubs in the roof planters, showing over the parapet.
  geo.shrubs.forEach((sh,i)=>crowns.push({p:[t.x+sh.x,base+sh.y,t.z+sh.z],s:[.06*k,.045*k,.06*k],r:i+3,c:i%3?'#5f8a55':'#6f9a62'}));
  return {door:[...door.boxes,...garden.hedges].map(place),lamps:door.lamps.map(place),trunks,crowns};
 },[geo,t.x,t.z,base,k]);

 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);

 // The gold mark and name fill the stone bay's face, above the brass canopy.
 const bay=ccBay(k),face=bay.front+.004*k;
 return <group>
  <group position={[t.x,base,t.z]}>
   <mesh geometry={geo.glass} material={mats.glass} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.lobby} material={mats.lobby} receiveShadow {...handlers}/>
   <mesh geometry={geo.stone} material={mats.stone} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.brass} material={mats.brass} raycast={noRaycast}/>
   <mesh geometry={geo.roof} material={mats.roof} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.lawn} material={m.lawn} receiveShadow raycast={noRaycast}/>
   <mesh geometry={g.plane} material={signs.nameMat} position={[0,(CC.lobby+3.1*CC.storey)*k,face]} scale={[.4*k,.5*k,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[.55*k,.4*k,(CC.cz+CC.b)*k+.03*k]} scale={[.16*k,.16*k,1]} raycast={noRaycast}/>}
  </group>
  <Instanced items={parts.door} geometry={g.box} material={m.plain}/>
  <Instanced items={parts.lamps} geometry={g.box} material={night?m.lamp:m.plain} shadow={false}/>
  <Instanced items={parts.trunks} geometry={g.cyl} material={m.plain}/>
  <Instanced items={parts.crowns} geometry={g.blob} material={m.foliage}/>
 </group>;
}
