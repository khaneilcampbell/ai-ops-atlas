import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type PickHandlerSet,type useGeometries} from './models';
import type {Kiosk} from './scene';
import {focusable} from './materials';
import {glassTexture} from './atlasHqTextures';
import {toolSignTexture} from './toolBrand';
import {ANNEX,annexFront,annexShape} from './commerceAnnexPlan';
import {annexGeometry} from './commerceAnnexGeometry';
import {useQualityLevel} from '../../lib/governor';

const noRaycast=()=>null;

type Mats=ReturnType<typeof annexMaterials>;
function annexMaterials(){
 // The same silver and gold glass as Commerce Pipeline, so the family reads as one.
 const silver=glassTexture('#7f9fb8','#d4e2ec','#56718a',73),gold=glassTexture('#d7b06c','#f7e6bd','#b98d4f',89);
 const glass=(tex:{map:THREE.Texture;glow:THREE.Texture},emissive:string)=>focusable(new THREE.MeshStandardMaterial({map:tex.map,emissiveMap:tex.glow,emissive,emissiveIntensity:0,roughness:.18,metalness:.25}));
 return {
  textures:[silver.map,silver.glow,gold.map,gold.glow],
  glass:glass(silver,'#dbe7ff'),gold:glass(gold,'#ffc978'),
  fin:focusable(new THREE.MeshStandardMaterial({color:'#e6ebee',roughness:.35,metalness:.5})),
  roof:focusable(new THREE.MeshStandardMaterial({color:'#8f989c',roughness:.85})),
  stone:focusable(new THREE.MeshStandardMaterial({color:'#e4dfd3',roughness:.8})),
 };
}

/**
 * Commerce district tool offices drawn as Commerce Pipeline's smaller siblings. Each is a handful
 * of merged meshes built once, with no lights and no per-frame work; the name sign sits on a
 * white canopy over the door. The lightest quality level drops the fins.
 */
export function CommerceAnnexes({kiosks,tower,base,g,pick,night=false}:{kiosks:Kiosk[];tower?:{x:number;z:number};base:number;g:ReturnType<typeof useGeometries>;pick:PickHandlerSet;night?:boolean}){
 const mats=useMemo(annexMaterials,[]);
 useEffect(()=>{mats.glass.emissiveIntensity=night?.7:0;mats.gold.emissiveIntensity=night?1.15:0;},[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);
 const quality=useQualityLevel();
 const fitted=useMemo(()=>[...kiosks].sort((a,b)=>a.key<b.key?-1:1),[kiosks]);
 const trim=useMemo(()=>{
  const boxes:Inst[]=[];
  fitted.forEach((k,i)=>{
   const shape=annexShape(k,tower,i),f=annexFront(shape),s=shape.k,y=base+ANNEX.lobby*s;
   // Canopy over the door, a gold fascia under it, and the dark glass doors.
   boxes.push({p:[k.x+f.x,y-.02*s,k.z+f.z+.08*s],s:[.46*s,.03*s,.2*s],c:'#f4f5f3'});
   boxes.push({p:[k.x+f.x,y-.05*s,k.z+f.z+.175*s],s:[.46*s,.03*s,.02*s],c:'#c9a35c'});
   boxes.push({p:[k.x+f.x,base,k.z+f.z+.004],s:[.22*s,.26*s,.02],c:'#233e49'});
  });
  return boxes;
 },[fitted,tower,base]);
 return <group>
  {fitted.map((k,i)=><Annex key={k.key} kiosk={k} index={i} tower={tower} base={base} mats={mats} plane={g.plane} pick={pick} finsOn={quality<3} night={night}/>)}
  <Instanced items={trim} geometry={g.box} material={mats.stone}/>
 </group>;
}

function Annex({kiosk:k,index,tower,base,mats,plane,pick,finsOn,night}:{kiosk:Kiosk;index:number;tower?:{x:number;z:number};base:number;mats:Mats;plane:THREE.PlaneGeometry;pick:PickHandlerSet;finsOn:boolean;night:boolean}){
 const shape=useMemo(()=>annexShape(k,tower,index),[k,tower,index]);
 const height=k.height??ANNEX.refSize*5;
 const geo=useMemo(()=>annexGeometry(shape,height),[shape,height]);
 useEffect(()=>()=>{for(const v of Object.values(geo))v.dispose();},[geo]);
 const sign=useMemo(()=>{const map=toolSignTexture(k.name);return {map,mat:focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:.55,roughness:.45}))};},[k.name]);
 useEffect(()=>()=>{sign.map.dispose();sign.mat.dispose();},[sign]);
 useEffect(()=>{sign.mat.emissiveIntensity=night?.8:.55;},[sign,night]);
 const p=pick.of([k.key]);
 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();p.over(k.key,e);},
  onPointerOut:()=>p.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();p.click(k.key,e);},
 }),[p,k.key]);
 const f=annexFront(shape),s=shape.k,signY=base+ANNEX.lobby*s+.06*s;
 return <group>
  <group position={[k.x,base,k.z]}>
   <mesh geometry={geo.glass} material={mats.glass} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.gold} material={mats.gold} castShadow receiveShadow {...handlers}/>
   {finsOn&&<mesh geometry={geo.fins} material={mats.fin} raycast={noRaycast}/>}
   <mesh geometry={geo.roof} material={mats.roof} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.plinth} material={mats.stone} receiveShadow position={[0,-ANNEX.plinthH*s+.001,0]} raycast={noRaycast}/>
  </group>
  <mesh geometry={plane} material={sign.mat} position={[k.x+f.x,signY,k.z+f.z+.186*s]} scale={[.44*s,.165*s,1]} raycast={noRaycast}/>
 </group>;
}
