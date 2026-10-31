import {useEffect,useMemo} from 'react';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import {TERRACE_H} from './scene';
import {MALL,MALL_KEY,along,mallFins,mallFloor,type MallPlan} from './mallPlan';
import type {Pt} from './roads';

/** A flat ribbon between two edges, extruded up by h from y. */
function ribbon(outer:Pt[],inner:Pt[],y:number,h:number){
 const shape=new THREE.Shape();
 shape.moveTo(outer[0][0],outer[0][1]);for(const [x,z] of outer.slice(1))shape.lineTo(x,z);
 for(const [x,z] of [...inner].reverse())shape.lineTo(x,z);shape.closePath();
 const geo=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,curveSegments:1});
 // Shape y becomes world z; the extrusion then runs downward, so lift it by h.
 geo.rotateX(Math.PI/2);geo.translate(0,y+h,0);
 return geo;
}
/** Pull an edge toward its partner, so glazing sits back behind the fins. */
const inset=(a:Pt[],b:Pt[],k:number):Pt[]=>a.map(([x,z],i)=>[x+(b[i][0]-x)*k,z+(b[i][1]-z)*k]);

function signage(){
 const c=document.createElement('canvas');c.width=1024;c.height=160;const ctx=c.getContext('2d')!;
 ctx.fillStyle='#d0ad69';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 104px -apple-system, "Helvetica Neue", Arial, sans-serif';
 ctx.fillText('MARKETPLACE',512,84);
 const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 return {texture,material:new THREE.MeshBasicMaterial({map:texture,transparent:true,toneMapped:false,depthWrite:false}),geometry:new THREE.PlaneGeometry(1.9,.3)};
}

/**
 * Atlas Marketplace. Static, no lights of its own: a handful of merged meshes plus instanced fins
 * and planters. Night only raises the glass glow, the same way the other buildings light up.
 */
