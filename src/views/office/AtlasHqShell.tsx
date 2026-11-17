import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import * as THREE from 'three';
import {patterned} from '../map3d/materials';
import {glassTexture} from '../map3d/atlasHqTextures';
import {HQ_PALETTE as P} from '../map3d/atlasHqPalette';
import {HQ_INTERIOR as H,core,facadeBay,floorDoor,glassHeight,isGold,isTall,shellAxes,shellOutline,wallPieces} from './atlasHqInteriorPlan';

/**
 * Atlas Command Center's floor shell, matching the building on the map: a rounded slab in the
 * block's proportions, a curtain wall in the facade's own green glass (warm glass in the lobby)
 * with its window grid and spandrels at the same bay and storey, cream stone mullions, floor band
 * and lobby piers, a stone core at the back and a slim brass canopy over the lobby entrance.
 * A handful of merged meshes and two instanced sets per floor; no lights of its own.
 */
const MAT={
 blue:new THREE.MeshStandardMaterial({transparent:true,opacity:.8,roughness:.2,metalness:.18,depthWrite:false,side:THREE.DoubleSide,emissive:'#d6e4ff',emissiveIntensity:0}),
 gold:new THREE.MeshStandardMaterial({transparent:true,opacity:.82,roughness:.2,metalness:.18,depthWrite:false,side:THREE.DoubleSide,emissive:'#ffcf86',emissiveIntensity:0}),
 white:new THREE.MeshStandardMaterial({color:P.stone,roughness:.75,metalness:0}),
 fin:new THREE.MeshStandardMaterial({color:P.stone,roughness:.75,metalness:0}),
 slab:patterned('#e4e0d6','stone',{roughness:.7}),
 core:new THREE.MeshStandardMaterial({color:P.stoneShade,roughness:.85}),
 brass:new THREE.MeshStandardMaterial({color:P.brass,roughness:.36,metalness:.6}),
 clear:new THREE.MeshPhysicalMaterial({color:'#d8ecf2',transparent:true,opacity:.28,roughness:.08,metalness:.1,depthWrite:false}),
 mat:new THREE.MeshStandardMaterial({color:'#234937',roughness:.9}),
};
/** The facade's glass textures, the same ones the building wears outside, made once on first use. */
let facade=false;
function ensureFacadeGlass(){
 if(facade)return;facade=true;
 const blue=glassTexture(...P.towerGlass,11,P.mullion),gold=glassTexture('#e9dcb8','#fbf2dc','#d9ccb0',29,P.mullion);
 Object.assign(MAT.blue,{map:blue.map,emissiveMap:blue.glow});Object.assign(MAT.gold,{map:gold.map,emissiveMap:gold.glow});
 MAT.blue.needsUpdate=MAT.gold.needsUpdate=true;
}
const BOX=new THREE.BoxGeometry(1,1,1).translate(0,.5,0);

