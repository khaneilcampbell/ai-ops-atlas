import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type PickHandlerSet,type useGeometries,type useMaterials} from './models';
import {focusable} from './materials';
import {glassTexture} from './atlasHqTextures';
import {packNormals} from './packGeometry';
import {useQualityLevel} from '../../lib/governor';
import {TERRACE_H} from './scene';
import {AIOPS,AIOPS_KEY,PODIUM_H,crownAt,podiumRing,podiumTop,terraceTrees,towerRing,type AiOpsPlan} from './aiOpsCenterPlan';
import {aiOpsGeometry} from './aiOpsCenterGeometry';

const noRaycast=()=>null;

/** The lobby sign: ATLAS over AI OPERATIONS CENTER, bronze on the white podium fascia. */
function signTexture(){
 const c=document.createElement('canvas');c.width=1024;c.height=256;const g=c.getContext('2d')!;
 g.fillStyle='#a8743c';g.textAlign='center';g.textBaseline='middle';
 g.font='600 120px Georgia, "Times New Roman", serif';g.fillText('Atlas',512,92,1000);
 (g as CanvasRenderingContext2D&{letterSpacing?:string}).letterSpacing='14px';
 g.font='500 58px "Helvetica Neue", Arial, sans-serif';g.fillText('AI OPERATIONS CENTER',512,200,1000);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
/** A soft round shadow under the podium, so the building sits on the ground. */
function contactTexture(){
 const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d')!;
 const r=g.createRadialGradient(64,64,10,64,64,64);r.addColorStop(0,'rgba(0,0,0,.55)');r.addColorStop(.6,'rgba(0,0,0,.3)');r.addColorStop(1,'rgba(0,0,0,0)');
 g.fillStyle=r;g.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);
}

/**
 * Atlas AI Operations Center on the map (aiOpsCenterPlan). Merged static meshes plus a few instances,
 * no lights. The lightest quality level drops every other ribbon louvre's shadow; night lights the
 * offices, the lobby and the atrium halo.
 */
