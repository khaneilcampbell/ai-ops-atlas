import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type useGeometries,type useMaterials} from './models';
import type {Scene3D} from './scene';
/** Decorative Atlas airship and two occupied balloons. No relationship to live worker activity. */
export function SkyBalloons({scene,g,m,moving}:{scene:Scene3D;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;moving:boolean}){
 const blimp=useRef<THREE.Group>(null),balloons=useRef<THREE.Group>(null),clock=useRef(0);
 const logo=useMemo(()=>{
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=160;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#f4ead1';ctx.fillRect(0,0,512,160);
  ctx.strokeStyle='#c9a35a';ctx.lineWidth=8;ctx.strokeRect(4,4,504,152);
  ctx.fillStyle='#294237';ctx.font='bold 108px Georgia, serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Atlas',256,85);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return {texture,material:new THREE.MeshBasicMaterial({map:texture}),geometry:new THREE.PlaneGeometry(2.6,.72)};
 },[]);
 useEffect(()=>()=>{logo.texture.dispose();logo.material.dispose();logo.geometry.dispose();},[logo]);
 const airship=useMemo<{hull:Inst[];trim:Inst[]}>(()=>({hull:[{p:[0,0,0],s:[2.4,.78,.78],c:'#e6dfcb'},{p:[-.2,-.22,0],s:[1.9,.46,.79],c:'#294237'}],trim:[{p:[0,-1.05,0],s:[.9,.3,.45],c:'#294237'},{p:[0,-1.08,.24],s:[.65,.2,.025],c:'#a9c4c7'},{p:[-1.8,-.12,0],s:[.65,.9,.065],c:'#294237'},{p:[-1.8,0,0],s:[.7,.06,1.65],c:'#c9a35a'},{p:[-.6,-.6,0],s:[.05,.5,.05],c:'#c9a35a'},{p:[.6,-.6,0],s:[.05,.5,.05],c:'#c9a35a'}]}),[]);
 const parts=useMemo(()=>{
  const shells:Inst[]=[],solid:Inst[]=[],heads:Inst[]=[];
  for(let i=0;i<2;i++){
   const x=i*3.4,z=i*1.8;
   shells.push({p:[x,0,z],s:[.85,1.1,.85],c:i?'#c9a35a':'#294237'},{p:[x,0,z],s:[.42,1.115,.86],c:i?'#294237':'#c9a35a'});
   solid.push({p:[x,-1.7,z],s:[.56,.12,.44],c:'#9e7049'});
   for(const side of [-1,1]){
    solid.push({p:[x+side*.27,-1.59,z],s:[.035,.15,.44],c:'#b58b5c'},{p:[x,-1.59,z+side*.205],s:[.56,.15,.035],c:'#b58b5c'});
    for(const dz of [-.17,.17])solid.push({p:[x+side*.23,-1.59,z+dz],s:[.025,.85,.025],c:'#d6c7a6'});
    solid.push({p:[x+side*.13,-1.56,z],s:[.12,.24,.12],c:side<0?'#356386':'#b8735a'});
    heads.push({p:[x+side*.13,-1.24,z],s:[.08,.08,.08],c:side<0?'#caa47b':'#866143'});
   }
  }
  return {shells,solid,heads};
 },[]);
 useFrame((_,dt)=>{
  if(moving)clock.current+=Math.min(dt,.1);
  const b=scene.bounds,cx=(b.x0+b.x1)/2,cz=(b.z0+b.z1)/2,t=clock.current*.012-Math.PI/2;
  if(blimp.current){blimp.current.position.set(cx+Math.cos(t)*(b.x1-b.x0)*.35,12.5,cz+Math.sin(t)*(b.z1-b.z0)*.35);blimp.current.rotation.y=Math.atan2(-Math.cos(t)*(b.z1-b.z0),-Math.sin(t)*(b.x1-b.x0));}
  if(balloons.current)balloons.current.position.set(cx-(b.x1-b.x0)*.18+Math.sin(t)*1.2,11+Math.sin(t*.7)*.2,cz-(b.z1-b.z0)*.2+Math.cos(t)*1.2);
 });
 return <><group ref={blimp}><Instanced items={airship.hull} geometry={g.ball} material={m.plain}/><Instanced items={airship.trim} geometry={g.box} material={m.plain}/>{[-1,1].map(side=><mesh key={side} position={[0,0,side*.79]} rotation={[0,side<0?Math.PI:0,0]} geometry={logo.geometry} material={logo.material} raycast={()=>null}/>)}</group><group ref={balloons}><Instanced items={parts.shells} geometry={g.ball} material={m.plain}/><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.heads} geometry={g.ball} material={m.plain}/></group></>;
}