export function Mall({plan:a,g,m,pick,night=false}:{plan?:MallPlan;night?:boolean;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick}){
 const mats=useMemo(()=>({
  slab:new THREE.MeshStandardMaterial({color:'#f7f7f0',roughness:.7}),
  roof:new THREE.MeshStandardMaterial({color:'#4f7a52',roughness:.95}),
  glass:new THREE.MeshStandardMaterial({color:'#7fa3a0',roughness:.25,metalness:.25,emissive:'#f0c27a',emissiveIntensity:.05}),
  edge:new THREE.MeshStandardMaterial({color:'#f6e7c4',emissive:'#ffd98f',emissiveIntensity:0}),
  canopy:new THREE.MeshStandardMaterial({color:'#dce2d5',transparent:true,opacity:.72,roughness:.3,emissive:'#d0ad69',emissiveIntensity:0,side:THREE.DoubleSide,depthWrite:false}),
  stem:new THREE.MeshStandardMaterial({color:'#edf0e7',roughness:.5,side:THREE.DoubleSide}),
  water:new THREE.MeshStandardMaterial({color:'#5aaac0',roughness:.15,emissive:'#3d7f99',emissiveIntensity:0}),
 }),[]);
 useEffect(()=>{
  mats.glass.emissiveIntensity=night?1.25:.05;mats.glass.color.set(night?'#3a2c1c':'#7fa3a0');
  mats.edge.emissiveIntensity=night?1.6:0;mats.canopy.emissiveIntensity=night?.55:0;mats.water.emissiveIntensity=night?.7:0;
 },[mats,night]);
 useEffect(()=>()=>{for(const x of Object.values(mats))x.dispose();},[mats]);
 const sign=useMemo(signage,[]);
 useEffect(()=>()=>{sign.texture.dispose();sign.material.dispose();sign.geometry.dispose();},[sign]);

 const geo=useMemo(()=>{
  if(!a)return;
  const y0=TERRACE_H,slabs:THREE.BufferGeometry[]=[],glass:THREE.BufferGeometry[]=[],edges:THREE.BufferGeometry[]=[];
  for(let l=0;l<MALL.levels;l++){
   const {outer,inner}=mallFloor(a,l),base=y0+l*MALL.floor;
   slabs.push(ribbon(outer,inner,base+MALL.floor,MALL.slab));
   glass.push(ribbon(inset(outer,inner,.14),inset(inner,outer,.1),base,MALL.floor));
   // A thin warm strip on each floor edge: the string lights at night, a white band by day.
   edges.push(ribbon(outer,inset(outer,inner,.035),base+MALL.floor+MALL.slab,.012));
  }
  const top=mallFloor(a,MALL.levels-1);
  const roof=ribbon(inset(top.outer,top.inner,.05),inset(top.inner,top.outer,.05),y0+MALL.levels*MALL.floor+MALL.slab,.02);
  // Funnel "tree" over the atrium: narrow stem flaring into a translucent disc.
  const h=MALL.levels*MALL.floor+.32,pts=Array.from({length:12},(_,i)=>{const t=i/11;return new THREE.Vector2(.07+(MALL.canopyR-.07)*t**2.4,t*h);});
  const stem=new THREE.LatheGeometry(pts,20);stem.translate(a.cx,y0,a.cz);
  const disc=new THREE.CylinderGeometry(MALL.canopyR+.06,MALL.canopyR+.06,.03,28);disc.translate(a.cx,y0+h,a.cz);
  return {slabs:mergeGeometries(slabs)!,glass:mergeGeometries(glass)!,edges:mergeGeometries(edges)!,roof,stem,disc};
 },[a]);
 useEffect(()=>()=>{if(geo)for(const x of Object.values(geo))x.dispose();},[geo]);

 const parts=useMemo(()=>{
  const fins:Inst[]=[],plants:Inst[]=[],solid:Inst[]=[];if(!a)return {fins,plants,solid};
  const y0=TERRACE_H;
  for(const f of mallFins(a,y0))fins.push({p:[f.x,f.y,f.z],s:[.016,f.h,.06],r:-f.a,c:'#f7f7f0'});
  for(let l=0;l<MALL.levels;l++){
   const {outer,inner}=mallFloor(a,l);
   for(const q of along(inset(outer,inner,.1),MALL.plantStep))plants.push({p:[q.x,y0+(l+1)*MALL.floor+MALL.slab+.04,q.z],s:[.1,.06,.1],c:l%2?'#86b958':'#4f7a52'});
  }
  const p=a.plaza;
  // The plaza runs on to the collector road's sidewalk, so walkers arrive on paving.
  solid.push({p:[p.x+p.w/2,y0+.005,p.z+(p.d+.3)/2],s:[p.w,.02,p.d+.3],c:'#dcd3bd'});
  // Entrance court inside the horseshoe, under the canopy.
  solid.push({p:[a.cx,y0+.006,a.cz+a.rz*.45],s:[a.rx*.9,.02,a.rz*1.1],c:'#e6d6b4'});
  // Monument sign at the head of the plaza, facing the boulevard.
  solid.push({p:[a.cx,y0,a.z+a.d-1.75],s:[2.05,.42,.07],c:'#294237'});
  // Basement car park ramp off the boulevard side.
  solid.push({p:[a.x+a.w-.35,y0+.01,a.z+1.6],s:[.5,.03,1.4],c:'#2b3833'},{p:[a.x+a.w-.35,y0+.03,a.z+.9],s:[.55,.12,.05],c:'#d0ad69'});
  for(const dx of [-.9,.9])solid.push({p:[a.cx+dx,y0,a.z+a.d-.2],s:[.05,.55,.05],c:'#294237'},{p:[a.cx+dx,y0+.55,a.z+a.d-.2],s:[.1,.06,.1],c:'#f6e7c4'});
  return {fins,plants,solid};
 },[a]);

 if(!a||!geo)return null;
 const keys=(n:number)=>({...pick,keys:Array.from({length:n},()=>MALL_KEY)});
 const click={onClick:(e:import('@react-three/fiber').ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(MALL_KEY,e);},onPointerOver:(e:import('@react-three/fiber').ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(MALL_KEY,e);},onPointerOut:()=>pick.out()};
 return <group name="atlas-marketplace">
  <mesh geometry={geo.slabs} material={mats.slab} castShadow receiveShadow {...click}/>
  <mesh geometry={geo.glass} material={mats.glass} receiveShadow {...click}/>
  <mesh geometry={geo.edges} material={mats.edge}/>
  <mesh geometry={geo.roof} material={mats.roof} receiveShadow/>
  <mesh geometry={geo.stem} material={mats.stem} castShadow/>
  <mesh geometry={geo.disc} material={mats.canopy}/>
  <mesh position={[a.fountain.x,TERRACE_H+.05,a.fountain.z]} material={mats.slab} castShadow><cylinderGeometry args={[a.fountain.r,a.fountain.r*1.05,.1,28]}/></mesh>
  <mesh position={[a.fountain.x,TERRACE_H+.105,a.fountain.z]} material={mats.water}><cylinderGeometry args={[a.fountain.r*.86,a.fountain.r*.86,.01,28]}/></mesh>
  <mesh position={[a.cx,TERRACE_H+.21,a.z+a.d-1.71]} geometry={sign.geometry} material={sign.material}/>
  <Instanced items={parts.fins} geometry={g.box} material={m.plain} pick={keys(parts.fins.length)}/>
  <Instanced items={parts.plants} geometry={g.blob} material={m.plain} shadow={false}/>
  <Instanced items={parts.solid} geometry={g.box} material={m.plain}/>
 </group>;
}