export function AiOpsCenter({plan,g,m,pick,night=false}:{plan?:AiOpsPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:PickHandlerSet;night?:boolean}){
 const quality=useQualityLevel(),height=plan?.height??12;
 const geo=useMemo(()=>packNormals(aiOpsGeometry(height)),[height]);
 useEffect(()=>()=>{for(const v of Object.values(geo))if(v instanceof THREE.BufferGeometry)v.dispose();},[geo]);
 const mats=useMemo(()=>{
  const P=AIOPS.palette,tex=glassTexture(P.glassTop,P.glassBottom,P.spandrel,83),sign=signTexture(),shadow=contactTexture();
  const std=(o:THREE.MeshStandardMaterialParameters)=>focusable(new THREE.MeshStandardMaterial(o));
  return {
   textures:[tex.map,tex.glow,sign,shadow],
   glass:std({map:tex.map,emissiveMap:tex.glow,emissive:'#ffd6a0',emissiveIntensity:0,roughness:.12,metalness:.4}),
   fin:std({color:P.mullion,roughness:.5,metalness:.2,side:THREE.DoubleSide}),
   slab:std({color:P.slab,roughness:.6}),
   bronze:std({color:P.bronze,roughness:.42,metalness:.3}),
   bronzeDark:std({color:P.bronzeDark,roughness:.5,metalness:.25}),
   lobby:std({map:tex.map,color:'#d9e6e0',roughness:.1,metalness:.25,emissive:'#ffd59a',emissiveIntensity:.32}),
   vestibule:focusable(new THREE.MeshStandardMaterial({color:'#d6eae6',roughness:.04,metalness:.3,transparent:true,opacity:.3,depthWrite:false,emissive:'#ffd9a0',emissiveIntensity:.2})),
   doors:std({color:'#2c3b38',roughness:.3,metalness:.5}),
   podium:std({map:tex.map,emissiveMap:tex.glow,emissive:'#ffd6a0',emissiveIntensity:0,roughness:.15,metalness:.35}),
   drum:focusable(new THREE.MeshStandardMaterial({color:'#cfe2dc',roughness:.05,metalness:.3,transparent:true,opacity:.5,depthWrite:false,side:THREE.DoubleSide,emissive:'#ffd9a0',emissiveIntensity:.08})),
   sky:std({color:'#9cc3cf',roughness:.05,metalness:.5,emissive:'#d5efff',emissiveIntensity:0}),
   halo:std({color:'#f3d18f',emissive:'#ffcf7a',emissiveIntensity:.6,roughness:.3}),
   roof:std({color:'#d8d6cf',roughness:.8}),
   sign:focusable(new THREE.MeshStandardMaterial({map:sign,transparent:true,alphaTest:.3,roughness:.4,emissiveMap:sign,emissive:'#ffffff',emissiveIntensity:0})),
   shadow:new THREE.MeshBasicMaterial({map:shadow,transparent:true,depthWrite:false,opacity:.55,polygonOffset:true,polygonOffsetFactor:-2}),
   paving:std({color:'#e4ddcf',roughness:.85,polygonOffset:true,polygonOffsetFactor:-3}),
  };
 },[]);
 useEffect(()=>{mats.glass.emissiveIntensity=night?.95:0;mats.podium.emissiveIntensity=night?.7:0;mats.lobby.emissiveIntensity=night?.9:.32;mats.drum.emissiveIntensity=night?.5:.08;mats.vestibule.emissiveIntensity=night?.9:.2;mats.sky.emissiveIntensity=night?.5:0;mats.halo.emissiveIntensity=night?1.6:.6;mats.sign.emissiveIntensity=night?.45:0;},[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const t of mats.textures)t.dispose();},[mats]);
 const handlers=useMemo(()=>{const p=pick.of([AIOPS_KEY]);return {
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();p.over(AIOPS_KEY,e);},
  onPointerOut:()=>p.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();p.click(AIOPS_KEY,e);},
 };},[pick]);
 const parts=useMemo(()=>{
  if(!plan)return {trunks:[] as Inst[],crowns:[] as Inst[],shrubs:[] as Inst[],boxes:[] as Inst[]};
  const base=TERRACE_H,trunks:Inst[]=[],crowns:Inst[]=[],shrubs:Inst[]=[],boxes:Inst[]=[];
  const W=(x:number,y:number,z:number):[number,number,number]=>[plan.x+x,base+y,plan.z+z];
  // Terrace trees round the podium roof and on the planted step at the tower's foot.
  terraceTrees(height).forEach(([x,z],i)=>{const s=.85+.25*((i*7)%3)/2;trunks.push({p:W(x,PODIUM_H+.16*s,z),s:[.035,.32*s,.035],c:'#6b5a45'});crowns.push({p:W(x,PODIUM_H+.42*s,z),s:[.26*s,.24*s,.26*s],c:i%3?'#5f8f4a':'#4e7c3e'});});
  const step=podiumRing(1,48);for(let i=0;i<step.length;i+=3){const [x,z]=step[i];shrubs.push({p:W(x*.965,podiumTop(1)+.1,z*.965),s:[.09,.07,.09],c:i%2?'#5f8f4a':'#77a35a'});}
  // Clipped hedges along the lower planted tier's edge.
  const tier=towerRing(PODIUM_H,height,AIOPS.tier.scale*.975,48);for(let i=0;i<tier.length;i+=2){const [x,z]=tier[i];shrubs.push({p:W(x,PODIUM_H+AIOPS.tier.rise+.07,z),s:[.11,.08,.11],c:i%4?'#5f8f4a':'#6c9a52'});}
  // Plant rooms on the crown, set back from the rim.
  const {cx,cz}=AIOPS.tower;for(const [dx,dz,w,d] of [[-.5,-.2,.7,.5],[.45,.15,.5,.45],[0,.55,.4,.3]] as const){const phi=Math.atan2(dz,dx);boxes.push({p:W(cx+dx,crownAt(phi,height)+.14,cz+dz),s:[w,.26,d],c:'#cfccc3'});}
  // Bollards and planters along the forecourt edge.
  for(let k=-3;k<=3;k++)if(Math.abs(k*.9-AIOPS.atrium.x)>1.1)boxes.push({p:W(k*.9,.08,AIOPS.podium.b+AIOPS.forecourt-.25),s:[.38,.16,.2],c:'#d9d2c3'});
  return {trunks,crowns,shrubs,boxes};
 },[plan,height]);
 if(!plan)return null;
 const P=AIOPS.podium,front=P.b;
 return <group>
  <group position={[plan.x,TERRACE_H,plan.z]} name="ai-operations-center">
   <mesh geometry={geo.glass} material={mats.glass} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.fins} material={mats.fin} raycast={noRaycast}/>
   <mesh geometry={geo.ledges} material={mats.fin} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.rim} material={mats.slab} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.roof} material={mats.roof} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.crownBand} material={mats.bronze} castShadow raycast={noRaycast}/>
   <mesh geometry={geo.ribbonBack} material={mats.bronzeDark} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.ribbonLouvres} material={mats.bronze} castShadow={quality<2} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.slabs} material={mats.slab} castShadow receiveShadow {...handlers}/>
   <mesh geometry={geo.lobbyGlass} material={mats.lobby} receiveShadow {...handlers}/>
   <mesh geometry={geo.podiumGlass} material={mats.podium} receiveShadow {...handlers}/>
   <mesh geometry={geo.planters} material={mats.slab} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.lawn} material={m.lawn} receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.drum} material={mats.drum} {...handlers}/>
   <mesh geometry={geo.dome} material={mats.drum} {...handlers}/>
   <mesh geometry={geo.drumPosts} material={mats.fin} castShadow raycast={noRaycast}/>
   <mesh geometry={geo.bronzeTrim} material={mats.bronze} castShadow raycast={noRaycast}/>
   <mesh geometry={geo.vestibule} material={mats.vestibule} {...handlers}/>
   <mesh geometry={geo.doors} material={mats.doors} raycast={noRaycast}/>
   <mesh geometry={geo.sky} material={mats.sky} raycast={noRaycast}/>
   <mesh geometry={geo.canopy} material={mats.bronzeDark} castShadow receiveShadow raycast={noRaycast}/>
   <mesh geometry={geo.halo} material={mats.halo} raycast={noRaycast}/>
   {/* Sign on the operations storey's fascia, left of the atrium drum. */}
   <mesh geometry={g.plane} material={mats.sign} position={[-1.9,podiumTop(0)+.24,front*.985+.03]} scale={[1.9,.475,1]} raycast={noRaycast}/>
   {/* Forecourt paving and the contact shadow that grounds the podium. */}
   <mesh material={mats.paving} position={[0,.012,front+AIOPS.forecourt/2-.05]} rotation={[-Math.PI/2,0,0]} receiveShadow raycast={noRaycast}><planeGeometry args={[P.a*2-.4,AIOPS.forecourt+.1]}/></mesh>
   <mesh material={mats.shadow} position={[0,.016,0]} rotation={[-Math.PI/2,0,0]} scale={[P.a*2.35,P.b*2.5,1]} raycast={noRaycast}><planeGeometry args={[1,1]}/></mesh>
  </group>
  <Instanced items={parts.trunks} geometry={g.cyl} material={m.plain}/>
  <Instanced items={parts.crowns} geometry={g.ball} material={m.foliage}/>
  <Instanced items={parts.shrubs} geometry={g.ball} material={m.foliage}/>
  <Instanced items={parts.boxes} geometry={g.box} material={m.plain}/>
 </group>;
}
