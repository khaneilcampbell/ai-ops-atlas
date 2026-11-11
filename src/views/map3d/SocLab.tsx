import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {compactGeometry} from './atlasHqGeometry';
import {SOC_LAB,planSocLab,socLabHeight,type Box,type Kind} from './socLabPlan';
import {useQualityLevel} from '../../lib/governor';
import {packNormals} from './packGeometry';

const noRaycast=()=>null;
/** One curtain-wall tile: four panes across and two storeys up. */
const PANE=.16,PANES=4;

/**
 * Blue curtain-wall glass: four tall panes per tile with thin silver mullions and a floor line
 * every storey. At night about half the panes glow a cool white, the rest stay dark.
 */
function curtainTextures(){
 const make=(lit:boolean)=>{
  const c=document.createElement('canvas');c.width=128;c.height=128;const g=c.getContext('2d')!,w=c.width/PANES,h=c.height/2;
  for(let row=0;row<2;row++)for(let i=0;i<PANES;i++){
   if(lit)g.fillStyle=[1,0,1,1,0,1,0,0][row*PANES+i]?'#e9f4ff':'#0a0f14';
   else{const grad=g.createLinearGradient(i*w,row*h,i*w+w,row*h+h);grad.addColorStop(0,'#7f9db4');grad.addColorStop(.5,'#3f5f78');grad.addColorStop(1,'#5d7f98');g.fillStyle=grad;}
   g.fillRect(i*w,row*h,w,h);
  }
  g.fillStyle=lit?'#000':'#c7ced4';
  for(let i=0;i<PANES;i++)g.fillRect(i*w,0,2,c.height);
  for(let row=0;row<2;row++)g.fillRect(0,row*h,c.width,5);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;return t;
 };
 return {map:make(false),glow:make(true)};
}

/** A box in world units whose UVs are in world units too, so the tiled glass keeps its scale on every face. */
function worldBox(w:number,h:number,d:number,x:number,y:number,z:number){
 const g=new THREE.BoxGeometry(w,h,d),uv=g.getAttribute('uv') as THREE.BufferAttribute;
 // Faces in order +x, -x, +y, -y, +z, -z, four vertices each: (u, v) spans (d, h), (w, d), (w, h).
 const span=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
 for(let i=0;i<uv.count;i++){const [su,sv]=span[Math.floor(i/4)];uv.setXY(i,uv.getX(i)*su,uv.getY(i)*sv);}
 g.translate(x,y+h/2,z);
 return g;
}

/** Instance colours for the parts drawn in the plain steel material. */
const TINT:Partial<Record<Kind,string>>={steel:'#c3c9cf',brace:'#dde1e5',slab:'#e8eaeb'};

/**
 * The SOC Lab as a glass and steel tower with three cantilevered green terraces (see socLabPlan).
 * The glass is one merged mesh; every other part is an instance of the shared unit box, plane or
 * cylinder. No lights: the cyan strips and the lit glass are emissive, brighter at night.
 */
