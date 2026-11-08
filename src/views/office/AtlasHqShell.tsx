import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import * as THREE from 'three';
import {patterned} from '../map3d/materials';
import {HQ_INTERIOR as H,core,glassHeight,isGold,isTall,shellOutline,terrace} from './atlasHqInteriorPlan';

/**
 * Atlas HQ's floor shell, matching the curving glass tower outside: a rounded slab, a glass
 * curtain wall with white mullions (blue glass, gold where the wing wraps this floor), a gold fin
 * screen behind the gold glass, a stone core at the back and, on Floor 3, the podium roof garden.
 * A handful of merged meshes and two instanced sets per floor; no lights of its own.
 */
const MAT={
 blue:new THREE.MeshStandardMaterial({color:'#9cc4e0',transparent:true,opacity:.24,roughness:.08,metalness:.2,depthWrite:false,side:THREE.DoubleSide}),
 gold:new THREE.MeshStandardMaterial({color:'#e8c98c',transparent:true,opacity:.34,roughness:.1,metalness:.3,depthWrite:false,side:THREE.DoubleSide,emissive:'#ffcf86',emissiveIntensity:0}),
 white:new THREE.MeshStandardMaterial({color:'#eef1f2',roughness:.35,metalness:.35}),
 fin:new THREE.MeshStandardMaterial({color:'#d9b778',roughness:.35,metalness:.55}),
 slab:patterned('#e4e0d6','stone',{roughness:.7}),
 core:new THREE.MeshStandardMaterial({color:'#cfc8ba',roughness:.85}),
 lawn:patterned('#8fae6a','grass'),
 pool:new THREE.MeshStandardMaterial({color:'#6fb7c9',roughness:.1,metalness:.1,emissive:'#3d7f99',emissiveIntensity:0}),
 trunk:new THREE.MeshStandardMaterial({color:'#6d5a45',roughness:.9}),
 olive:new THREE.MeshStandardMaterial({color:'#8fa37f',roughness:.9,flatShading:true}),
 rail:new THREE.MeshStandardMaterial({color:'#cfe6f2',transparent:true,opacity:.3,depthWrite:false,roughness:.1}),
};
const BOX=new THREE.BoxGeometry(1,1,1).translate(0,.5,0);
const CROWN=new THREE.IcosahedronGeometry(.5,1);

/** Vertical panes between outline points, each from y0 up to its own top. */
function panes(pts:[number,number][],keep:(i:number)=>boolean,top:(x:number,i:number)=>number,y0=0){
 const pos:number[]=[],n=pts.length;
 for(let i=0;i<n;i++){
  if(!keep(i))continue;
  const [ax,az]=pts[i],[bx,bz]=pts[(i+1)%n],ta=top(ax,i),tb=top(bx,i);
  pos.push(ax,y0,az,bx,y0,bz,bx,tb,bz,ax,y0,az,bx,tb,bz,ax,ta,az);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return g;
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
 useEffect(()=>{MAT.gold.emissiveIntensity=night?.35:0;MAT.pool.emissiveIntensity=night?.6:0;},[night]);
 const pts=useMemo(()=>shellOutline(w,d),[w,d]);
 const top=useMemo(()=>(x:number,i:number)=>isTall(i)?glassHeight(x,level,w,d):H.sill,[level,w,d]);
 const geo=useMemo(()=>{
  const gold=(i:number)=>isGold(i,level);
  const T=terrace(w,d);
  return {
   slab:plate(pts,-.004,.14),
   blue:panes(pts,i=>!gold(i),top),
   gold:panes(pts,gold,top),
   terrace:level===H.terraceFloor?plate([[T.x0,T.z0],[T.x1,T.z0],[T.x1,T.z1],[T.x0,T.z1]],-.004,.3):null,
   lawn:level===H.terraceFloor?plate([[T.x0+.25,T.z0+.25],[T.x1-.25,T.z0+.25],[T.x1-.25,T.z1-.25],[T.x0+.25,T.z1-.25]],.02,.02):null,
   pool:level===H.terraceFloor?(()=>{const g=new THREE.CylinderGeometry(1,1,.03,32);g.scale(T.pool.rx,1,T.pool.rz);g.translate(T.pool.x,.035,T.pool.z);return g;})():null,
  };
 },[pts,top,level,w,d]);
 // Floor-edge band along the top of the glass (a rail on the low glass).
 const bandGeo=useMemo(()=>{
  const pos:number[]=[],n=pts.length;
  for(let i=0;i<n;i++){
   const [ax,az]=pts[i],[bx,bz]=pts[(i+1)%n],ta=top(ax,i),tb=top(bx,i);
   pos.push(ax,ta,az,bx,tb,bz,bx,tb+.1,bz,ax,ta,az,bx,tb+.1,bz,ax,ta+.1,az);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return g;
 },[pts,top]);
 useEffect(()=>()=>{for(const g of Object.values(geo))g?.dispose();bandGeo.dispose();},[geo,bandGeo]);

 const parts=useMemo(()=>{
  const mullions:Inst[]=[],fins:Inst[]=[],n=pts.length;
  pts.forEach(([x,z],i)=>{
   const h=Math.max(top(x,i),top(x,(i+n-1)%n));
   mullions.push({p:[x,0,z],s:[.05,h,.05]});
   if(isGold(i,level)&&isTall(i)){
    // The wing's gold fins, stood just inside the glass and turned to face out.
    const r=Math.atan2(x,z);
    fins.push({p:[x*.975,0,z*.975],s:[.035,h,.16],r});
   }
  });
  const T=terrace(w,d),trees:Inst[]=[],crowns:Inst[]=[],rails:Inst[]=[];
  if(level===H.terraceFloor){
   for(const [x,z] of T.trees){trees.push({p:[x,0,z],s:[.09,.75,.09]});crowns.push({p:[x,.95,z],s:[.95,.55,.85]});}
   rails.push({p:[T.x1,0,(T.z0+T.z1)/2],s:[.04,.9,T.z1-T.z0]},{p:[(T.x0+T.x1)/2+.3,0,T.z0],s:[T.x1-T.x0-.6,.9,.04]},{p:[(T.x0+T.x1)/2+.3,0,T.z1],s:[T.x1-T.x0-.6,.9,.04]});
  }
  return {mullions,fins,trees,crowns,rails};
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
  {geo.terrace&&<mesh geometry={geo.terrace} material={MAT.slab} receiveShadow/>}
  {geo.lawn&&<mesh geometry={geo.lawn} material={MAT.lawn} receiveShadow/>}
  {geo.pool&&<mesh geometry={geo.pool} material={MAT.pool}/>}
  <Instances items={parts.trees} geometry={BOX} material={MAT.trunk}/>
  <Instances items={parts.crowns} geometry={CROWN} material={MAT.olive}/>
  <Instances items={parts.rails} geometry={BOX} material={MAT.rail}/>
 </group>;
}
