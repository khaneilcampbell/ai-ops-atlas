import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type useGeometries,type useMaterials} from './models';
import {TERRACE_H,type Scene3D} from './scene';
import {flightClearance,decorativeAerialHeights} from './flightClearance';
/** Decorative Atlas airship. No relationship to live worker activity. The hot air balloons were removed at Khaneil's request. */
export function SkyBalloons({scene,g,m,moving}:{scene:Scene3D;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;moving:boolean}){
 const blimp=useRef<THREE.Group>(null),clock=useRef(0);
 const safeHeights=useMemo(()=>decorativeAerialHeights(flightClearance(scene).altitude),[scene]);
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
 useFrame((_,dt)=>{
  if(moving)clock.current+=Math.min(dt,.1);
  const b=scene.bounds,cx=(b.x0+b.x1)/2,cz=(b.z0+b.z1)/2,t=clock.current*.012-Math.PI/2;
  if(blimp.current){blimp.current.position.set(cx+Math.cos(t)*(b.x1-b.x0)*.35,TERRACE_H+safeHeights.airship,cz+Math.sin(t)*(b.z1-b.z0)*.35);blimp.current.rotation.y=Math.atan2(-Math.cos(t)*(b.z1-b.z0),-Math.sin(t)*(b.x1-b.x0));}
 });
 return <><group ref={blimp}><Instanced items={airship.hull} geometry={g.ball} material={m.plain}/><Instanced items={airship.trim} geometry={g.box} material={m.plain}/>{[-1,1].map(side=><mesh key={side} position={[0,0,side*.79]} rotation={[0,side<0?Math.PI:0,0]} geometry={logo.geometry} material={logo.material} raycast={()=>null}/>)}</group></>;
}