/** Vertical panes between outline points, each from y0 up to its own top. */
type Cut=(i:number)=>[[number,number],[number,number]][];
function panes(pts:[number,number][],keep:(i:number)=>boolean,top:(x:number,i:number)=>number,cut:Cut,y0=0){
 const pos:number[]=[],uv:number[]=[],n=pts.length;
 // UVs as on the tower: a mullion every bay along the wall, a spandrel at the head of each storey.
 const U=(d:number)=>d/(facadeBay*4),V=(y:number)=>y/(H.height*4);
 let run=0;
 for(let i=0;i<n;i++){
  const [ax,az]=pts[i],start=run;run+=Math.hypot(pts[(i+1)%n][0]-ax,pts[(i+1)%n][1]-az);
  if(!keep(i))continue;
  for(const [[px,pz],[bx,bz]] of cut(i)){
   const u0=U(start+Math.hypot(px-ax,pz-az)),u1=U(start+Math.hypot(bx-ax,bz-az)),ta=top(px,i),tb=top(bx,i);
   pos.push(px,y0,pz,bx,y0,bz,bx,tb,bz,px,y0,pz,bx,tb,bz,px,ta,pz);
   uv.push(u0,V(y0),u1,V(y0),u1,V(tb),u0,V(y0),u1,V(tb),u0,V(ta));
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}
/** A flat plate over a closed outline, top at y. */
function plate(pts:[number,number][],y:number,depth:number){
 const s=new THREE.Shape();s.moveTo(pts[0][0],-pts[0][1]);for(const [x,z] of pts.slice(1))s.lineTo(x,-z);s.closePath();
 const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);g.translate(0,y-depth,0);return g;
}

interface Inst{p:[number,number,number];s:[number,number,number];r?:number}
function Instances({items,geometry,material}:{items:Inst[];geometry:THREE.BufferGeometry;material:THREE.Material}){
 const ref=useRef<THREE.InstancedMesh>(null);
 useLayoutEffect(()=>{
  const m=ref.current;if(!m)return;const o=new THREE.Object3D();
  items.forEach((it,i)=>{o.position.set(...it.p);o.rotation.set(0,it.r??0,0);o.scale.set(...it.s);o.updateMatrix();m.setMatrixAt(i,o.matrix);});
  m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();
 },[items]);
 return items.length?<instancedMesh key={items.length} ref={ref} args={[geometry,material,items.length]} castShadow receiveShadow/>:null;
}

export default function AtlasHqShell({w,d,level,night}:{w:number;d:number;level:number;night:boolean}){
 ensureFacadeGlass();
 useEffect(()=>{MAT.blue.emissiveIntensity=night?.5:0;MAT.gold.emissiveIntensity=night?.7:0;},[night]);
 const pts=useMemo(()=>shellOutline(w,d),[w,d]);
 const top=useMemo(()=>(x:number,i:number)=>isTall(i)?glassHeight(x,level,w,d):H.sill,[level,w,d]);
 // Floors 1 to 4 leave the doorway out of the front glass; the lobby has its own entrance there.
 const cut=useMemo<Cut>(()=>(i:number)=>wallPieces(pts[i],pts[(i+1)%pts.length],level,w,d),[pts,level,w,d]);
 const geo=useMemo(()=>{
  const gold=(i:number)=>isGold(i,level);
  return {
   slab:plate(pts,-.004,.14),
   blue:panes(pts,i=>!gold(i),top,cut),
   gold:panes(pts,gold,top,cut),
   canopy:level===0?(()=>{
    // The slim brass canopy over the lobby doors, as outside.
    const {b}=shellAxes(w,d),L=2.2;
    return plate([[L,b-.3],[-L,b-.3],[-L,b+1.9],[L,b+1.9]],H.lobbyHeight-.6,.1);
   })():null,
  };
 },[pts,top,cut,level,w,d]);
 // Floor-edge band along the top of the glass (a rail on the low glass).
 const bandGeo=useMemo(()=>{
  const pos:number[]=[],n=pts.length;
  for(let i=0;i<n;i++)for(const [[ax,az],[bx,bz]] of cut(i)){
   const ta=top(ax,i),tb=top(bx,i);
   pos.push(ax,ta,az,bx,tb,bz,bx,tb+.1,bz,ax,ta,az,bx,tb+.1,bz,ax,ta+.1,az);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return g;
 },[pts,top,cut]);
 useEffect(()=>()=>{for(const g of Object.values(geo))g?.dispose();bandGeo.dispose();},[geo,bandGeo]);

 const parts=useMemo(()=>{
  const mullions:Inst[]=[],fins:Inst[]=[],n=pts.length;
  pts.forEach(([x,z],i)=>{
   const h=Math.max(top(x,i),top(x,(i+n-1)%n));
   // No mullion stands in a doorway.
   if(level===0||z<=0||Math.abs(x)>floorDoor(w,d).width/2+.12)mullions.push({p:[x,0,z],s:[.05,h,.05]});
   if(isGold(i,level)&&isTall(i)&&i%4===0){
    // Cream stone piers round the lobby, stood just inside the glass and turned to face out.
    const r=Math.atan2(x,z);
    fins.push({p:[x*.975,0,z*.975],s:[.035,h,.16],r});
   }
  });
  return {mullions,fins};
 },[pts,top,level,w,d]);
 const c=core(d);
 return <group>
  <mesh geometry={geo.slab} material={MAT.slab} receiveShadow/>
  <mesh geometry={geo.blue} material={MAT.blue}/>
  <mesh geometry={geo.gold} material={MAT.gold}/>
  <mesh geometry={bandGeo} material={MAT.white} castShadow/>
  <Instances items={parts.mullions} geometry={BOX} material={MAT.white}/>
  <Instances items={parts.fins} geometry={BOX} material={MAT.fin}/>
  <mesh geometry={BOX} material={MAT.core} position={[c.x,0,c.z]} scale={[c.w,glassHeight(0,level,w,d),c.depth]} castShadow receiveShadow/>
  {level>0&&<FloorDoor {...floorDoor(w,d)}/>}
  {geo.canopy&&<mesh geometry={geo.canopy} material={MAT.brass} castShadow receiveShadow/>}
 </group>;
}

/**
 * A floor's clear glass door: brass frame, two clear leaves parted to the sides and a green mat, so
 * the doorway reads as the way in from the lift corridor. Static, so no per-frame work.
 */
function FloorDoor({x,z,width,height}:{x:number;z:number;width:number;height:number}){
 return <group position={[x,0,z]}>
  {[-1,1].map(side=><mesh key={`j${side}`} geometry={BOX} material={MAT.brass} position={[side*(width/2+.06),0,0]} scale={[.1,height,.14]} castShadow/>)}
  <mesh geometry={BOX} material={MAT.brass} position={[0,height,0]} scale={[width+.22,.12,.16]}/>
  {[-1,1].map(side=><mesh key={`l${side}`} geometry={BOX} material={MAT.clear} position={[side*width*.47,.04,-.08]} scale={[width*.44,height-.1,.05]}/>)}
  <mesh geometry={BOX} material={MAT.mat} position={[0,0,-.55]} scale={[width,.02,.9]} receiveShadow/>
 </group>;
}
