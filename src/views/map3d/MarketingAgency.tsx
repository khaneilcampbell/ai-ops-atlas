import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import {TERRACE_H} from './scene';
import {AGENCY,AGENCY_KEY,type AgencyPlan} from './marketingAgencyPlan';
import {agencyGeometry,SCREEN_LONG,SCREEN_WEST} from './marketingAgencyGeometry';

/**
 * The perforated screen: a lattice of diamond openings, densest at the west end and low down,
 * thinning to small scattered points and then plain cream toward the copper sweep. One canvas
 * carries the day look (openings read dark) and a second the night glow through the openings.
 */
export function screenDensity(u:number,v:number){return Math.max(0,Math.min(1,1-(u*.95+v*.3)/.95));}
function screenTextures(){
 const W=2048,H=512,make=(night:boolean)=>{
  const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d')!;
  g.fillStyle=night?'#000':'#efe8dc';g.fillRect(0,0,W,H);
  if(!night){
   // Faint vertical panel joints, as on a ribbed metal or GRC skin.
   g.fillStyle='rgba(120,100,80,.08)';for(let x=0;x<W;x+=16)g.fillRect(x,0,2,H);
   const sky=g.createLinearGradient(0,0,0,H);sky.addColorStop(0,'rgba(255,255,255,.18)');sky.addColorStop(1,'rgba(160,130,100,.06)');g.fillStyle=sky;g.fillRect(0,0,W,H);
  }
  const s=22;
  for(let row=0;row*s<H+s;row++)for(let col=0;col*s<W+s;col++){
   const x=col*s+(row%2?s/2:0),y=row*s,u=x/W,f=u<SCREEN_WEST[1]?1:u<SCREEN_LONG[1]?screenDensity((u-SCREEN_LONG[0])/(SCREEN_LONG[1]-SCREEN_LONG[0]),1-y/H):0;
   if(f<.05)continue;
   // A plain panel behind the wordmark.
   if(u>=SCREEN_LONG[0]&&u<SCREEN_LONG[1]){const lx=(u-SCREEN_LONG[0])/(SCREEN_LONG[1]-SCREEN_LONG[0])*AGENCY.length,ly=(1-y/H)*4,wd=AGENCY.word;if(Math.abs(lx-wd.x)<wd.w/2+.12&&Math.abs(ly-wd.y)<wd.h/2+.1)continue;}
   const r=s*.56*Math.pow(f,.7);
   g.fillStyle=night?`rgba(255,${190+Math.round(30*f)},${120+Math.round(40*f)},${.55+.45*f})`:`rgba(58,42,34,${.55+.4*f})`;
   g.beginPath();g.moveTo(x,y-r);g.lineTo(x+r*.78,y);g.lineTo(x,y+r);g.lineTo(x-r*.78,y);g.closePath();g.fill();
  }
  // Roof and plain areas sample the far right edge, kept clear.
  g.fillStyle=night?'#000':'#e6ded1';g.fillRect(Math.round(W*.94),0,W,H);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;t.flipY=false;
  return t;
 };
 return {map:make(false),glow:make(true)};
}