export function SocLab({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const quality=useQualityLevel();
 const height=t.customHeight??socLabHeight(t.height);
 const plan=useMemo(()=>planSocLab(height),[height]);
 const k=t.size;
 const curtain=useMemo(()=>{
  const parts=plan.boxes.filter(b=>b.kind==='curtain').map(b=>worldBox((b.x1-b.x0)*k,b.y1-b.y0,(b.z1-b.z0)*k,(b.x0+b.x1)/2*k,b.y0,(b.z0+b.z1)/2*k).toNonIndexed());
  const merged=mergeGeometries(parts);for(const p of parts)p.dispose();
  if(!merged)throw new Error('SOC Lab: glass could not be merged');
  return packNormals(compactGeometry(merged));
 },[plan,k]);
 useEffect(()=>()=>curtain.dispose(),[curtain]);
 const mats=useMemo(()=>{
  const glass=curtainTextures();
  for(const x of [glass.map,glass.glow])x.repeat.set(1/(PANE*PANES),1/(plan.storey*2));
  return {
   textures:[glass.map,glass.glow],
   curtain:focusable(new THREE.MeshStandardMaterial({map:glass.map,emissiveMap:glass.glow,emissive:'#ffffff',emissiveIntensity:0,roughness:.12,metalness:.5})),
   steel:focusable(new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.45,metalness:.35})),
   cyan:focusable(new THREE.MeshStandardMaterial({color:'#4fe3ff',emissive:'#2ad8ff',emissiveIntensity:.5,roughness:.3,toneMapped:false})),
   lobby:focusable(new THREE.MeshStandardMaterial({color:'#8aa3b3',roughness:.15,metalness:.45,emissive:'#ffd7a0',emissiveIntensity:0})),
  };
 },[plan.storey]);
 useEffect(()=>{
  mats.curtain.emissiveIntensity=night?.55:0;mats.cyan.emissiveIntensity=night?2.2:1.1;mats.lobby.emissiveIntensity=night?.8:.04;
 },[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);
 // The shield badge the generic tower showed, and the project-workers badge, on the lobby.
 const signs=useMemo(()=>{
  const badge=signTexture(t.identity,t.name);
  const worker=t.agents+t.automations>0?signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers'):null;
  const mat=(map:THREE.Texture)=>focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:.5,transparent:true,alphaTest:.3,roughness:.4}));
  return {textures:[badge,worker].filter((x):x is THREE.CanvasTexture=>!!x),badge:mat(badge),worker:worker?mat(worker):null};
 },[t.identity,t.name,t.agents,t.automations]);
 useEffect(()=>()=>{for(const x of signs.textures)x.dispose();signs.badge.dispose();signs.worker?.dispose();},[signs]);

 const parts=useMemo(()=>{
  const w=(x:number,y:number,z:number):[number,number,number]=>[t.x+x*k,base+y,t.z+z*k];
  const toInst=(b:Box,c?:string):Inst=>({p:w((b.x0+b.x1)/2,b.y0,(b.z0+b.z1)/2),s:[(b.x1-b.x0)*k,b.y1-b.y0,(b.z1-b.z0)*k],c});
  const steel:Inst[]=[],trim:Inst[]=[],cyan:Inst[]=[],lobby:Inst[]=[],lawn:Inst[]=[],hedges:Inst[]=[];
  const greens=['#5f8f4a','#6f9c50','#557f43','#7aa35a','#4d7a3c'];
  for(const [i,b] of plan.boxes.entries()){
   if(b.kind==='curtain')continue;
   if(b.kind==='steel')steel.push(toInst(b,TINT.steel));
   else if(b.kind==='brace'||b.kind==='slab')trim.push(toInst(b,TINT[b.kind]));
   else if(b.kind==='cyan')cyan.push(toInst(b));
   else if(b.kind==='lobby'||b.kind==='pavilion')lobby.push(toInst(b));
   else if(b.kind==='lawn')lawn.push(toInst(b));
   else hedges.push(toInst(b,greens[i%greens.length]));
  }
  // Each diagonal brace: a unit box stood on its lower end and leaned over to its upper end.
  const m=SOC_LAB.member;
  for(const b of plan.braces){
   const dz=(b.z1-b.z0)*k,dy=b.y1-b.y0;
   trim.push({p:w(b.x,b.y0,b.z0),s:[.035*k,Math.hypot(dz,dy),m],rx:Math.atan2(dz,dy),c:TINT.brace});
  }
  const discs:Inst[]=[],rims:Inst[]=[];
  for(const d of plan.discs)(d.kind==='cyan'?rims:discs).push({p:w(d.x,d.y,d.z),s:[d.r*2*k,d.h,d.r*2*k],c:TINT.steel});
  const shrubs:Inst[]=[],trunks:Inst[]=[],crowns:Inst[]=[];
  for(const [i,q] of plan.plants.entries()){
   const c=greens[i%greens.length];
   if(q.kind==='shrub'){const s=q.s*k;shrubs.push({p:w(q.x,q.y+s*.45,q.z),s:[s*.8,s*.6,s*.7],r:i,c});}
   else{trunks.push({p:w(q.x,q.y,q.z),s:[.016,.2*q.s,.016],c:'#6b5a48'});crowns.push({p:w(q.x,q.y+.27*q.s,q.z),s:[.11*q.s,.13*q.s,.11*q.s],c});}
  }
  return {steel,trim,cyan,lobby,lawn,hedges,discs,rims,shrubs,trunks,crowns};
 },[plan,t.x,t.z,base,k]);
 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);
 const every=useMemo(()=>({...pick,keys:new Array(plan.boxes.length+plan.braces.length+plan.discs.length).fill(t.key)}),[pick,t.key,plan]);
 const detailShadow=quality<2;
 const L=SOC_LAB.lobby,front=(L.z1+.014)*k,badge=.14*k;
 return <group>
  <group name="soc-lab" position={[t.x,base,t.z]}>
   <mesh geometry={curtain} material={mats.curtain} castShadow receiveShadow {...handlers}/>
   <mesh geometry={g.plane} material={signs.badge} position={[(L.x0+.12)*k,L.h*.55,front]} scale={[badge,badge,1]} raycast={noRaycast}/>
   {signs.worker&&<mesh geometry={g.plane} material={signs.worker} position={[(L.x1-.1)*k,L.h*.55,front]} scale={[badge*.75,badge*.75,1]} raycast={noRaycast}/>}
  </group>
  <Instanced items={parts.steel} geometry={g.box} material={mats.steel} pick={every} shadow/>
  <Instanced items={parts.trim} geometry={g.box} material={mats.steel} pick={every} shadow={detailShadow}/>
  <Instanced items={parts.discs} geometry={g.cyl} material={mats.steel} pick={every} shadow/>
  <Instanced items={parts.cyan} geometry={g.box} material={mats.cyan} pick={every} shadow={false}/>
  <Instanced items={parts.rims} geometry={g.cyl} material={mats.cyan} pick={every} shadow={false}/>
  <Instanced items={parts.lobby} geometry={g.box} material={mats.lobby} pick={every} shadow={false}/>
  <Instanced items={parts.lawn} geometry={g.box} material={m.lawn} shadow={false}/>
  <Instanced items={parts.hedges} geometry={g.box} material={m.foliage} shadow={false}/>
  <Instanced items={parts.shrubs} geometry={g.rock} material={m.foliage} shadow={false}/>
  <Instanced items={parts.crowns} geometry={g.blob} material={m.foliage} shadow={detailShadow}/>
  {quality<3&&<Instanced items={parts.trunks} geometry={g.trunk} material={m.plain} shadow={false}/>}
 </group>;
}
