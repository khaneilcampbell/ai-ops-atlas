import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import * as THREE from 'three';
import {patterned} from '../map3d/materials';
import {COMMERCE_INTERIOR as C,columns,commerceOutline,cores,glassTop,goldAt,groundFloor,type Item} from './commerceInteriorPlan';

/**
 * The wave tower's floor shell and ground floor, matching the tower outside: a teardrop slab, a
 * clear curtain wall with white mullions that turns gold where the ribbon wraps the storey, two
 * stone cores, and on the ground floor the bank hall from the reference plan (counter, tellers,
 * waiting seats, back office, client lounge, café, meeting room, vault, ATMs) on a column grid.
 * Merged and instanced boxes only; no lights of its own.
 */
const MAT={
 glass:new THREE.MeshStandardMaterial({color:'#bcd8dc',transparent:true,opacity:.28,roughness:.08,metalness:.2,depthWrite:false,side:THREE.DoubleSide,emissive:'#cfe6f2',emissiveIntensity:0}),
 gold:new THREE.MeshStandardMaterial({color:'#d6ad5e',transparent:true,opacity:.72,roughness:.25,metalness:.55,depthWrite:false,side:THREE.DoubleSide,emissive:'#ffcf86',emissiveIntensity:0}),
 white:new THREE.MeshStandardMaterial({color:'#eef1f2',roughness:.35,metalness:.35}),
 slab:patterned('#e6e2d8','stone',{roughness:.6}),
 core:new THREE.MeshStandardMaterial({color:'#d9cfbf',roughness:.85}),
 column:new THREE.MeshStandardMaterial({color:'#f1efe9',roughness:.5}),
 counter:new THREE.MeshStandardMaterial({color:'#efe9de',roughness:.4}),
 goldTrim:new THREE.MeshStandardMaterial({color:'#c9a45c',roughness:.3,metalness:.6}),
 wood:new THREE.MeshStandardMaterial({color:'#a77d55',roughness:.6}),
 fabric:new THREE.MeshStandardMaterial({color:'#8fa3b8',roughness:.9}),
 seat:new THREE.MeshStandardMaterial({color:'#5e6f7f',roughness:.85}),
 dark:new THREE.MeshStandardMaterial({color:'#2c3238',roughness:.5,metalness:.3,emissive:'#7fb6d8',emissiveIntensity:0}),
 steel:new THREE.MeshStandardMaterial({color:'#9aa3a8',roughness:.35,metalness:.7}),
 roomGlass:new THREE.MeshStandardMaterial({color:'#d8ecf2',transparent:true,opacity:.22,roughness:.08,depthWrite:false,side:THREE.DoubleSide}),
 leaf:new THREE.MeshStandardMaterial({color:'#6f9460',roughness:.9,flatShading:true}),
};
const BOX=new THREE.BoxGeometry(1,1,1).translate(0,.5,0);
const CYL=new THREE.CylinderGeometry(.5,.5,1,16).translate(0,.5,0);
const BALL=new THREE.IcosahedronGeometry(.5,1);

interface Inst{p:[number,number,number];s:[number,number,number];r?:number}
function Instances({items,geometry,material,shadow=true}:{items:Inst[];geometry:THREE.BufferGeometry;material:THREE.Material;shadow?:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null);
 useLayoutEffect(()=>{
  const m=ref.current;if(!m)return;const o=new THREE.Object3D();
  items.forEach((it,i)=>{o.position.set(...it.p);o.rotation.set(0,it.r??0,0);o.scale.set(...it.s);o.updateMatrix();m.setMatrixAt(i,o.matrix);});
  m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();
 },[items]);
 return items.length?<instancedMesh key={items.length} ref={ref} args={[geometry,material,items.length]} castShadow={shadow} receiveShadow/>:null;
}

