import {CLEAR_ARCHITECTURAL_GLASS} from './architecturalGlass';
import {MODELS,SCALE} from "./vehicleModels";
import {TRANSPORT} from "./transportScale";
import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {planDealershipTraffic,dealershipGarageOpen} from './vehicles';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import {TERRACE_H} from './scene';
import {DEALERSHIP as D,dealershipUpperFloors,DEALERSHIP_KEY,type DealershipPlan} from './dealershipPlan';
import {ROAD_W} from './roads';
type Parts={solid:Inst[];round:Inst[];lights:Inst[];glass:Inst[]};
/** Display cars use precisely the moving fleet's geometry, rotated toward the entrance. */
function car(parts:Parts,x:number,y:number,z:number,color:string,suv:boolean){
 for(const p of MODELS[suv?'gwagon':'bmw'].parts)parts.solid.push({p:[x-p.at[2]*SCALE,y+p.at[1]*SCALE,z+p.at[0]*SCALE],s:[p.size[0]*SCALE,p.size[1]*SCALE,p.size[2]*SCALE],r:-Math.PI/2,c:p.color??color});
}
function signage(){
 const c=document.createElement('canvas');c.width=1536;c.height=400;const ctx=c.getContext('2d')!;
 ctx.fillStyle='#f8f9f7';ctx.fillRect(0,0,c.width,c.height);
 const cx=205,cy=200,r=166;ctx.fillStyle='#171f24';ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle='#b9c3c8';ctx.lineWidth=5;ctx.stroke();
 for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,108,i*Math.PI/2,(i+1)*Math.PI/2);ctx.closePath();ctx.fillStyle=i%2?'#f7f8f5':'#2876bb';ctx.fill();}
 ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='bold 45px sans-serif';ctx.fillText('BMW',cx,cy-122);
 ctx.fillStyle='#20292e';ctx.textAlign='left';ctx.font='bold 300px sans-serif';ctx.fillText('BMW',450,310);
 ctx.fillStyle='#2876bb';ctx.fillRect(0,386,1536,14);
 const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 return {texture,material:new THREE.MeshBasicMaterial({map:texture,toneMapped:false}),geometry:new THREE.PlaneGeometry(3.072,.8)};
}
export function Dealership({plan:a,g,m,pick,night=false,traffic=false,reduced=false}:{night?:boolean;traffic?:boolean;reduced?:boolean;plan?:DealershipPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick}){
 const sign=useMemo(signage,[]);
 const glow=useMemo(()=>new THREE.MeshStandardMaterial({color:'#fff1cd',emissive:'#ffdca1',emissiveIntensity:.1}),[]);
 useEffect(()=>{glow.emissiveIntensity=night?1.7:.08;},[glow,night]);
 useEffect(()=>()=>glow.dispose(),[glow]);
 const glass=useMemo(()=>new THREE.MeshPhysicalMaterial(CLEAR_ARCHITECTURAL_GLASS),[]);
 useEffect(()=>()=>{sign.texture.dispose();sign.material.dispose();sign.geometry.dispose();glass.dispose();},[sign,glass]);
 const parts=useMemo(()=>{
  const p:Parts={solid:[],round:[],lights:[],glass:[]};if(!a)return p;
  const x=a.x,z=a.z,y=TERRACE_H;
  const box=(dx:number,dy:number,dz:number,w:number,h:number,d:number,c:string):Inst=>({p:[x+dx,y+dy,z+dz],s:[w,h,d],c});
  // Four-story curtain wall: a clear central atrium separates the mezzanine wings.
  const H=D.height,F=D.mezzanineY,levels=dealershipUpperFloors();
  p.solid.push(box(5,.04,2.1,7.6,.06,3.2,'#e7e8e4'),box(5,.1,.5,7.6,H-.1,.08,'#e3e7e5'));
  p.solid.push(box(5,H,2.1,7.85,.1,3.45,'#edf0ef'),box(5,H+.1,2.1,7.6,.035,3.2,'#aab5bb'));
  // Roof-edge fascia carries the sign above the glazing, with no duplicate roof mesh.
  p.solid.push(box(5,H-.85,3.73,7.6,.85,.08,'#f8f9f7'),box(5,H-.89,3.78,7.6,.025,.02,'#2876bb'));
  for(const xx of [1.2,3.1,4.5,5.5,6.9,8.8])p.solid.push(box(xx,.1,3.72,.035,H-.46,.05,'#26363e'));
  for(const xx of [1.2,8.8])for(const zz of [.5,2.1,3.7])p.solid.push(box(xx,.1,zz,.065,H-.1,.065,'#b4c0c6'));
  for(const yy of [.1,...levels,H-.4])p.solid.push(box(5,yy,3.72,7.6,.035,.055,'#34464f'));
  // Individual front panes stop at the double entrance; side panes retain service access.
  for(const [cx,w] of [[2.85,3.2],[7.15,3.2]])p.glass.push(box(cx,.14,3.72,w,H-.55,.014,'#ffffff'));
  p.glass.push(box(5,1.3,3.72,.96,H-1.7,.014,'#ffffff'));
  for(const xx of [4.56,5.44])p.solid.push(box(xx,.1,3.76,.025,1.2,.03,'#26363e'));
  p.solid.push(box(5,1.32,3.98,1.2,.055,.6,'#b6c1c7'));
  p.glass.push(box(1.2,.14,2.1,.014,H-.55,3.1,'#ffffff'));
  for(const zz of [1.02,3.17])p.glass.push(box(8.8,.14,zz,.014,H-.55,1,'#ffffff'));
  p.glass.push(box(8.8,1.2,2.1,.014,H-1.61,1.02,'#ffffff'));
  p.solid.push(box(9.06,.035,2.1,.46,.025,1.02,'#343f45'),box(8.83,1.17,2.1,.09,.09,1.2,'#b6c1c7'),box(8.83,.1,1.54,.09,1.07,.08,'#b6c1c7'),box(8.83,.1,2.66,.09,1.07,.08,'#b6c1c7'));

  // Repeat the original galleries and rear landing; keep the atrium and circulation clear.
  for(const level of levels){
  for(const xx of [2.85,7.15]){
   p.solid.push(box(xx,level-.09,2.1,3.15,.09,3.1,'#c6cfd3'));
   p.glass.push(box(xx,level,3.56,3.12,.47,.014,'#ffffff'));
   p.solid.push(box(xx,level+.47,3.56,3.15,.025,.03,'#647883'));
  }
  p.solid.push(box(5,level-.09,.64,1.15,.09,.22,'#c6cfd3'));
  for(const xx of [4.42,5.58]){p.glass.push(box(xx,level,2.4,.014,.47,2.28,'#ffffff'));p.solid.push(box(xx,level+.47,2.4,.025,.025,2.28,'#647883'));}
  }
  // One stair flight per level uses the established back-wall route and rear landings.
  for(let floor=0;floor<D.floorCount-1;floor++)for(let i=0;i<D.stairCount;i++)p.solid.push(box(5.9-i*.16,floor*F+F*i/D.stairCount+.1,1.15,.18,.09,.55,'#aab7be'));
  // Ground-floor reception and lounge.
  p.solid.push(box(7.1,.1,1.6,1.3,.45,.5,'#e4e2db'),box(7.1,.55,1.6,1.4,.045,.6,'#294237'),box(7.1,.59,1.6,.25,.17,.045,'#203744'),box(6.2,.1,2.7,.35,.24,.4,'#294237'),box(7,.1,2.7,.35,.24,.4,'#294237'));
  for(const yy of [...levels.map(level=>level-.17),H-.16])for(const xx of [2.5,6.8])p.lights.push(box(xx,yy,2.1,.8,.025,.5,'#ffffff'));
  car(p,x+2.6,y+.1,z+2,'#e5e8e7',false);car(p,x+4,y+.1,z+2.6,'#2163ad',false);
  for(const level of levels){car(p,x+2.3,y+level,z+2.3,'#2163ad',false);car(p,x+3.7,y+level,z+2.3,'#e7e9e6',false);car(p,x+7.2,y+level,z+2.3,'#a5abb0',true);}
  // Display bays and the drive aisle leave a central pedestrian approach clear.
  p.solid.push(box(5,.012,5.9,9.4,.035,3.5,'#414b50'));
  for(const v of a.cars){car(p,v.x,y+.06,v.z,v.color,v.kind==='suv');for(const side of [-1,1])p.solid.push({p:[v.x+side*TRANSPORT.displayBayWidth/2,y+.055,v.z],s:[.025,.012,TRANSPORT.displayBayLength],c:'#e4e7de'});p.solid.push({p:[v.x,y+.055,v.z-TRANSPORT.displayBayLength/2],s:[TRANSPORT.displayBayWidth,.012,.025],c:'#e4e7de'});}
  for(let i=1;i<a.drive.length;i++){const q=a.drive[i-1],b=a.drive[i],len=Math.hypot(b[0]-q[0],b[1]-q[1]);p.solid.push({p:[(q[0]+b[0])/2,y+.03,(q[1]+b[1])/2],s:[i===1?TRANSPORT.dealerAisle:ROAD_W,.025,len+.05],r:Math.atan2(b[0]-q[0],b[1]-q[1]),c:'#343f45'});}
  for(let i=1;i<a.promenade.length;i++){
   const q=a.promenade[i-1],b=a.promenade[i];
   const segments=q[0]===b[0]&&Math.abs(q[0]-x-5)<.01?[[q,[x+5,z+7.2]],[ [x+5,z+5.8],b]]:[[q,b]];
   for(const [from,to] of segments){const len=Math.hypot(to[0]-from[0],to[1]-from[1]);p.solid.push({p:[(from[0]+to[0])/2,y+.04,(from[1]+to[1])/2],s:[D.walkWidth,.05,len+.03],r:Math.atan2(to[0]-from[0],to[1]-from[1]),c:'#e6d6b4'});}
  }
  // Lowered zebra crossing is flush with the drive aisle rather than a sidewalk across traffic.
  p.solid.push(box(5,.034,6.5,.64,.035,1.4,'#343f45'));
  for(let i=0;i<7;i++)p.solid.push(box(5,.072,5.9+i*.2,.58,.009,.1,'#f0ecdb'));
  for(const xx of [.45,9.55]){p.solid.push(box(xx,.03,7.6,.045,.8,.045,'#294237'));p.lights.push(box(xx,.83,7.6,.09,.055,.09,'#ffffff'));}
  return p;
 },[a]);
 if(!a)return null;
 return <><Instanced items={[{p:[a.x+a.w/2,0,a.z+a.d/2],s:[a.w,TERRACE_H,a.d]}]} geometry={g.box} material={m.terrace}/><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.round} geometry={g.ball} material={m.plain}/><Instanced items={parts.lights} geometry={g.box} material={glow}/><Instanced items={parts.glass} geometry={g.box} material={glass} pick={{...pick,keys:parts.glass.map(()=>DEALERSHIP_KEY)}}/>{traffic?<Garage key="moving" plan={a} g={g} m={m} moving={!reduced}/>:<Garage key="parked" plan={a} g={g} m={m} moving={false}/>}<mesh position={[a.x+5,TERRACE_H+D.height-.425,a.z+3.78]} geometry={sign.geometry} material={sign.material} raycast={()=>null}/></>;
}

function Garage({plan,g,m,moving}:{plan:DealershipPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;moving:boolean}){
 const ref=useRef<THREE.Group>(null),clock=useRef(0);
 const visits=useMemo(()=>planDealershipTraffic({dealership:plan}),[plan]);
 const slats=useMemo<Inst[]>(()=>Array.from({length:8},(_,i)=>({p:[0,i*.13,0],s:[.035,.125,1.02],c:i%2?'#9eacb4':'#c5cdd0'})),[]);
 useFrame((_,dt)=>{if(moving)clock.current+=Math.min(dt,.1);if(ref.current){const open=dealershipGarageOpen(visits,clock.current);ref.current.position.y=TERRACE_H+.12+open*1.05;ref.current.scale.y=Math.max(.001,1-open);}});
 return <group ref={ref} position={[plan.x+8.84,TERRACE_H+.12,plan.z+2.1]}><Instanced items={slats} geometry={g.box} material={m.metal}/></group>;
}
