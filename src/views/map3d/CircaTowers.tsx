import {useEffect,useMemo} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type PickHandlerSet,type useGeometries,type useMaterials} from './models';
import {FINANCIAL as F,financialKey,type FinancialPlan} from './financialPlan';
import {CIRCA,circaParts,circaScreenPath} from './circaPlan';
import {TRANSPORT} from './transportScale';
import {TERRACE_H} from './scene';

const KEY=financialKey('circa');

/** Abstract placeholder content only: colour fields and a generic wordmark, never real ads. */
function screenTexture(){
 const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=256;const c=canvas.getContext('2d')!;
 const fields=['#163d5c','#2b7a8c','#3fb7b2','#d0ad69','#7d4a8c','#1f5d4c','#c4573f','#294237'];
 for(let i=0;i<16;i++){const g=c.createLinearGradient(i*128,0,i*128+128,256);g.addColorStop(0,fields[i%fields.length]);g.addColorStop(1,fields[(i+3)%fields.length]);c.fillStyle=g;c.fillRect(i*128,0,128,256);}
 c.globalAlpha=.25;c.fillStyle='#ffffff';for(let x=0;x<2048;x+=6)c.fillRect(x,0,1,256);for(let y=0;y<256;y+=6)c.fillRect(0,y,2048,1);c.globalAlpha=1;
 c.fillStyle='#f7f7f0';c.textBaseline='middle';c.textAlign='center';c.font='700 132px sans-serif';
 c.fillText('ATLAS',512,132);c.fillText('CIRCA',1536,132);
 c.font='500 44px sans-serif';c.fillText('LIVE · PLAY · STAY',1024,128);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;texture.anisotropy=4;
 return texture;
}

/** A vertical ribbon along the wave-shaped west facade. */
function screenGeometry(){
 const path=circaScreenPath(),S=CIRCA.screen,positions:number[]=[],uvs:number[]=[],index:number[]=[];
 path.forEach(([x,z],i)=>{const u=i/(path.length-1);positions.push(x,S.y0,z,x,S.y1,z);uvs.push(u,0,u,1);if(i)index.push(2*i-2,2*i,2*i-1,2*i-1,2*i,2*i+1);});
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(index);geometry.computeVertexNormals();
 return geometry;
}

