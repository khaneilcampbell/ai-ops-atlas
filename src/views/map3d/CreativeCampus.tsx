import {useEffect,useMemo} from 'react';
import type {ThreeEvent} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import {LAND_BOTTOM,LAND_TOP,TERRACE_H,WATER_Y} from './scene';
import {CAMPUS_KEY,type CreativeCampusPlan} from './creativeCampusPlan';
import {campusGeometry} from './creativeCampusGeometry';
import {packNormals} from './packGeometry';

type Paint=(g:CanvasRenderingContext2D,night:boolean)=>void;
/** A day map and a night emissive map from one painter, tiling as `repeat` (texture tiles per map unit). */
function painted(w:number,h:number,repeat:[number,number],paint:Paint){
 const make=(night:boolean)=>{const c=document.createElement('canvas');c.width=w;c.height=h;paint(c.getContext('2d')!,night);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(...repeat);t.anisotropy=8;return t;};
 return {map:make(false),glow:make(true)};
}
/** Seeded pane-to-pane variation, so lit windows and reflections differ without flickering between renders. */
const shade=(i:number)=>((Math.sin(i*12.9898+4.1)*43758.5453)%1+1)%1;

/**
 * Storey-tall glass behind the fins, one tile = 2 map units by one storey (canvas top = ceiling):
 * the white slab edge, a ceiling row with linear lights (the soffit samples it too), and eight panes
 * with mullions showing a lit room behind them: back wall, desks, screens and the odd plant.
 * By day the room is dimmed by reflection; at night some rooms are lit warm and some are dark.
 */
const paneMaps=(storey:number)=>painted(256,128,[1/2,1/storey],(g,night)=>{
 g.fillStyle=night?'#2a2420':'#5c6a72';g.fillRect(0,0,256,128);
 for(let i=0;i<8;i++){const x=i*32,k=shade(i),lit=k>.22;
  if(night){g.fillStyle=lit?`rgba(255,${196+Math.round(k*30)},${130+Math.round(k*50)},${.55+k*.45})`:'#1d1c22';g.fillRect(x,16,32,112);}
  else{const gr=g.createLinearGradient(0,16,0,128);gr.addColorStop(0,'#8a979d');gr.addColorStop(.55,'#66737a');gr.addColorStop(1,'#4b565c');g.fillStyle=gr;g.fillRect(x,16,32,112);
   g.fillStyle=`rgba(232,238,240,${.08+k*.14})`;g.beginPath();g.moveTo(x+6+k*8,128);g.lineTo(x+16+k*8,16);g.lineTo(x+22+k*8,16);g.lineTo(x+12+k*8,128);g.closePath();g.fill();}
  // Desk, screen and chair silhouettes, and a plant now and then.
  g.fillStyle=night?(lit?'rgba(70,52,40,.7)':'#141418'):'rgba(40,48,52,.55)';g.fillRect(x+5,96,22,5);g.fillRect(x+12,86,8,8);g.fillRect(x+7,101,3,14);g.fillRect(x+22,101,3,14);
  if(k>.7){g.fillStyle=night?'rgba(60,90,50,.8)':'rgba(70,110,70,.6)';g.beginPath();g.arc(x+26,108,5,0,Math.PI*2);g.fill();}
 }
 // Ceiling with linear lights, then the slab edge.
 g.fillStyle=night?'#fff1d6':'#d9dcd9';g.fillRect(0,10,256,6);g.fillStyle=night?'#fffaf0':'#f4f6f4';for(let x=4;x<256;x+=32)g.fillRect(x,12,22,2);
 g.fillStyle=night?'#0c0c0e':'#ecebe6';g.fillRect(0,0,256,10);g.fillStyle=night?'#000':'rgba(0,0,0,.25)';g.fillRect(0,9,256,1);
 g.fillStyle=night?'#0c0c0e':'#2b3237';for(let x=0;x<256;x+=32)g.fillRect(x,10,2,118);
});
/**
 * Deep red glass on the leaning end blocks, one tile = four panes (2.2 map units) by four storeys:
 * a crisp white mullion and slab grid, floor slabs showing through, and labs behind. The grid sits
 * off the tile edges, and the corner panes stay unlit, so the plain red skylight boxes (UV 0, 0) sample
 * dark glass. At night only some windows glow, some warmer than others; no wash over the whole block.
 */
