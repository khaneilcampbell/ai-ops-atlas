import * as THREE from 'three';
import {stadiumFloodPositions} from './streetLighting';
import {useMemo} from "react";
import {TERRACE_H} from "./scene";
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from "./models";
export {STADIUM_KEY,planStadium} from "./stadiumPlan";
import {STADIUM_KEY,type StadiumPlan} from "./stadiumPlan";
/** Static instanced bowl: shared geometry, no assets or animation loop. */
export function Stadium({plan:a,g,m,pick,night=false}:{night?:boolean;plan?:StadiumPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick}) {
  const target=useMemo(()=>{const t=new THREE.Object3D();if(a)t.position.set(a.x+4,TERRACE_H+.12,a.z+3.5);return t;},[a]);
  const parts=useMemo(()=>{
    if(!a)return [];
    const y=TERRACE_H,cx=a.x+4,cz=a.z+3.5;
    const box=(x:number,h:number,z:number,w:number,t:number,d:number,c:string):Inst=>({p:[x,h,z],s:[w,t,d],c});
    const out:Inst[]=[box(cx,y,cz,7.5,.06,6.5,"#d7cdb6"),box(cx,y+.065,cz,3.3,.03,4.3,"#356c45")];
    // Three stepped seating tiers with silver horizontal louvers, inspired by MetLife.
    for(let tier=0;tier<3;tier++)for(let i=0;i<40;i++){
      const angle=i*Math.PI*2/40,rx=2.05+tier*.38,rz=2.45+tier*.3;
      out.push({p:[cx+Math.cos(angle)*rx,y+.1+tier*.38,cz+Math.sin(angle)*rz],s:[.6,.38,.6],r:-angle,c:tier===1?"#405c55":"#758d89"});
      out.push({p:[cx+Math.cos(angle)*(rx+.16),y+.35+tier*.38,cz+Math.sin(angle)*(rz+.16)],s:[.65,.06,.35],r:-angle,c:"#c7d0cd"});
    }
    for(let i=0;i<11;i++)out.push(box(cx,y+.1,cz-1.95+i*.39,3,.012,.025,"#f0eee0"));
    for(const side of [-1,1]){
      out.push(box(cx,y+.1,cz+side*2,3.2,.015,.28,"#244b3b"));
      out.push(box(cx,y+1.2,cz+side*2.7,1.8,.65,.12,"#172e27"));
      out.push(box(cx,y+1.24,cz+side*2.68,1.5,.5,.13,"#52796a"));
      for(const dx of [-2.4,2.4]){out.push(box(cx+dx,y,cz+side*2.3,.07,2,.07,"#63736b"));out.push(box(cx+dx,y+2,cz+side*2.3,.5,.12,.2,"#eadcaa"));}
    }
    // Low entrance concourse keeps the field visible from the city overview.
    out.push(box(cx+2.6,y,cz,.65,.55,1.2,"#294237"),box(cx+2.95,y+.55,cz,.8,.1,1.4,"#c9a35a"));
    out.push(box(a.x+7.45,y+.035,cz,1,.045,.45,"#e6d6b4"));
    return out;
  },[a]);
  if(!a)return null;
  return <><primitive object={target}/>{night&&stadiumFloodPositions(a).map(([x,z],i)=><spotLight key={i} position={[x,TERRACE_H+2.08,z]} target={target} color="#fff1d0" intensity={22} distance={10} angle={.72} penumbra={.55} decay={2} castShadow={false}/>)}<Instanced items={stadiumFloodPositions(a).map(([x,z])=>({p:[x,TERRACE_H+2.121,z],s:[.46,.025,.19],c:"#fff1d0"}))} geometry={g.box} material={night?m.lamp:m.plain} shadow={false}/><Instanced items={[{p:[a.x+4,0,a.z+3.5],s:[12,TERRACE_H,11]}]} geometry={g.box} material={m.terrace}/><Instanced items={parts} geometry={g.box} material={m.plain}/><Instanced items={[{p:[a.x+6.6,TERRACE_H,a.z+3.5],s:[.65,.55,1.2],c:"#294237"}]} geometry={g.box} material={m.plain} pick={{...pick,keys:[STADIUM_KEY]}}/></>;
}
