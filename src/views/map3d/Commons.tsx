import {useEffect,useMemo} from 'react';
import * as THREE from 'three';
import {COMMONS,type CommonsPlan} from './commonsPlan';
import {TERRACE_H} from './scene';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import type {Pt} from './roads';
/** Static, shared instance buffers. No frame callbacks, real lights, textures or external assets. */
export default function Commons({plan:p,g,m,pick,night}:{plan?:CommonsPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night:boolean}){
 const water=useMemo(()=>{if(!p)return;const shape=new THREE.Shape();p.pond.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();const geo=new THREE.ShapeGeometry(shape);geo.rotateX(-Math.PI/2);geo.translate(0,TERRACE_H+.035,0);return geo;},[p]);
 useEffect(()=>()=>water?.dispose(),[water]);
 const glass=useMemo(()=>new THREE.MeshStandardMaterial({color:'#c6deee',transparent:true,opacity:.3,roughness:.65,depthWrite:false}),[]);
 useEffect(()=>()=>glass.dispose(),[glass]);
 const parts=useMemo(()=>{
  const solid:Inst[]=[],plants:Inst[]=[],trunks:Inst[]=[],panes:Inst[]=[],lamps:Inst[]=[];
  if(!p)return {solid,plants,trunks,panes,lamps};
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[x,TERRACE_H+y,z],s:[w,h,d],c});
  const strip=(a:Pt,b:Pt,width:number,y:number,h:number,c:string)=>{const len=Math.hypot(b[0]-a[0],b[1]-a[1]);return {...box((a[0]+b[0])/2,y,(a[1]+b[1])/2,width,h,len+.015,c),r:Math.atan2(b[0]-a[0],b[1]-a[1])};};
  for(const path of p.paths)for(let i=1;i<path.length;i++)solid.push(strip(path[i-1],path[i],COMMONS.pathWidth,.04,.035,'#e6d6b4'));
  // The shoreline shrubs and the park's trees are the city's planting, drawn by Landscape (commonsPlanting).
  for(const [a,b]of p.bridges){
   solid.push(strip(a,b,COMMONS.bridgeWidth,.045,.06,'#b68c60'));
   for(const side of [-1,1]){
    const u:Pt=[a[0]+side*COMMONS.bridgeWidth/2,a[1]],v:Pt=[b[0]+side*COMMONS.bridgeWidth/2,b[1]];
    solid.push(strip(u,v,.035,.39,.035,'#294237'));
    for(let t=0;t<=1;t+=.25)solid.push(box(u[0],.1,u[1]+(v[1]-u[1])*t,.04,.3,.04,'#294237'));
   }
   for(const [x,z]of [a,b])solid.push(box(x,.015,z,.7,.03,.5,'#d9ceb4'));
  }
  // Ring pavilion: faceted glazing, a shaded roof ring and a genuinely open central garden.
  for(let i=0;i<20;i++){
   const a=i/20*Math.PI*2,b=(i+1)/20*Math.PI*2,at=(r:number,t:number):Pt=>[p.pavilion[0]+r*Math.cos(t),p.pavilion[1]+r*Math.sin(t)];
   const u=at(1.05,a),v=at(1.05,b);
   solid.push(strip(at(.72,a),at(.72,b),.65,.055,.05,'#e6d6b4'),strip(at(.87,a),at(.87,b),.5,1.08,.06,'#f7f7f0'));
   if(i<4||i>5){panes.push(strip(u,v,.016,.11,.9,'#ffffff'));solid.push(box(u[0],.1,u[1],.035,.98,.035,'#294237'));}
   solid.push(strip(at(.87,a),at(.87,b),.018,1.15,.025,'#c9a35a'));
  }
  plants.push(box(p.pavilion[0],.08,p.pavilion[1],.45,.4,.45,'#719d77'));
  // Open half-circle seating faces the water. Three small terraces, no enclosing walls.
  for(let row=0;row<3;row++)for(let i=0;i<12;i++){
   const a=Math.PI/2+i/12*Math.PI,b=Math.PI/2+(i+1)/12*Math.PI,r=.5+row*.23;
   solid.push(strip([p.amphitheater[0]+r*Math.cos(a),p.amphitheater[1]+r*Math.sin(a)],[p.amphitheater[0]+r*Math.cos(b),p.amphitheater[1]+r*Math.sin(b)],.23,.04+row*.09,.08,'#d9ceb4'));
  }
  for(const [i,[x,z]]of p.benches.entries()){
   const r=p.benchRotations[i],part=(dx:number,y:number,dz:number,w:number,h:number,d:number,c:string)=>({...box(x+dx*Math.cos(r)+dz*Math.sin(r),y,z-dx*Math.sin(r)+dz*Math.cos(r),w,h,d,c),r});
   solid.push(part(0,.2,0,.65,.06,.25,'#b68c60'),part(0,.26,.1,.65,.25,.04,'#b68c60'));
   for(const side of [-1,1])solid.push(part(side*.23,.05,0,.05,.15,.2,'#294237'));
  }
  for(const [x,z]of p.lights){solid.push(box(x,.04,z,.045,.35,.045,'#294237'));lamps.push(box(x,.39,z,.09,.045,.09,'#fff2d1'));}
  return {solid,plants,trunks,panes,lamps};
 },[p]);
 if(!p||!water)return null;
 return <group name="atlas-commons"><Instanced items={[{p:[p.rect.x+p.rect.w/2,TERRACE_H+.012,p.rect.z+p.rect.d/2],s:[p.rect.w,.012,p.rect.d]}]} geometry={g.box} material={m.terrace} pick={pick}/><mesh geometry={water} material={m.brook} raycast={()=>null}/><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.trunks} geometry={g.cyl} material={m.plain}/><Instanced items={parts.plants} geometry={g.ball} material={m.plain}/><Instanced items={parts.panes} geometry={g.box} material={glass} shadow={false}/><Instanced items={parts.lamps} geometry={g.bead} material={night?m.lamp:m.plain} shadow={false}/></group>;
}
