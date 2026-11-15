import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Tower} from './scene';
import {focusable,signTexture} from './materials';
import {compactGeometry} from './atlasHqGeometry';
import {PORTFOLIO_SITE,planPortfolioSite,type Box,type Panel} from './portfolioSitePlan';
import {useQualityLevel} from '../../lib/governor';
import {packNormals} from './packGeometry';

const canvas=(w:number,h:number)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d')!] as const;};
const texture=(c:HTMLCanvasElement,repeat?:number)=>{const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;if(repeat){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/repeat,1/repeat);}return t;};

/** Brown brick and timber slats, tiled in world units (one tile 0.24 wide). */
function slatTexture(){
 const [c,g]=canvas(64,64);
 for(let i=0;i<8;i++){g.fillStyle=['#6e4330','#7a4a33','#653c2b','#734631'][i%4];g.fillRect(i*8,0,8,64);g.fillStyle='#3a2219';g.fillRect(i*8+6.5,0,1.5,64);}
 return texture(c,.24);
}
/** A slatted balcony railing: bronze bars with gaps you can see through. */
function railTexture(){
 const [c,g]=canvas(128,32);
 g.fillStyle='#4a2e20';g.fillRect(0,0,128,4);g.fillRect(0,29,128,3);
 for(let x=0;x<128;x+=6)g.fillRect(x,0,3,32);
 return texture(c);
}
/** Window glass: two tall panes with a curtain; at night they glow warm. */
function paneTextures(){
 const make=(lit:boolean)=>{
  const [c,g]=canvas(64,96);
  if(lit){g.fillStyle='#ffd79e';g.fillRect(0,0,64,96);g.fillStyle='#f6c27a';g.fillRect(44,0,20,96);g.fillStyle='#000';}
  else{const grad=g.createLinearGradient(0,0,64,96);grad.addColorStop(0,'#dde6e8');grad.addColorStop(.45,'#a8b8bd');grad.addColorStop(.75,'#c9b49a');grad.addColorStop(1,'#a99278');g.fillStyle=grad;g.fillRect(0,0,64,96);g.fillStyle='#ece6da';g.fillRect(46,0,18,96);g.fillStyle='#2b241f';}
  g.fillRect(0,0,64,3);g.fillRect(0,93,64,3);g.fillRect(0,0,3,96);g.fillRect(61,0,3,96);g.fillRect(31,0,2,96);
  return texture(c);
 };
 return {map:make(false),glow:make(true)};
}
/** The entrance gate: dark timber in a chevron pattern. */
function gateTexture(){
 const [c,g]=canvas(64,128);
 g.fillStyle='#5a3424';g.fillRect(0,0,64,128);g.strokeStyle='#8a5638';g.lineWidth=3;
 for(let y=-64;y<160;y+=10){g.beginPath();g.moveTo(0,y);g.lineTo(32,y+20);g.lineTo(64,y);g.stroke();}
 g.fillStyle='#2e1b13';g.fillRect(30.5,0,3,128);g.fillRect(0,0,64,3);g.fillRect(0,125,64,3);g.fillRect(0,0,3,128);g.fillRect(61,0,3,128);
 return texture(c);
}
/** The round terracotta name sign beside the gate. */
function nameDisc(name:string){
 const [c,g]=canvas(256,256);
 g.fillStyle='#b5553a';g.beginPath();g.arc(128,128,124,0,Math.PI*2);g.fill();
 g.strokeStyle='#f3dccd';g.lineWidth=4;g.beginPath();g.arc(128,128,108,0,Math.PI*2);g.stroke();
 g.fillStyle='#fbefe6';g.textAlign='center';g.textBaseline='middle';
 const words=name.split(' ');g.font='italic 600 46px Georgia, serif';
 words.forEach((w,i)=>g.fillText(w,128,128+(i-(words.length-1)/2)*50,200));
 return texture(c);
}

/** A box in world units whose UVs are in world units too, so a tiled texture keeps its scale on every face. */
function worldBox(w:number,h:number,d:number,x:number,y:number,z:number){
 const g=new THREE.BoxGeometry(w,h,d),uv=g.getAttribute('uv') as THREE.BufferAttribute;
 // Faces in order +x, -x, +y, -y, +z, -z, four vertices each: (u, v) spans (d, h), (w, d), (w, h).
 const span=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
 for(let i=0;i<uv.count;i++){const [su,sv]=span[Math.floor(i/4)];uv.setXY(i,uv.getX(i)*su,uv.getY(i)*sv);}
 g.translate(x,y+h/2,z);
 return g;
}