/** Circa twin towers on the west waterfront parcel. Static instancing, no lights; the screen is one emissive mesh. */
export function CircaTowers({plan:a,g,m,night,pick,moving}:{plan?:FinancialPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;night:boolean;pick:PickHandlerSet;moving:boolean}){
 const b=a?.circa?a.buildings.find(b=>b.id==='circa'):undefined;
 const res=useMemo(()=>{
  const css=getComputedStyle(document.documentElement),token=(name:string,fallback:string)=>css.getPropertyValue(name).trim()||fallback;
  const palette={white:token('--sage-50','#f7f7f0'),stone:'#e3ddcf',trim:'#c9cfcc',core:'#5f6b72',green:'#5f8f5d',turquoise:'#3fb7b2',wood:'#8e6f4e'};
  const ellipse=new THREE.CylinderGeometry(.5,.5,1,40).translate(0,.5,0);
  const half=new THREE.CylinderGeometry(.5,.5,1,24,1,false,-Math.PI/2,Math.PI).translate(0,.5,0);
  const texture=screenTexture(),screen=screenGeometry();
  return {palette,ellipse,half,texture,screen,
   glass:new THREE.MeshStandardMaterial({color:'#5f8fb4',roughness:.18,metalness:.45,emissive:'#ffcf86',emissiveIntensity:0}),
   storefront:new THREE.MeshStandardMaterial({color:'#36525e',roughness:.2,metalness:.3,emissive:'#ffd9a0',emissiveIntensity:0}),
   water:new THREE.MeshStandardMaterial({color:'#46c3cf',roughness:.25,emissive:'#1a7f8c',emissiveIntensity:.05}),
   led:new THREE.MeshStandardMaterial({color:'#000000',emissive:'#ffffff',emissiveMap:texture,emissiveIntensity:.85,roughness:.5,side:THREE.DoubleSide})};
 },[]);
 useEffect(()=>{res.glass.color.set(night?'#2f4a6a':'#5f8fb4');res.glass.emissiveIntensity=night?.2:0;res.storefront.emissiveIntensity=night?.7:0;res.water.emissiveIntensity=night?.5:.05;res.led.emissiveIntensity=night?1.15:.85;},[night,res]);
 useEffect(()=>()=>{res.ellipse.dispose();res.half.dispose();res.texture.dispose();res.screen.dispose();res.glass.dispose();res.storefront.dispose();res.water.dispose();res.led.dispose();},[res]);
 // The screen scrolls only on frames the pacer already draws, and holds still for reduced motion.
 useFrame((_,delta)=>{if(moving&&b)res.texture.offset.x=(res.texture.offset.x+Math.min(delta,.1)*.025)%1;});

 const parts=useMemo(()=>{
  if(!a?.circa||!b)return;
  const local=circaParts(b.height,res.palette),ox=a.x+b.x,oz=a.z+b.z;
  const place=(list:Inst[])=>list.map(p=>({...p,p:[ox+p.p[0],TERRACE_H+p.p[1],oz+p.p[2]] as Inst['p']}));
  const site:Inst[]=[],marks:Inst[]=[],lamps:Inst[]=[],s=a.circa;
  const box=(t:Inst[],x:number,y:number,z:number,w:number,h:number,d:number,c:string)=>t.push({p:[a.x+x,TERRACE_H+y,a.z+z],s:[w,h,d],c});
  // Street, north walk and promenade continue west from the district.
  const x0=-s.w+.3,x1=.3,cx=(x0+x1)/2,span=x1-x0;
  box(site,cx,.025,F.streetZ,span,.035,TRANSPORT.cityWidth,'#424b50');
  box(site,cx,.04,F.northWalkZ,span,.045,.6,'#e4ddcd');
  box(site,cx,.065,F.promenadeZ,span,.045,.65,'#e4ddcd');
  for(let x=x0+.5;x<x1-.3;x+=.7)box(marks,x,.067,F.streetZ,.32,.006,.025,'#e5dfc9');
  for(const z of [F.streetZ-TRANSPORT.cityWidth/2-.04,F.streetZ+TRANSPORT.cityWidth/2+.04])box(site,cx,.055,z,span,.055,.07,'#cfcbbd');
  box(site,x0+.05,.055,F.streetZ,.08,.12,TRANSPORT.cityWidth+.16,'#cfcbbd');
  // Seawall along the highway side and the north edge; waterfront railing on the south.
  box(site,-s.w+.18,0,s.d/2,.18,.35,s.d-.4,'#c6c3b4');
  box(site,-s.w/2,0,.18,s.w,.35,.18,'#c6c3b4');
  box(site,-s.w/2,0,s.d-.18,s.w,.23,.16,'#c6c3b4');box(site,-s.w/2,.5,s.d-.18,s.w,.035,.035,res.palette.green);
  for(let x=-s.w+.4;x<0;x+=.5)box(site,x,.23,s.d-.18,.025,.27,.025,res.palette.green);
  for(let x=-s.w+1;x<-.5;x+=2.5){box(site,x,.02,14.5,.05,.28,.05,res.palette.green);box(lamps,x,.3,14.5,.07,.05,.07,'#ffffff');}
  return {solid:[...place(local.solid),...site],marks,lamps,storefront:place(local.storefront),towerGlass:place(local.towerGlass),slabs:place(local.slabs),balconies:place(local.balconies),roundWater:place(local.roundWater),lapWater:place(local.lapWater),rounds:place(local.rounds),leaves:place(local.leaves),fronds:place(local.fronds),terrace:[{p:[s.x+s.w/2,0,s.z+s.d/2],s:[s.w,TERRACE_H,s.d]} as Inst],origin:[ox,TERRACE_H,oz] as [number,number,number]};
 },[a,b,res]);
 if(!parts)return null;
 const picked=pick.of([KEY]);
 const keyed=(n:number)=>pick.of(Array<string>(n).fill(KEY));
 return <group name="circa-towers">
  <Instanced items={parts.terrace} geometry={g.box} material={m.terrace}/>
  <Instanced items={parts.solid} geometry={g.box} material={m.plain} pick={keyed(parts.solid.length)}/>
  <Instanced items={parts.marks} geometry={g.box} material={m.plain} shadow={false}/>
  <Instanced items={parts.lamps} geometry={g.ball} material={night?m.lamp:m.plain} shadow={false}/>
  <Instanced items={parts.storefront} geometry={g.box} material={res.storefront} pick={keyed(parts.storefront.length)}/>
  <Instanced items={parts.towerGlass} geometry={res.ellipse} material={res.glass} pick={keyed(parts.towerGlass.length)}/>
  <Instanced items={parts.slabs} geometry={res.ellipse} material={m.plain} pick={keyed(parts.slabs.length)}/>
  <Instanced items={parts.balconies} geometry={res.half} material={m.plain} pick={keyed(parts.balconies.length)}/>
  <Instanced items={parts.rounds} geometry={res.ellipse} material={m.plain}/>
  <Instanced items={parts.roundWater} geometry={res.ellipse} material={res.water} shadow={false}/>
  <Instanced items={parts.lapWater} geometry={g.box} material={res.water} shadow={false}/>
  <Instanced items={parts.leaves} geometry={g.ball} material={m.plain}/>
  <Instanced items={parts.fronds} geometry={g.box} material={m.plain}/>
  <mesh geometry={res.screen} material={res.led} position={parts.origin} onPointerOver={e=>{e.stopPropagation();picked.over(KEY,e)}} onPointerOut={picked.out} onClick={e=>{e.stopPropagation();picked.click(KEY,e)}}/>
 </group>;
}