const redMaps=(storey:number)=>painted(256,256,[1/2.2,1/(4*storey)],(g,night)=>{
 for(let cy=0;cy<4;cy++)for(let cx=0;cx<4;cx++){const x=cx*64,y=cy*64,k=shade(cx*5+cy*11+1),corner=(cx===0||cx===3)&&(cy===0||cy===3);
  if(night){g.fillStyle=!corner&&k>.5?`rgba(255,${120+Math.round(k*40)},${86+Math.round(k*30)},${.3+k*.35})`:'#2a0b0d';g.fillRect(x,y,64,64);}
  else{const gr=g.createLinearGradient(x,y,x+64,y+64);gr.addColorStop(0,'#a8423c');gr.addColorStop(.5,'#7c2427');gr.addColorStop(1,'#5a181b');g.fillStyle=gr;g.fillRect(x,y,64,64);
   g.fillStyle=`rgba(255,226,214,${.06+k*.12})`;g.beginPath();g.moveTo(x+8+k*10,y+64);g.lineTo(x+24+k*10,y);g.lineTo(x+34+k*10,y);g.lineTo(x+18+k*10,y+64);g.closePath();g.fill();}
  g.fillStyle=night?'rgba(40,12,12,.75)':'rgba(40,10,12,.45)';g.fillRect(x+10,y+48,30,4);g.fillRect(x+18,y+40,10,8);
 }
 // White slab bands with a shadow line under each, and white mullions, all clear of the tile edges.
 for(let y=28;y<256;y+=64){g.fillStyle=night?'#1a0808':'#d9cbc7';g.fillRect(0,y,256,4);g.fillStyle=night?'#000':'rgba(30,6,8,.5)';g.fillRect(0,y+4,256,2);}
 g.fillStyle=night?'#1a0808':'#e9dfdb';for(let x=31;x<256;x+=64)g.fillRect(x,0,2,256);
});
/**
 * The atrium drum, one tile = half a map unit of its rim by one storey (canvas bottom = floor): a
 * white gallery fascia, the red balustrade band, glass rail, and the bright galleries behind with
 * a mullion at each tile edge. The skylight's UVs sample the upper glass.
 */
const drumMaps=(storey:number)=>painted(64,128,[1/.5,1/storey],(g,night)=>{
 const gr=g.createLinearGradient(0,0,0,128);gr.addColorStop(0,night?'#ffe6bf':'#c9d7dc');gr.addColorStop(1,night?'#f2c48c':'#9fb0b7');g.fillStyle=gr;g.fillRect(0,0,64,128);
 g.fillStyle=night?'rgba(255,250,235,.9)':'rgba(255,255,255,.35)';g.fillRect(0,4,64,4);
 g.fillStyle=night?'rgba(120,80,50,.5)':'rgba(70,80,86,.35)';g.fillRect(10,70,18,6);g.fillRect(38,74,14,4);
 g.fillStyle=night?'#ffe9cc':'#d8e4e7';g.fillRect(0,92,64,10);
 g.fillStyle=night?'#d2464a':'#b52a2c';g.fillRect(0,102,64,12);
 g.fillStyle=night?'#fff6ea':'#f4f3ef';g.fillRect(0,114,64,14);
 g.fillStyle=night?'#3a2c22':'#4d5a60';g.fillRect(0,0,2,102);
});
/** Folded white panels: plain white with a joint at each storey and a soft shadow where a fin meets the wall.
 *  Every edge stays white, so the other white parts (UV 0, 0) render plain. */