const MATERIAL_KINDS=['white','trim','rail','dark','lobby'] as const;

/**
 * The Portfolio Site as a slim apartment tower (see portfolioSitePlan). Almost every part
 * is an instance of the shared unit box or plane, so the building adds no geometry beyond one
 * merged mesh for its brick and timber, and no lights.
 */
export function PortfolioSite({tower:t,base,g,m,pick,night=false}:{tower:Tower;base:number;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night?:boolean}){
 const quality=useQualityLevel();
 const plan=useMemo(()=>planPortfolioSite(t.customHeight),[t.customHeight]);
 const k=t.size;
 const slats=useMemo(()=>{
  const parts=plan.boxes.filter(b=>b.kind==='slats').map(b=>worldBox((b.x1-b.x0)*k,b.y1-b.y0,(b.z1-b.z0)*k,(b.x0+b.x1)/2*k,b.y0,(b.z0+b.z1)/2*k).toNonIndexed());
  const merged=mergeGeometries(parts);for(const p of parts)p.dispose();
  if(!merged)throw new Error('Portfolio Site: slats could not be merged');
  return packNormals(compactGeometry(merged));
 },[plan,k]);
 useEffect(()=>()=>slats.dispose(),[slats]);
 const mats=useMemo(()=>{
  const slat=slatTexture(),rail=railTexture(),panes=paneTextures(),gate=gateTexture();
  return {
   textures:[slat,rail,panes.map,panes.glow,gate],
   white:focusable(new THREE.MeshStandardMaterial({color:'#f2efe9',roughness:.85,metalness:0})),
   slats:focusable(new THREE.MeshStandardMaterial({map:slat,roughness:.8,metalness:0})),
   rail:focusable(new THREE.MeshStandardMaterial({map:rail,transparent:true,alphaTest:.4,side:THREE.DoubleSide,roughness:.6,metalness:.2})),
   dark:focusable(new THREE.MeshStandardMaterial({color:'#2d2a27',roughness:.6,metalness:.3})),
   lobby:focusable(new THREE.MeshStandardMaterial({color:'#2a3034',roughness:.2,metalness:.4,emissive:'#ffcf96',emissiveIntensity:0})),
   glass:focusable(new THREE.MeshStandardMaterial({map:panes.map,emissiveMap:panes.glow,emissive:'#ffffff',emissiveIntensity:0,roughness:.12,metalness:.35})),
   gate:focusable(new THREE.MeshStandardMaterial({map:gate,emissiveMap:gate,emissive:'#ffffff',emissiveIntensity:0,roughness:.6})),
   ceiling:focusable(new THREE.MeshStandardMaterial({color:'#efe8dc',roughness:.9,emissive:'#ffc98a',emissiveIntensity:0})),
  };
 },[]);
 useEffect(()=>{
  mats.glass.emissiveIntensity=night?.9:0;mats.lobby.emissiveIntensity=night?.55:0;mats.ceiling.emissiveIntensity=night?.6:0;mats.gate.emissiveIntensity=night?.25:0;
 },[mats,night]);
 useEffect(()=>()=>{for(const v of Object.values(mats))if(v instanceof THREE.Material)v.dispose();for(const x of mats.textures)x.dispose();},[mats]);
 const sign=useMemo(()=>{const map=nameDisc(t.name);return {map,mat:focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:.2,transparent:true,alphaTest:.3,roughness:.5}))};},[t.name]);
 useEffect(()=>()=>{sign.map.dispose();sign.mat.dispose();},[sign]);
 // The project-workers badge the generic tower showed, on the side of the ground floor.
 const worker=useMemo(()=>{
  if(t.agents+t.automations<=0)return null;
  const map=signTexture({symbol:t.agents>0?'agent':'automation',style:'tech',accent:'#a5afa5'},'Project workers');
  return {map,mat:focusable(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',emissiveIntensity:.55,transparent:true,alphaTest:.3,roughness:.4}))};
 },[t.agents,t.automations]);
 useEffect(()=>()=>{worker?.map.dispose();worker?.mat.dispose();},[worker]);

 const parts=useMemo(()=>{
  const w=(x:number,y:number,z:number):[number,number,number]=>[t.x+x*k,base+y,t.z+z*k];
  const boxes:Record<string,Inst[]>={white:[],trim:[],rail:[],dark:[],lobby:[]};
  const toInst=(b:Box):Inst=>({p:w((b.x0+b.x1)/2,b.y0,(b.z0+b.z1)/2),s:[(b.x1-b.x0)*k,b.y1-b.y0,(b.z1-b.z0)*k]});
  // Only the big white volumes cast shadows; slab edges and frames would cost a shadow pass each for nothing visible.
  for(const b of plan.boxes)if(b.kind!=='slats')boxes[b.kind==='white'&&b.y1-b.y0<1?'trim':b.kind].push(toInst(b));
  const panels:Record<Panel['kind'],Inst[]>={glass:[],gate:[],sign:[],ceiling:[]};
  const turn={front:0,side:Math.PI/2,back:Math.PI,down:0};
  for(const q of plan.panels){
   const flat=q.face==='down'||q.kind==='sign';
   panels[q.kind].push({p:w(q.x,q.y,q.z),s:[q.w*k,flat?q.h*k:q.h,1],r:turn[q.face],rx:q.face==='down'?Math.PI/2:0});
  }
  const greens=['#5f8f4a','#6f9c50','#557f43','#7aa35a','#4d7a3c'];
  const shrubs:Inst[]=[],trails:Inst[]=[],trunks:Inst[]=[],crowns:Inst[]=[];
  for(const [i,q] of plan.plants.entries()){
   const c=greens[i%greens.length];
   if(q.kind==='shrub'){const s=q.s*k;shrubs.push({p:w(q.x,q.y+s*.45,q.z),s:[s*.8,s*.6,s*.7],r:i,c});}
   else if(q.kind==='trail')trails.push({p:w(q.x,q.y-q.s,q.z),s:[.045*k,q.s,.02*k],r:i*.7,c});
   else{trunks.push({p:w(q.x,q.y,q.z),s:[.016,.2*q.s,.016],c:'#6b5a48'});crowns.push({p:w(q.x,q.y+.27*q.s,q.z),s:[.11*q.s,.13*q.s,.11*q.s],c});}
  }
  return {boxes,panels,shrubs,trails,trunks,crowns};
 },[plan,t.x,t.z,base,k]);
 const handlers=useMemo(()=>({
  onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(t.key,e);},
  onPointerOut:()=>pick.out(),
  onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(t.key,e);},
 }),[pick,t.key]);
 const every=useMemo(()=>({...pick,keys:new Array(plan.boxes.length+plan.panels.length).fill(t.key)}),[pick,t.key,plan]);
 const detailShadow=quality<2;
 return <group>
  <group name="portfolio-site" position={[t.x,base,t.z]}>
   <mesh geometry={slats} material={mats.slats} castShadow receiveShadow {...handlers}/>
   {worker&&<mesh geometry={g.plane} material={worker.mat} position={[(PORTFOLIO_SITE.core.x1+.006)*k,.34,.02*k]} rotation={[0,Math.PI/2,0]} scale={[.14*k,.14*k,1]} raycast={()=>null}/>}
  </group>
  {MATERIAL_KINDS.map(kind=><Instanced key={kind} items={parts.boxes[kind]} geometry={g.box} material={kind==='trim'?mats.white:mats[kind]} pick={every} shadow={kind==='white'}/>)}
  <Instanced items={parts.panels.glass} geometry={g.plane} material={mats.glass} pick={every} shadow={false}/>
  <Instanced items={parts.panels.ceiling} geometry={g.plane} material={mats.ceiling} pick={every} shadow={false}/>
  <Instanced items={parts.panels.gate} geometry={g.plane} material={mats.gate} pick={every} shadow={false}/>
  <Instanced items={parts.panels.sign} geometry={g.plane} material={sign.mat} pick={every} shadow={false}/>
  <Instanced items={parts.shrubs} geometry={g.rock} material={m.foliage} shadow={false}/>
  <Instanced items={parts.trails} geometry={g.box} material={m.foliage} shadow={false}/>
  <Instanced items={parts.crowns} geometry={g.blob} material={m.foliage} shadow={detailShadow}/>
  {quality<3&&<Instanced items={parts.trunks} geometry={g.trunk} material={m.plain} shadow={false}/>}
 </group>;
}
