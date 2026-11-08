import {useEffect,useMemo} from 'react';
import * as THREE from 'three';
import {mergeGeometries,mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {ThreeEvent} from '@react-three/fiber';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import {GALLERIA,GALLERIA_KEY,galleriaFins,type GalleriaPlan} from './galleriaPlan';
import type {Pt} from './roads';

/** A flat slab from a closed outline (with an optional hole), its top at y+h. Untextured, so no uv, and indexed so the caps share vertices. */
export function slabGeometry(outline:Pt[],y:number,h:number,hole?:Pt[]){
 const shape=new THREE.Shape(outline.map(([x,z])=>new THREE.Vector2(x,z)));
 if(hole)shape.holes.push(new THREE.Path(hole.map(([x,z])=>new THREE.Vector2(x,z))));
 const geo=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,curveSegments:1});
 // Shape y becomes world z; the extrusion then runs downward, so lift it by h.
 geo.rotateX(Math.PI/2);geo.translate(0,y+h,0);geo.deleteAttribute('uv');
 const indexed=mergeVertices(geo);geo.dispose();
 return indexed;
}
/**
 * The side wall of a closed outline from y0 to y1, both faces (glass is seen from in and out).
 * u counts panes of `pane` width round the wall and v runs 0 to 1 up it, for the mullion texture.
 */
export function wallGeometry(line:Pt[],y0:number,y1:number,pane=.36){
 const pos:number[]=[],uv:number[]=[],index:number[]=[];let u=0;
 // A closed ribbon: a bottom and top vertex per point (the first repeated at the end for the seam).
 [...line,line[0]].forEach(([x,z],i,all)=>{
  if(i)u+=Math.hypot(x-all[i-1][0],z-all[i-1][1])/pane;
  pos.push(x,y0,z,x,y1,z);uv.push(u,0,u,1);
  if(i){const b=2*i;index.push(b-2,b,b+1,b-2,b+1,b-1);}
 });
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(index);geo.computeVertexNormals();
 return geo;
}
/** Signed area in map x/z: positive means outward is to the right of the direction of travel. */
const areaXZ=(p:Pt[])=>p.reduce((a,[x,z],i)=>{const [u,v]=p[(i+1)%p.length];return a+x*v-u*z;},0)/2;
/**
 * A thin vertical strip through points (x, y, z), pushed `out` along the outward normal, with
 * u running in dots: the rope lights along the top and the wavy hem of a fin band.
 */
function stripGeometry(pts:{x:number;y:number;z:number}[],normal:(i:number)=>Pt,h:number){
 // One continuous ribbon: a bottom and a top vertex per point, shared by the quads either side.
 const pos:number[]=[],uv:number[]=[],index:number[]=[];let u=0;
 pts.forEach((a,i)=>{
  if(i)u+=Math.hypot(a.x-pts[i-1].x,a.z-pts[i-1].z)/GALLERIA.dot;
  const [nx,nz]=normal(i);pos.push(a.x+nx,a.y-h/2,a.z+nz,a.x+nx,a.y+h/2,a.z+nz);uv.push(u,0,u,1);
  if(i){const b=2*i;index.push(b-2,b,b+1,b-2,b+1,b-1);}
 });
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(index);geo.computeVertexNormals();
 return geo;
}
function canvasTexture(w:number,h:number,draw:(x:CanvasRenderingContext2D)=>void,repeat=true){
 const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d')!;draw(x);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;if(repeat){t.wrapS=t.wrapT=THREE.RepeatWrapping;}
 return t;
}
function signage(){
 const texture=canvasTexture(1024,160,x=>{x.fillStyle='#f7f7f0';x.textAlign='center';x.textBaseline='middle';x.font='700 112px -apple-system, "Helvetica Neue", Arial, sans-serif';x.fillText('ATLAS GALLERIA',512,86);},false);
 return {texture,material:new THREE.MeshBasicMaterial({map:texture,transparent:true,toneMapped:false,depthWrite:false,side:THREE.DoubleSide}),geometry:new THREE.PlaneGeometry(2.3,.36)};
}

/**
 * Atlas Galleria on the map. Static and lit by emissive material only: slabs, roof, glazing,
 * terrace planters, rope lights and the funnel canopy are one merged mesh each, fins are one
 * instanced mesh, and the forecourt and parking are two more. Terrace plants are part of the
 * map's own tree and bush lists, so they add no draw calls here.
 */
