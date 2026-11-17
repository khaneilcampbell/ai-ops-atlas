import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import * as THREE from 'three';
import {patterned} from '../map3d/materials';
import {HQ_COLORS as C} from '../map3d/atlasHqPlan';
import {HQ_INTERIOR as H,core,glassHeight,isPanel,isTall,shellOutline} from './atlasHqInteriorPlan';

/**
 * Atlas Command Center's floor shell, matching the corporate HQ outside: a cream stone slab, a
 * glass curtain wall with a white mullion at every outline point and a forest-green panel on every
 * eighth (the same points as the facade), a brass head rail and the stone lift core at the back.
 * A handful of merged meshes and two instanced sets per floor; no lights of its own.
 */
const MAT={
 glass:new THREE.MeshStandardMaterial({color:C.glass,transparent:true,opacity:.26,roughness:.08,metalness:.2,depthWrite:false,side:THREE.DoubleSide}),
 white:new THREE.MeshStandardMaterial({color:C.mullion,roughness:.35,metalness:.35}),
 brass:new THREE.MeshStandardMaterial({color:C.brass,roughness:.35,metalness:.7}),
 panel:new THREE.MeshStandardMaterial({color:C.green,roughness:.55,metalness:.2}),
 slab:patterned(C.stone,'stone',{roughness:.7}),
 core:new THREE.MeshStandardMaterial({color:C.stone,roughness:.85}),
};
const BOX=new THREE.BoxGeometry(1,1,1).translate(0,.5,0);

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

export default function AtlasHqShell({w,d,level}:{w:number;d:number;level:number;night?:boolean}){
 const pts=useMemo(()=>shellOutline(w,d),[w,d]);
 const top=useMemo(()=>(_x:number,i:number)=>isTall(i)?glassHeight(level):H.sill,[level]);
 const geo=useMemo(()=>({slab:plate(pts,-.004,.14),glass:panes(pts,()=>true,top)}),[pts,top]);
 // Floor-edge band along the top of the glass (a rail on the low glass).
 const bandGeo=useMemo(()=>{
  const pos:number[]=[],n=pts.length;
  for(let i=0;i<n;i++){
   const [ax,az]=pts[i],[bx,bz]=pts[(i+1)%n],ta=top(ax,i),tb=top(bx,i);
   pos.push(ax,ta,az,bx,tb,bz,bx,tb+.1,bz,ax,ta,az,bx,tb+.1,bz,ax,ta+.1,az);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return g;
 },[pts,top]);
 useEffect(()=>()=>{for(const g of Object.values(geo))g.dispose();bandGeo.dispose();},[geo,bandGeo]);

 const parts=useMemo(()=>{
  const mullions:Inst[]=[],panels:Inst[]=[],n=pts.length;
  pts.forEach(([x,z],i)=>{
   const h=Math.max(top(x,i),top(x,(i+n-1)%n));
   // The facade's green panels, on the same mullions as outside, turned to face out.
   if(isPanel(i)&&isTall(i))panels.push({p:[x,0,z],s:[.22,h,.12],r:Math.atan2(x,z)});
   else mullions.push({p:[x,0,z],s:[.05,h,.05]});
  });
  return {mullions,panels};
 },[pts,top]);
 const c=core(d);
 return <group>
  <mesh geometry={geo.slab} material={MAT.slab} receiveShadow/>
  <mesh geometry={geo.glass} material={MAT.glass}/>
  <mesh geometry={bandGeo} material={MAT.brass} castShadow/>
  <Instances items={parts.mullions} geometry={BOX} material={MAT.white}/>
  <Instances items={parts.panels} geometry={BOX} material={MAT.panel}/>
  <mesh geometry={BOX} material={MAT.core} position={[c.x,0,c.z]} scale={[c.w,glassHeight(level),c.depth]} castShadow receiveShadow/>
 </group>;
}
