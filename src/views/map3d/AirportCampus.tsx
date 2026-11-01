import {useMemo,useEffect} from 'react';
import * as THREE from 'three';
import {AIRPORT_BUILDINGS,AIRPORT_STOREY_SCALE as S,airportBuildingKey} from './airportBuildings';
import {type AirportPlan} from './airport';
import {TERRACE_H} from './scene';
import {ATLAS_HQ_COLORS as HQ} from './airportPalette';
import {Instanced,type Inst,type useMaterials,type useGeometries,type Pick} from './models';
/** Static campus detail shares one set of instanced buffers and a faceted hangar roof. */
export default function AirportCampus({a,g,m,pick,night}:{a:AirportPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night:boolean}){
 // Atlas HQ's family colours: cool white metal, deep blue trim, gold, blue glass and roofs.
 const palette=useMemo(()=>({white:HQ.white,green:HQ.glassDeep,gold:HQ.gold,blue:HQ.glass}),[]);
 const resources=useMemo(()=>{const s=new THREE.Shape();s.moveTo(-.5,0);for(let i=0;i<=12;i++){const t=Math.PI-i*Math.PI/12;s.lineTo(Math.cos(t)*.5,Math.sin(t)*.8)}s.lineTo(.5,0);s.closePath();const roof=new THREE.ExtrudeGeometry(s,{depth:1,bevelEnabled:false,steps:1});const material=new THREE.MeshStandardMaterial({color:palette.blue,flatShading:true,roughness:.8});const windows=new THREE.MeshStandardMaterial({color:palette.blue,emissive:'#f4d496',emissiveIntensity:0,roughness:.4});const river=new THREE.BufferGeometry();const v:number[]=[];const edge=(z:number,side:number)=>[24+.35*Math.sin(z*.14)+side*.675,0,z];for(let z=-13;z<25;z+=.5){const a=edge(z,-1),b=edge(z,1),c=edge(z+.5,-1),d=edge(z+.5,1);v.push(...a,...c,...b,...b,...c,...d)}river.setAttribute('position',new THREE.Float32BufferAttribute(v,3));river.computeVertexNormals();const water=new THREE.MeshStandardMaterial({color:'#83bdca',roughness:.8,side:THREE.DoubleSide});const hit=new THREE.MeshBasicMaterial({visible:false});return {roof,material,windows,hit,river,water}},[palette]);
 useEffect(()=>{resources.windows.color.set(night?'#f9d99a':palette.blue);resources.windows.emissiveIntensity=night?1.1:0},[night,resources,palette]);
 useEffect(()=>()=>{resources.roof.dispose();resources.material.dispose();resources.windows.dispose();resources.hit.dispose();resources.river.dispose();resources.water.dispose()},[resources]);
 const parts=useMemo(()=>{const walls:Inst[]=[],glass:Inst[]=[],trees:Inst[]=[],trunks:Inst[]=[],keys:string[]=[],hits:Inst[]=[];
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[a.x+x,TERRACE_H+y,a.z+z],s:[w,h,d],c});
 for(const b of AIRPORT_BUILDINGS){hits.push(box(b.x,0,b.z,b.w,b.h,b.d,palette.white));keys.push(airportBuildingKey(b.id));if(b.kind==='terminal'||b.kind==='tower')continue;
  walls.push(box(b.x,0,b.z,b.w,b.kind==='hangar'?1.4*S:b.h,b.d,palette.white));
  if(b.kind==='office'){
   // Atlas HQ language: blue glass curtain wall in floor bands, white slabs and fins, gold crown, grey plant.
   walls.push(box(b.x,b.h,b.z,b.w+.12,.08,b.d+.12,palette.white),box(b.x,b.h-.14,b.z,b.w+.06,.14,b.d+.06,palette.gold),box(b.x,b.h+.08,b.z,.85,.26,.9,HQ.roof));
   for(let y=.3;y<b.h-.35;y+=.5){
    const band=Math.min(.4,b.h-.2-y);
    for(const side of [-1,1])glass.push(box(b.x,y,b.z+side*(b.d/2+.012),b.w-.08,band,.02,'#ffffff'),box(b.x+side*(b.w/2+.012),y,b.z,.02,band,b.d-.08,'#ffffff'));
   }
   for(let x=-b.w/2+.2;x<=b.w/2-.15;x+=.4)for(const side of [-1,1])walls.push(box(b.x+x,.25,b.z+side*(b.d/2+.03),.035,b.h-.4,.05,HQ.fin));
   for(let z=-b.d/2+.2;z<=b.d/2-.15;z+=.4)for(const side of [-1,1])walls.push(box(b.x+side*(b.w/2+.03),.25,b.z+z,.05,b.h-.4,.035,HQ.fin));
   // Glass lobby under a gold-edged canopy.
   walls.push(box(b.x,.6,b.z+b.d/2+.3,1.3,.05,.6,palette.white),box(b.x,.58,b.z+b.d/2+.6,1.3,.06,.03,HQ.goldDeep));
  }else{glass.push(box(b.x,.1,b.z+b.d/2+.02,b.w*.82,1.2*S,.035,'#ffffff'));walls.push(box(b.x,1.32*S,b.z+b.d/2+.035,b.w*.92,.06,.05,HQ.goldDeep));}
  if(b.kind==='hangar'){const front=b.z+b.d/2+1.4;walls.push(box((b.x+21.8)/2,0,front,21.8-b.x+.35,.055,.35,'#e5dfce'));}
  if(b.kind==='office'){const side=b.x+b.w/2+.45,front=b.z+b.d/2+.65;walls.push(box((b.x+side)/2,0,front,side-b.x+.35,.055,.35,'#e5dfce'),box(side,0,(front-13.98)/2,.35,.055,front+13.98,'#e5dfce'));}
  walls.push(box(b.x,0,b.z+b.d/2+.8,.48,.055,1.6,'#e5dfce'),box(b.x,.05,b.z+b.d/2+.025,.35,.65,.04,palette.green));
 }
 // Public north access and an outer service loop remain beyond both runway thresholds.
 walls.push(box(10.4,0,-13.98,24.4,.055,.4,'#e5dfce'));
 walls.push(box(10.4,.025,-14.5,24.4,.035,.64,'#727c7e'),box(-1.5,.025,-11,.64,.035,7,'#727c7e'),box(22.3,.025,5.25,.64,.035,39.5,'#727c7e'),box(13.3,.025,25,18,.035,.64,'#727c7e'),box(4.3,.025,21.5,.64,.035,7,'#727c7e'));
 for(let x=-1;x<22;x+=1.3)walls.push(box(x,.065,-14.5,.6,.008,.035,'#ffffff'));
 for(let z=-11;z<25;z+=2.8){for(const x of [-.8,21.6]){if(AIRPORT_BUILDINGS.some(b=>Math.abs(x-b.x)<b.w/2+.5&&Math.abs(z-b.z)<b.d/2+.5)||(x<3.5&&z>-8.5&&z<-4.3))continue;trunks.push(box(x,0,z,.07,.35,.07,'#786f53'));trees.push(box(x,.3,z,.55,.65,.55,'#719d77'))}}
 // A shallow river bend occupies the outer strip, away from road and bridge landings.

 return {walls,glass,trees,trunks,hits,keys};},[a,palette]);
 return <><mesh position={[a.x,TERRACE_H+.045,a.z]} geometry={resources.river} material={resources.water}/><Instanced items={parts.walls} geometry={g.box} material={m.plain}/><Instanced items={parts.glass} geometry={g.box} material={resources.windows}/><Instanced items={parts.trunks} geometry={g.box} material={m.plain}/><Instanced items={parts.trees} geometry={g.ball} material={m.plain}/>{AIRPORT_BUILDINGS.filter(b=>b.kind==='hangar').map(b=><mesh key={b.id} position={[a.x+b.x,TERRACE_H+1.4*S,a.z+b.z-b.d/2]} scale={[b.w,.9*S,b.d]} geometry={resources.roof} material={resources.material} castShadow receiveShadow/>)}<Instanced items={parts.hits} geometry={g.box} material={resources.hit} pick={{...pick,keys:parts.keys}}/></>;
}
