import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import {LAND_BOTTOM,LAND_TOP,TERRACE_H,WATER_Y} from './scene';
import {CAMPUS_KEY,type CreativeCampusPlan} from './creativeCampusPlan';
import {campusGeometry} from './creativeCampusGeometry';
import {packNormals} from './packGeometry';

/** Banded glass behind the fins: floor slabs every storey, mullions, and a warm lit interior at night. */
function bandTextures(storey:number){
 const make=(night:boolean)=>{
  const c=document.createElement('canvas');c.width=64;c.height=128;const g=c.getContext('2d')!;
  if(night){g.fillStyle='#ffd7a0';g.fillRect(0,0,64,128);g.fillStyle='rgba(0,0,0,.9)';g.fillRect(0,0,64,14);g.fillStyle='rgba(0,0,0,.6)';for(let x=0;x<64;x+=32)g.fillRect(x,0,3,128);}
  else{const k=g.createLinearGradient(0,0,0,128);k.addColorStop(0,'#5f6f78');k.addColorStop(1,'#3c4850');g.fillStyle=k;g.fillRect(0,0,64,128);g.fillStyle='#e9e6df';g.fillRect(0,0,64,12);g.fillStyle='rgba(255,255,255,.18)';g.fillRect(36,14,10,114);g.fillStyle='#2c3439';for(let x=0;x<64;x+=32)g.fillRect(x,12,2,116);}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/.5,1/storey);t.anisotropy=4;return t;
 };
 return {map:make(false),glow:make(true)};
}
/** Dark red glass with a white-edged mullion grid, as on the reference's leaning end blocks. */
function redTextures(){
 const make=(night:boolean)=>{
  const c=document.createElement('canvas');c.width=128;c.height=128;const g=c.getContext('2d')!;
  if(night){g.fillStyle='#ff9b7a';g.fillRect(0,0,128,128);g.fillStyle='rgba(0,0,0,.75)';for(let x=0;x<128;x+=32)g.fillRect(x,0,4,128);for(let y=0;y<128;y+=42)g.fillRect(0,y,128,4);}
  else{const k=g.createLinearGradient(0,0,128,128);k.addColorStop(0,'#9c3a36');k.addColorStop(.55,'#7a2626');k.addColorStop(1,'#5a1a1c');g.fillStyle=k;g.fillRect(0,0,128,128);
   g.fillStyle='rgba(255,220,210,.16)';g.beginPath();g.moveTo(10,128);g.lineTo(40,0);g.lineTo(58,0);g.lineTo(28,128);g.closePath();g.fill();
   g.fillStyle='#4a1618';for(let x=0;x<128;x+=32)g.fillRect(x,0,3,128);for(let y=0;y<128;y+=42)g.fillRect(0,y,128,3);}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/1.1,1/1.2);t.anisotropy=4;return t;
 };
 return {map:make(false),glow:make(true)};
}

const noRaycast=()=>null;
const slab=(r:{x:number;z:number;w:number;d:number},y0:number,y1:number):Inst=>({p:[r.x+r.w/2,y0,r.z+r.d/2],s:[r.w,y1-y0,r.d]});
const grow=(r:{x:number;z:number;w:number;d:number},k:number)=>({x:r.x-k,z:r.z-k,w:r.w+2*k,d:r.d+2*k});

/**
 * Atlas Creative Campus and its island (creativeCampusPlan.ts). The island's land, beach and surf use
 * the city's own terrain materials and instance pools; the building and grounds are seven merged meshes
 * with no lights of their own. Night only raises emissive maps.
 */
export function CreativeCampus({plan:p,g,m,pick,night=false,building=true}:{plan?:CreativeCampusPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean;
 /** False draws only the island and its grounds, for the interior's view out. */
 building?:boolean}){
 const land=useMemo(()=>({
  land:(p?.land??[]).map(r=>slab(r,LAND_BOTTOM,LAND_TOP)),
  sand:(p?.land??[]).map(r=>slab(grow(r,.42),LAND_BOTTOM,WATER_Y+.07)),
  foam:(p?.land??[]).map(r=>slab(grow(r,.72),WATER_Y-.02,WATER_Y+.006)),
 }),[p]);
 const geo=useMemo(()=>p?packNormals(campusGeometry(p,TERRACE_H)):undefined,[p]);
 useEffect(()=>()=>{if(geo)for(const k of ['white','inner','red','ribbon','atrium','ground','trim','ribbonOutside'] as const)geo[k].dispose();},[geo]);
 const mats=useMemo(()=>{
  const band=bandTextures(.56),red=redTextures();
  return {
   textures:[band.map,band.glow,red.map,red.glow],
   white:new THREE.MeshStandardMaterial({color:'#f4f3ef',roughness:.55,metalness:.02,side:THREE.DoubleSide}),
   inner:new THREE.MeshStandardMaterial({map:band.map,emissiveMap:band.glow,emissive:'#ffcf96',emissiveIntensity:0,roughness:.25,metalness:.3}),
   red:new THREE.MeshStandardMaterial({map:red.map,emissiveMap:red.glow,emissive:'#ff8a66',emissiveIntensity:.03,roughness:.18,metalness:.35,side:THREE.DoubleSide}),
   ribbon:new THREE.MeshStandardMaterial({color:'#b52a2c',roughness:.45,metalness:.05,emissive:'#ff5a4a',emissiveIntensity:0}),
   atrium:new THREE.MeshStandardMaterial({color:'#a8c4cc',roughness:.08,metalness:.4,emissive:'#ffd9a8',emissiveIntensity:0,transparent:true,opacity:.72,side:THREE.DoubleSide}),
   ground:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0}),
  };
 },[]);
 useEffect(()=>{
  mats.inner.emissiveIntensity=night?.9:0;mats.red.emissiveIntensity=night?.38:.03;mats.ribbon.emissiveIntensity=night?.18:0;mats.atrium.emissiveIntensity=night?.8:0;
 },[mats,night]);
 useEffect(()=>()=>{for(const k of ['white','inner','red','ribbon','atrium','ground'] as const)mats[k].dispose();for(const t of mats.textures)t.dispose();},[mats]);
 if(!p||!geo)return null;
 const click={onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(CAMPUS_KEY,e);},onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(CAMPUS_KEY,e);},onPointerOut:()=>pick.out()};
 return <group name="atlas-creative-campus">
  <Instanced items={land.foam} geometry={g.box} material={m.surf} shadow={false}/>
  <Instanced items={land.sand} geometry={g.box} material={m.sand} shadow={false}/>
  <Instanced items={land.land} geometry={g.box} material={m.land}/>
  <mesh geometry={geo.ground} material={mats.ground} receiveShadow raycast={noRaycast}/>
  {building&&<>
   <mesh geometry={geo.white} material={mats.white} castShadow receiveShadow {...click}/>
   <mesh geometry={geo.inner} material={mats.inner} {...click}/>
   <mesh geometry={geo.red} material={mats.red} castShadow {...click}/>
   <mesh geometry={geo.atrium} material={mats.atrium} {...click}/>
   <mesh geometry={geo.trim} material={mats.ribbon} castShadow {...click}/>
  </>}
  <mesh geometry={building?geo.ribbon:geo.ribbonOutside} material={mats.ribbon} castShadow receiveShadow {...click}/>
 </group>;
}
