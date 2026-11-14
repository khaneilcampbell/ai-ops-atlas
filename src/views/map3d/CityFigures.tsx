import {useMemo,useRef} from 'react';
import * as THREE from 'three';
import type {useGeometries,useMaterials} from './models';
import {figureParts,hideGait,newGait,stepGait,type Gait} from './walkerFigure';

/** Trousers for the walking figures, picked by index. */
export const TROUSERS=['#2f3a44','#3b3530','#2c3b33'];

/**
 * The four instanced meshes of a crowd of little people with arms and legs (walkerFigure.ts), for every place in the city
 * that draws people walking or standing outside: one torso, one head, two legs and two arms each (Khaneil, 2026-11-13:
 * "give all people in Atlas arms and legs").
 */
export function useFigures(count:number){
 const torso=useRef<THREE.InstancedMesh>(null),head=useRef<THREE.InstancedMesh>(null),legs=useRef<THREE.InstancedMesh>(null),arms=useRef<THREE.InstancedMesh>(null);
 return useMemo(()=>{
  const gaits:Gait[]=[],m={torso:new THREE.Matrix4(),head:new THREE.Matrix4(),legs:[new THREE.Matrix4(),new THREE.Matrix4()] as [THREE.Matrix4,THREE.Matrix4],arms:[new THREE.Matrix4(),new THREE.Matrix4()] as [THREE.Matrix4,THREE.Matrix4]};
  const hidden=new THREE.Matrix4().makeScale(0,0,0).setPosition(0,-10,0);
  let last:number|undefined,dt=0;
  const f={
   torso,head,legs,arms,count,
   /** Start a placement at clock `t`: the stride advances by the time since the last one. */
   begin(t:number){dt=last===undefined?0:Math.max(0,t-last);last=t;},
   /** Person i standing at (x, y, z) facing yaw; `still` keeps the limbs at rest (riding a boat, waiting in a queue). */
   put(i:number,x:number,y:number,z:number,yaw:number,still=false){
    const g=gaits[i]??=newGait(),swing=still?0:stepGait(g,x,z,dt);if(still)hideGait(g);
    figureParts(x,y,z,yaw,swing,m);torso.current?.setMatrixAt(i,m.torso);head.current?.setMatrixAt(i,m.head);
    for(const k of [0,1]){legs.current?.setMatrixAt(i*2+k,m.legs[k]);arms.current?.setMatrixAt(i*2+k,m.arms[k]);}
   },
   hide(i:number){const g=gaits[i];if(g)hideGait(g);torso.current?.setMatrixAt(i,hidden);head.current?.setMatrixAt(i,hidden);for(const k of [0,1]){legs.current?.setMatrixAt(i*2+k,hidden);arms.current?.setMatrixAt(i*2+k,hidden);}},
   commit(){for(const r of [torso,head,legs,arms])if(r.current)r.current.instanceMatrix.needsUpdate=true;},
   /** Shirt (torso and sleeves), skin and trousers of person i. */
   color(i:number,shirt:string,skin:string,trousers=TROUSERS[i%TROUSERS.length]){
    const c=new THREE.Color();torso.current?.setColorAt(i,c.set(shirt));head.current?.setColorAt(i,c.set(skin));
    for(const k of [0,1]){arms.current?.setColorAt(i*2+k,c.set(shirt));legs.current?.setColorAt(i*2+k,c.set(trousers));}
   },
   colored(){for(const r of [torso,head,legs,arms])if(r.current?.instanceColor)r.current.instanceColor.needsUpdate=true;},
  };
  return f;
 },[count]);
}
export type Figures=ReturnType<typeof useFigures>;

/** The meshes for useFigures. `name` goes on the torsos, so screenshots and tests can find the crowd. */
export function FigureMeshes({f,g,m,name,shadow=true}:{f:Figures;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;name?:string;shadow?:boolean}){
 if(f.count<=0)return null;
 return <>
  <instancedMesh name={name} ref={f.torso} args={[g.box,m.plain,f.count]} castShadow={shadow} frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={f.head} args={[g.bead,m.plain,f.count]} frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={f.legs} args={[g.box,m.plain,f.count*2]} frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={f.arms} args={[g.box,m.plain,f.count*2]} frustumCulled={false} raycast={()=>null}/>
 </>;
}