export function Galleria({plan:a,g,m,pick,night=false}:{plan?:GalleriaPlan;night?:boolean;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick}){
 const tex=useMemo(()=>({
  dots:canvasTexture(32,16,x=>{x.clearRect(0,0,32,16);x.fillStyle='#fff';x.beginPath();x.arc(16,8,6,0,Math.PI*2);x.fill();}),
  // Curtain wall: blue-grey panes, slim dark mullions, a transom, and a warm-lit interior band.
  pane:canvasTexture(64,128,x=>{const g=x.createLinearGradient(0,0,0,128);g.addColorStop(0,'#9fb8bd');g.addColorStop(.55,'#6f8f96');g.addColorStop(1,'#d8b98a');x.fillStyle=g;x.fillRect(0,0,64,128);x.fillStyle='#e9d3a6';x.fillRect(8,74,48,30);x.fillStyle='#3b4744';x.fillRect(0,0,4,128);x.fillRect(0,24,64,3);x.fillRect(0,124,64,4);}),
  paneGlow:canvasTexture(64,128,x=>{x.fillStyle='#ffd796';x.fillRect(0,0,64,128);x.fillStyle='#fff0c8';x.fillRect(8,74,48,30);x.fillStyle='#000';x.fillRect(0,0,4,128);x.fillRect(0,24,64,3);x.fillRect(0,124,64,4);}),
  // Solid white steel (KC, 2026-11-08), with the gridshell drawn as slightly darker ribs.
  lattice:canvasTexture(64,64,x=>{x.fillStyle='#f1f2ec';x.fillRect(0,0,64,64);x.strokeStyle='#c8cdc4';x.lineWidth=5;x.strokeRect(0,0,64,64);x.beginPath();x.moveTo(0,0);x.lineTo(64,64);x.stroke();}),
 }),[]);
 tex.lattice.repeat.set(18,6);
 const mats=useMemo(()=>({
  slab:new THREE.MeshStandardMaterial({color:'#f7f7f0',roughness:.7}),
  roof:new THREE.MeshStandardMaterial({color:'#d6d9d3',roughness:.85}),
  glass:new THREE.MeshStandardMaterial({color:'#ffffff',map:tex.pane,emissiveMap:tex.paneGlow,roughness:.2,metalness:.2,emissive:'#ffffff',emissiveIntensity:.06,side:THREE.DoubleSide}),
  planter:new THREE.MeshStandardMaterial({color:'#4f7a52',roughness:.95,side:THREE.DoubleSide}),
  lights:new THREE.MeshStandardMaterial({color:'#fff3d6',map:tex.dots,alphaTest:.5,emissive:'#ffd58a',emissiveMap:tex.dots,emissiveIntensity:0,side:THREE.DoubleSide}),
  funnel:new THREE.MeshStandardMaterial({color:'#ffffff',map:tex.lattice,roughness:.35,metalness:.15,emissive:'#ffe3a8',emissiveIntensity:0,side:THREE.DoubleSide}),
 }),[tex]);
 useEffect(()=>{
  mats.glass.emissiveIntensity=night?.55:.06;mats.glass.color.set(night?'#3a3226':'#ffffff');
  mats.lights.emissiveIntensity=night?2.2:0;mats.funnel.emissiveIntensity=night?.6:0;
 },[mats,night]);
 useEffect(()=>()=>{for(const x of Object.values(mats))x.dispose();for(const t of Object.values(tex))t.dispose();},[mats,tex]);
 const sign=useMemo(signage,[]);
 useEffect(()=>()=>{sign.texture.dispose();sign.material.dispose();sign.geometry.dispose();},[sign]);

 const geo=useMemo(()=>{
  if(!a)return;
  const G=GALLERIA,y0=a.y0,slabs:THREE.BufferGeometry[]=[],glass:THREE.BufferGeometry[]=[],planters:THREE.BufferGeometry[]=[],lights:THREE.BufferGeometry[]=[];
  // Ground floor plate, then Floors 1 and 2 with the atrium cut out; the roof is its own colour.
  slabs.push(slabGeometry(a.slabs[0],y0,.04));
  for(const l of [1,2])slabs.push(slabGeometry(a.slabs[l],y0+a.levels[l],G.slab,a.atrium));
  const canopyHole=Array.from({length:28},(_,i):Pt=>{const t=i/28*Math.PI*2;return [a.column.x+Math.cos(t)*a.column.r*.92,a.column.z+Math.sin(t)*a.column.r*.92];});
  const roof=slabGeometry(a.slabs[3],y0+a.roof,G.slab,canopyHole);
  for(let s=0;s<3;s++)glass.push(wallGeometry(a.glass[s],y0+a.levels[s]+(s?G.slab:0),y0+a.levels[s+1]));
  // Planter strip on each slab lip, inside the fin parapet: a soil top and its inner kerb, as two ribbons.
  for(const l of [1,2,3]){
   const edge=a.slabs[l],sign=areaXZ(edge)>0?1:-1,y=y0+a.levels[l]+G.slab;
   const off=(k:number)=>edge.map(([x,z],i):Pt=>{const [px,pz]=edge[(i-1+edge.length)%edge.length],[nx,nz]=edge[(i+1)%edge.length],dx=nx-px,dz=nz-pz,len=Math.hypot(dx,dz)||1;return [x-sign*dz/len*k,z+sign*dx/len*k];});
   const inner=off(.32),outer=off(.05),pos:number[]=[],index:number[]=[];
   [...inner.keys(),0].forEach((i,j)=>{pos.push(outer[i][0],y+.08,outer[i][1],inner[i][0],y+.08,inner[i][1],inner[i][0],y,inner[i][1]);if(j){const b=3*j;index.push(b-3,b,b+1,b-3,b+1,b-2,b-2,b+1,b+2,b-2,b+2,b-1);}});
   const ribbon=new THREE.BufferGeometry();ribbon.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));ribbon.setIndex(index);ribbon.computeVertexNormals();
   planters.push(ribbon);
  }
  // Rope lights: a row along the parapet and a row along the wavy hem of every band.
  const fins=galleriaFins(a);
  for(const l of [1,2,3]){
   const edge=a.slabs[l],sign=areaXZ(edge)>0?1:-1,band=fins.filter(f=>f.level===l);
   const normal=(i:number):Pt=>{const f=band[Math.min(i,band.length-1)];return [sign*Math.sin(f.a)*.045,-sign*Math.cos(f.a)*.045];};
   const loop=[...band,band[0]];
   lights.push(stripGeometry(loop.map(f=>({x:f.x,y:f.y+f.h-.03,z:f.z})),normal,G.lightH),stripGeometry(loop.map(f=>({x:f.x,y:f.y+.02,z:f.z})),normal,G.lightH));
  }
  // The funnel: a lattice stem flaring from a slender foot to the canopy just above the roof.
  const c=a.column,h=c.top,pts=Array.from({length:14},(_,i)=>{const t=i/13;return new THREE.Vector2(.08+(c.r-.08)*t**2.6,t*h);});
  const stem=new THREE.LatheGeometry(pts,24);stem.translate(c.x,y0,c.z);
  const disc=new THREE.CylinderGeometry(c.r+.04,c.r+.04,.03,24,1,true);disc.translate(c.x,y0+h,c.z);
  const cap=new THREE.CircleGeometry(c.r+.04,24);cap.rotateX(-Math.PI/2);cap.translate(c.x,y0+h+.015,c.z);
  const funnel=mergeGeometries([stem,disc,cap])!;
  for(const x of [stem,disc,cap])x.dispose();
  return {slabs:mergeGeometries(slabs)!,roof,glass:mergeGeometries(glass)!,planters:mergeGeometries(planters)!,lights:mergeGeometries(lights)!,funnel};
 },[a]);
 useEffect(()=>()=>{if(geo)for(const x of Object.values(geo))x.dispose();},[geo]);

 const parts=useMemo(()=>{
  const fins:Inst[]=[],boxes:Inst[]=[],rounds:Inst[]=[];if(!a)return {fins,boxes,rounds};
  for(const f of galleriaFins(a))fins.push({p:[f.x,f.y,f.z],s:[GALLERIA.finT,f.h,GALLERIA.finD],r:-f.a,c:'#f7f7f0'});
  for(const b of a.boxes)boxes.push({p:[b.x,a.y0+b.y,b.z],s:[b.w,b.h,b.d],r:b.r,c:b.c});
  for(const b of a.rounds)rounds.push({p:[b.x,a.y0+b.y,b.z],s:[b.w,b.h,b.d],c:b.c});
  return {fins,boxes,rounds};
 },[a]);

 if(!a||!geo)return null;
 const keys=(n:number)=>({...pick,keys:Array.from({length:n},()=>GALLERIA_KEY)});
 const click={onClick:(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();pick.click(GALLERIA_KEY,e);},onPointerOver:(e:ThreeEvent<PointerEvent>)=>{e.stopPropagation();pick.over(GALLERIA_KEY,e);},onPointerOut:()=>pick.out()};
 const [sx,sz]=a.toMap([1,18]);
 return <group name="atlas-galleria">
  <mesh geometry={geo.slabs} material={mats.slab} castShadow receiveShadow {...click}/>
  <mesh geometry={geo.roof} material={mats.roof} castShadow receiveShadow {...click}/>
  <mesh geometry={geo.glass} material={mats.glass} {...click}/>
  <mesh geometry={geo.planters} material={mats.planter} receiveShadow/>
  <mesh geometry={geo.lights} material={mats.lights}/>
  <mesh geometry={geo.funnel} material={mats.funnel} castShadow/>
  {/* Freestanding name at the forecourt, where the reference stands its big letters. */}
  <mesh position={[sx-.05,a.y0+.24,sz]} rotation={[0,Math.PI/2,0]} geometry={sign.geometry} material={sign.material}/>
  <Instanced items={parts.fins} geometry={g.box} material={m.plain} pick={keys(parts.fins.length)}/>
  <Instanced items={parts.boxes} geometry={g.box} material={m.plain} shadow={false}/>
  <Instanced items={parts.rounds} geometry={g.cyl} material={m.plain} shadow={false}/>
 </group>;
}