/** Bronze glass with copper mullions; the night map lights the interior behind it. */
function glassTextures(){
 const make=(night:boolean)=>{
  const c=document.createElement('canvas');c.width=128;c.height=128;const g=c.getContext('2d')!;
  if(night){g.fillStyle='#ffcf96';g.fillRect(0,0,128,128);g.fillStyle='rgba(0,0,0,.55)';for(let y=0;y<128;y+=64)g.fillRect(0,y+54,128,10);g.fillStyle='#000';for(let x=0;x<128;x+=32)g.fillRect(x,0,3,128);}
  else{
   const grad=g.createLinearGradient(0,0,0,128);grad.addColorStop(0,'#c7a48a');grad.addColorStop(.5,'#8e624c');grad.addColorStop(1,'#5a3a2e');g.fillStyle=grad;g.fillRect(0,0,128,128);
   g.fillStyle='rgba(255,240,224,.22)';g.beginPath();g.moveTo(6,128);g.lineTo(30,0);g.lineTo(46,0);g.lineTo(22,128);g.closePath();g.fill();
   g.fillStyle='#7a3f24';for(let x=0;x<128;x+=32)g.fillRect(x,0,2,128);for(let y=0;y<128;y+=64)g.fillRect(0,y,128,2);
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(.7,.7);t.anisotropy=4;t.flipY=false;
  return t;
 };
 return {map:make(false),glow:make(true)};
}

function wordmark(){
 const c=document.createElement('canvas');c.width=1024;c.height=192;const g=c.getContext('2d')!;
 g.fillStyle='#9a5232';g.textAlign='center';g.textBaseline='middle';g.font='500 120px -apple-system, "Helvetica Neue", Arial, sans-serif';
 g.fillText('B E N J A I R E',512,100,1000);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

const noRaycast=()=>null;

/**
 * Benjaire Marketing Agency (exterior, phase 1). Six static meshes, no lights of its own: the
 * screen, copper, glass, pools, wordmark and slot. Night only raises emissive maps.
 */
export function MarketingAgency({plan:a,g,m,pick,night=false,building=true}:{plan?:AgencyPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean;
 /** False draws only the raised ground and the pools, for the interior's view out. */
 building?:boolean}){
 // The raised ground: the lot and its causeways, at terrace height in the terrace material.
 const plinth=useMemo(()=>(a?.plinth??[]).map((r):Inst=>({p:[r.x+r.w/2,0,r.z+r.d/2],s:[r.w,TERRACE_H,r.d]})),[a]);
 const geo=useMemo(()=>{
  if(!a)return;
  const shell=agencyGeometry(),pools=mergeGeometries(a.pools.map(p=>{const b=new THREE.BoxGeometry(p.w,.04,p.d);b.translate(p.x+p.w/2,TERRACE_H+.005,p.z+p.d/2);return b;}))!;
  for(const k of ['shell','copper','glass'] as const)shell[k].translate(a.x,TERRACE_H,a.z);
  return {...shell,pools};
 },[a]);
 useEffect(()=>()=>{if(geo){geo.shell.dispose();geo.copper.dispose();geo.glass.dispose();geo.pools.dispose();}},[geo]);
 const mats=useMemo(()=>{
  const screen=screenTextures(),glass=glassTextures(),word=wordmark();
  return {
   textures:[screen.map,screen.glow,glass.map,glass.glow,word],
   shell:new THREE.MeshStandardMaterial({map:screen.map,emissiveMap:screen.glow,emissive:'#ffc48a',emissiveIntensity:0,roughness:.78,metalness:.02}),
   copper:new THREE.MeshStandardMaterial({color:'#a2552f',roughness:.36,metalness:.55,emissive:'#ff9a5c',emissiveIntensity:0,side:THREE.DoubleSide}),
   glass:new THREE.MeshStandardMaterial({map:glass.map,emissiveMap:glass.glow,emissive:'#ffbe7a',emissiveIntensity:.04,roughness:.16,metalness:.35,side:THREE.DoubleSide}),
   pool:new THREE.MeshStandardMaterial({color:'#7cc0d3',roughness:.08,metalness:.12,emissive:'#2f6b80',emissiveIntensity:0}),
   word:new THREE.MeshStandardMaterial({map:word,emissiveMap:word,emissive:'#ffb27a',emissiveIntensity:0,transparent:true,alphaTest:.3,roughness:.4,metalness:.4}),
  };
 },[]);
 useEffect(()=>{
  mats.shell.emissiveIntensity=night?.95:0;mats.glass.emissiveIntensity=night?.85:.04;
  mats.copper.emissiveIntensity=night?.12:0;mats.pool.emissiveIntensity=night?.55:0;mats.word.emissiveIntensity=night?.9:0;
 },[mats,night]);
 useEffect(()=>()=>{for(const m of [mats.shell,mats.copper,mats.glass,mats.pool,mats.word])m.dispose();for(const t of mats.textures)t.dispose();},[mats]);
 if(!a||!geo)return null;
 const click={onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(AGENCY_KEY,e);},onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(AGENCY_KEY,e);},onPointerOut:()=>pick.out()};
 // Wordmark on the west block's south face, left of the slot.
 const wx=a.x+AGENCY.word.x,wy=TERRACE_H+AGENCY.word.y;
 return <group name="benjaire-marketing-agency">
  <Instanced items={plinth} geometry={g.box} material={m.terrace}/>
  {building&&<>
   <mesh geometry={geo.shell} material={mats.shell} castShadow receiveShadow {...click}/>
   <mesh geometry={geo.copper} material={mats.copper} castShadow {...click}/>
   <mesh geometry={geo.glass} material={mats.glass} {...click}/>
  </>}
  <mesh geometry={geo.pools} material={mats.pool} receiveShadow raycast={noRaycast}/>
  {building&&<mesh position={[wx,wy,a.z+AGENCY.depth+.012]} material={mats.word} raycast={noRaycast}><planeGeometry args={[AGENCY.word.w,AGENCY.word.h]}/></mesh>}
 </group>;
}