function plate(pts:[number,number][],y:number,depth:number){
 const s=new THREE.Shape();s.moveTo(pts[0][0],-pts[0][1]);for(const [x,z] of pts.slice(1))s.lineTo(x,-z);s.closePath();
 const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:1});g.rotateX(-Math.PI/2);g.translate(0,y-depth,0);return g;
}
/** Wall panes between outline points (kept by `keep`), from the floor to `top`, leaving the doorway open. */
function panes(pts:[number,number][],keep:(i:number)=>boolean,top:number,door:{x:number;width:number}|null){
 const pos:number[]=[],n=pts.length;
 for(let i=0;i<n;i++){
  if(!keep(i))continue;
  const [ax,az]=pts[i],[bx,bz]=pts[(i+1)%n];
  // The doors: the front stretch either side of x=0 stays open on the lobby floor.
  if(door&&az>0&&bz>0&&Math.max(ax,bx)>door.x-door.width/2&&Math.min(ax,bx)<door.x+door.width/2)continue;
  pos.push(ax,0,az,bx,0,bz,bx,top,bz,ax,0,az,bx,top,bz,ax,top,az);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return g;
}

/** Boxes for each piece of ground-floor furniture, by material. */
function furniture(items:Item[]){
 const by:Record<string,Inst[]>={counter:[],goldTrim:[],wood:[],fabric:[],seat:[],dark:[],steel:[],roomGlass:[],white:[]};
 const box=(m:string,x:number,y:number,z:number,w:number,h:number,d:number,r=0)=>by[m].push({p:[x,y,z],s:[w,h,d],r});
 for(const it of items){const {x,z,w,d,h,r=0}=it;
  switch(it.kind){
   case 'counter':box('counter',x,0,z,w,h,d);box('goldTrim',x,h,z,w+.06,.05,d+.06);box('goldTrim',x,.08,z+d/2,w,.06,.02);break;
   case 'teller':box('dark',x,1.1,z,w,h,d);break;
   case 'stool':box('seat',x,0,z,w,h,d);break;
   case 'bench':box('seat',x,0,z,w,h,d);box('seat',x,h,z+d/2-.06,w,.4,.1);break;
   case 'desk':box('white',x,h-.04,z,w,.04,d,r);box('steel',x,0,z,.06,h-.04,.06,r);box('fabric',x,h,z,w*.04,.42,d,r);break;
   case 'sofa':box('fabric',x,0,z,w,.42,d);box('fabric',x+(it.back??1)*w*.35,.42,z,w*.3,h-.42,d);break;
   case 'table':box('wood',x,0,z,w,h,d);break;
   case 'meetingTable':box('wood',x,h-.05,z,w,.05,d);box('steel',x,0,z,.08,h-.05,.4);
    for(const s of [-1,1])for(let k=0;k<3;k++)box('seat',x-w/2+.35+k*(w-.7)/2,0,z+s*(d/2+.3),.45,.48,.45);break;
   case 'glassRoom':for(const [px,pz,sw,sd] of [[x,z-d/2,w,.04],[x,z+d/2,w,.04],[x-w/2,z,.04,d],[x+w/2,z,.04,d]] as const)box('roomGlass',px,0,pz,sw,h,sd);box('white',x,h,z,w,.06,d);break;
   case 'vault':box('steel',x,0,z,w,h,d);box('goldTrim',x,.9,z+d/2,.5,.5,.03);break;
   case 'atm':box('dark',x,0,z,w,h,d);box('counter',x,.95,z+d/2,w*.9,.32,.03);break;
   case 'reception':box('counter',x,0,z,w,h,d);box('goldTrim',x,h,z,w+.05,.05,d+.05);break;
   case 'cafeBar':box('wood',x,0,z,w,h,d);box('white',x,h,z,w+.1,.05,d+.1);break;
   case 'roundTable':case 'planter':case 'chair':case 'partition':case 'screen':break;
  }
 }
 return by;
}

export default function CommerceShell({w,d,level,night}:{w:number;d:number;level:number;night:boolean}){
 useEffect(()=>{MAT.glass.emissiveIntensity=night?.12:0;MAT.gold.emissiveIntensity=night?.6:0;MAT.dark.emissiveIntensity=night?.8:.25;},[night]);
 const pts=useMemo(()=>commerceOutline(w,d),[w,d]);
 const items=useMemo(()=>level===0?groundFloor(w,d):[],[w,d,level]);
 const geo=useMemo(()=>{
  const top=glassTop(level),door=level===0?{x:0,width:2.2}:null,gold=(i:number)=>goldAt(i,level,pts.length);
  // A white floor band along the head of the glass.
  const band=panes(pts,()=>true,.12,null);band.translate(0,top,0);
  return {slab:plate(pts,-.004,.14),glass:panes(pts,i=>!gold(i),top,door),gold:panes(pts,gold,top,door),band};
 },[pts,level]);
 useEffect(()=>()=>{for(const g of Object.values(geo))g?.dispose();},[geo]);
 const parts=useMemo(()=>{
  const top=glassTop(level),n=pts.length;
  const mullions:Inst[]=pts.filter((_,i)=>i%2===0).map(([x,z])=>({p:[x,0,z],s:[.05,top,.05]}));
  const cols:Inst[]=level===0?columns(w,d,items).map(([x,z])=>({p:[x,0,z],s:[C.columnR*2,top,C.columnR*2]})):[];
  // Round tables with four chairs, planters with a soft crown.
  const tables:Inst[]=[],chairs:Inst[]=[],pots:Inst[]=[],crowns:Inst[]=[];
  for(const it of items){
   if(it.kind==='roundTable'){tables.push({p:[it.x,0,it.z],s:[it.w,it.h,it.d]});for(let k=0;k<4;k++){const a=k*Math.PI/2;chairs.push({p:[it.x+Math.cos(a)*.62,0,it.z+Math.sin(a)*.62],s:[.36,.46,.36]});}}
   if(it.kind==='planter'){pots.push({p:[it.x,0,it.z],s:[it.w,it.h,it.d]});crowns.push({p:[it.x,it.h+.45,it.z],s:[1,1.1,1]});}
  }
  void n;return {mullions,cols,tables,chairs,pots,crowns,box:furniture(items)};
 },[pts,level,w,d,items]);
 const top=glassTop(level);
 return <group>
  <mesh geometry={geo.slab} material={MAT.slab} receiveShadow/>
  <mesh geometry={geo.glass} material={MAT.glass}/>
  <mesh geometry={geo.gold} material={MAT.gold}/>
  <mesh geometry={geo.band} material={MAT.white}/>
  <Instances items={parts.mullions} geometry={BOX} material={MAT.white} shadow={false}/>
  {cores(w,d).map((c,i)=><mesh key={i} geometry={BOX} material={MAT.core} position={[c.x,0,c.z]} scale={[c.w,top,c.d]} castShadow receiveShadow/>)}
  <Instances items={parts.cols} geometry={CYL} material={MAT.column}/>
  {Object.entries(parts.box).map(([m,list])=><Instances key={m} items={list} geometry={BOX} material={MAT[m as keyof typeof MAT]}/>)}
  <Instances items={parts.tables} geometry={CYL} material={MAT.white}/>
  <Instances items={parts.chairs} geometry={CYL} material={MAT.seat}/>
  <Instances items={parts.pots} geometry={CYL} material={MAT.core}/>
  <Instances items={parts.crowns} geometry={BALL} material={MAT.leaf}/>
 </group>;
}