function finMap(){
 const c=document.createElement('canvas');c.width=64;c.height=64;const g=c.getContext('2d')!;
 g.fillStyle='#fff';g.fillRect(0,0,64,64);
 const ao=g.createLinearGradient(3,0,24,0);ao.addColorStop(0,'#cfccc4');ao.addColorStop(1,'#ffffff');g.fillStyle=ao;g.fillRect(3,3,21,58);
 g.fillStyle='#bdb9b0';g.fillRect(3,31,58,2);g.fillStyle='#e4e1da';g.fillRect(58,3,3,58);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;return t;
}
/** A soft sky for reflections in the glass: blue overhead, pale at the horizon, green-grey ground. */
function skyEnv(){
 const c=document.createElement('canvas');c.width=256;c.height=128;const g=c.getContext('2d')!;
 const gr=g.createLinearGradient(0,0,0,128);gr.addColorStop(0,'#5f8fc0');gr.addColorStop(.42,'#c6daea');gr.addColorStop(.5,'#eef2f2');gr.addColorStop(.56,'#9aa592');gr.addColorStop(1,'#59654f');
 g.fillStyle=gr;g.fillRect(0,0,256,128);g.fillStyle='rgba(255,255,255,.35)';for(const [x,y,r] of [[40,28,14],[150,36,18],[210,22,10]] as const){g.beginPath();g.ellipse(x,y,r*2,r*.6,0,0,Math.PI*2);g.fill();}
 const t=new THREE.CanvasTexture(c);t.mapping=THREE.EquirectangularReflectionMapping;t.colorSpace=THREE.SRGBColorSpace;return t;
}

const noRaycast=()=>null;
const slab=(r:{x:number;z:number;w:number;d:number},y0:number,y1:number):Inst=>({p:[r.x+r.w/2,y0,r.z+r.d/2],s:[r.w,y1-y0,r.d]});
const grow=(r:{x:number;z:number;w:number;d:number},k:number)=>({x:r.x-k,z:r.z-k,w:r.w+2*k,d:r.d+2*k});

/**
 * Atlas Creative Campus and its island (creativeCampusPlan.ts). The island's land, beach and surf use
 * the city's own terrain materials and instance pools; the building and grounds are seven merged meshes
 * with no lights of their own. Detail is painted into textures (glass panes, red mullion grid, atrium
 * galleries, fin joints) and the glass reflects a soft sky; night only raises the emissive maps.
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
  const pane=paneMaps(.56),red=redMaps(.56),drum=drumMaps(.56),fin=finMap(),env=skyEnv();
  return {
   textures:[pane.map,pane.glow,red.map,red.glow,drum.map,drum.glow,fin,env],
   white:new THREE.MeshStandardMaterial({color:'#f4f3ef',map:fin,roughness:.5,metalness:.02,side:THREE.DoubleSide}),
   inner:new THREE.MeshStandardMaterial({map:pane.map,emissiveMap:pane.glow,emissive:'#ffffff',emissiveIntensity:0,envMap:env,roughness:.12,metalness:.35}),
   red:new THREE.MeshStandardMaterial({map:red.map,emissiveMap:red.glow,emissive:'#ffffff',emissiveIntensity:0,envMap:env,roughness:.12,metalness:.3,side:THREE.DoubleSide}),
   ribbon:new THREE.MeshStandardMaterial({color:'#b52a2c',roughness:.45,metalness:.05,emissive:'#ff5a4a',emissiveIntensity:0}),
   atrium:new THREE.MeshStandardMaterial({map:drum.map,emissiveMap:drum.glow,emissive:'#ffffff',emissiveIntensity:0,envMap:env,roughness:.1,metalness:.25,side:THREE.DoubleSide}),
   ground:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0}),
  };
 },[]);
 useEffect(()=>{
  // Night: rooms, labs and galleries light from inside; the sky reflection dims.
  mats.inner.emissiveIntensity=night?1:0;mats.red.emissiveIntensity=night?.6:0;mats.ribbon.emissiveIntensity=night?.18:0;mats.atrium.emissiveIntensity=night?.9:0;
  for(const k of ['inner','red','atrium'] as const){mats[k].envMapIntensity=night?.18:1;}
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
