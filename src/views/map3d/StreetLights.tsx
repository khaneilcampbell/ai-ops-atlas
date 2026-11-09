import * as THREE from 'three';
import {useMemo,useEffect} from 'react';
import type {Scene3D} from './scene';
import {TERRACE_H} from './scene';
import {planStreetLights} from './streetLighting';
import {Instanced,type Inst,type useGeometries,type useMaterials} from './models';
export function StreetLights({scene,g,m,night}:{scene:Scene3D;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;night:boolean}){
 // The pool fades out from under the lamp instead of ending in a hard edge, so on a dark street it reads
 // as light, not as a grey oval painted on the road (KC, 2026-11-09). The cylinder's top cap maps its UVs radially.
 const glow=useMemo(()=>new THREE.MeshBasicMaterial({color:"#ffd18a",transparent:true,opacity:.2,alphaMap:poolFalloff(),depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),[]);
 useEffect(()=>()=>{glow.alphaMap?.dispose();glow.dispose();},[glow]);
 const parts=useMemo(()=>{const poles:Inst[]=[],heads:Inst[]=[],pools:Inst[]=[];for(const p of planStreetLights(scene)){
 if(p.highway)poles.push({p:[(p.x+p.roadX)/2,TERRACE_H-.08,(p.z+p.roadZ)/2],s:[.16,.12,Math.hypot(p.x-p.roadX,p.z-p.roadZ)+.12],r:p.yaw,c:'#7d8c81'});
 poles.push({p:[p.x,TERRACE_H+.04,p.z],s:[.045,p.height,.045],c:'#294237'},{p:[p.x,TERRACE_H+p.height,p.z],s:[.045,.04,.28],r:p.yaw,c:'#294237'},{p:[p.x,TERRACE_H+.04,p.z],s:[.1,.08,.1],c:'#b4ac8e'});
 heads.push({p:[p.x+Math.sin(p.yaw)*.21,TERRACE_H+p.height-.015,p.z+Math.cos(p.yaw)*.21],s:[.12,.045,.2],r:p.yaw,c:'#f6dfac'});
 pools.push({p:[p.roadX,TERRACE_H+.075,p.roadZ],s:[p.highway?2.2:1.4,.003,p.highway?1.05:.6],r:p.yaw,c:'#ffffff'});
 }return {poles,heads,pools};},[scene]);
 return <><Instanced items={parts.poles} geometry={g.box} material={m.plain}/><Instanced items={parts.heads} geometry={g.box} material={night?m.lamp:m.plain} shadow={false}/>{night&&<Instanced items={parts.pools} geometry={g.cyl} material={glow} shadow={false}/>}</>;
}
/** Radial falloff, bright at the centre and zero at the rim, for a light pool's alpha. */
export function poolFalloff(size=32){
 const data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const r=Math.min(1,Math.hypot(x+.5-size/2,y+.5-size/2)/(size/2)),v=Math.round(255*(1-r)*(1-r));data.set([v,v,v,255],(y*size+x)*4);}
 const t=new THREE.DataTexture(data,size,size);t.needsUpdate=true;return t;
}
