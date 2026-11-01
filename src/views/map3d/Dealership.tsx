import {CLEAR_ARCHITECTURAL_GLASS} from './architecturalGlass';
import {MODELS,SCALE} from "./vehicleModels";
import {TRANSPORT} from "./transportScale";
import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {planDealershipTraffic,dealershipGarageOpen} from './vehicles';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import {TERRACE_H} from './scene';
import {DEALERSHIP as D,dealershipUpperFloors,DEALERSHIP_KEY,SHOWROOM_FRONT,type DealershipPlan} from './dealershipPlan';
import {ROAD_W} from './roads';
type Parts={solid:Inst[];round:Inst[];lights:Inst[];ceilings:Inst[];glass:Inst[]};
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
 // Night mode (KC, 2026-10-31 "give me BMW dealership lights at night"): every storey's ceiling glows a
 // clean showroom white through the glass, between the rejected full glow and the dim warm wash.
 const ceiling=useMemo(()=>new THREE.MeshStandardMaterial({color:'#eef0ee',emissive:'#fff3dc',emissiveIntensity:0,roughness:.7}),[]);
 useEffect(()=>{ceiling.emissiveIntensity=night?.75:0;},[ceiling,night]);
 useEffect(()=>()=>ceiling.dispose(),[ceiling]);
 const glass=useMemo(()=>new THREE.MeshPhysicalMaterial(CLEAR_ARCHITECTURAL_GLASS),[]);
 useEffect(()=>()=>{sign.texture.dispose();sign.material.dispose();sign.geometry.dispose();glass.dispose();},[sign,glass]);
 const parts=useMemo(()=>{
  const p:Parts={solid:[],round:[],lights:[],ceilings:[],glass:[]};if(!a)return p;
  const x=a.x,z=a.z,y=TERRACE_H;
  const box=(dx:number,dy:number,dz:number,w:number,h:number,d:number,c:string):Inst=>({p:[x+dx,y+dy,z+dz],s:[w,h,d],c});
  // Curtain-wall tower sized from the Financial District (plan.showroom): a clear central atrium
  // separates the gallery wings on every storey, and the glass front stays on the promenade line.
  const r=a.showroom,H=r.height,F=D.mezzanineY,levels=dealershipUpperFloors(r.floors),cx=r.cx,cz=r.cz;
  const W=r.w/2,Lx=cx-W,Rx=cx+W,B=cz-r.d/2,Fz=cz+r.d/2,wing=W-.67,wings=[cx-.65-wing/2,cx+.65+wing/2],perWing=Math.max(1,Math.floor(wing/1.1));
  const bays=(c:number)=>Array.from({length:perWing},(_,k)=>c+(k-(perWing-1)/2)*wing/perWing);
  p.solid.push(box(cx,.04,cz,r.w,.06,r.d,'#e7e8e4'),box(cx,.1,B,r.w,H-.1,.08,'#e3e7e5'));
  p.solid.push(box(cx,H,cz,r.w+.25,.1,r.d+.25,'#edf0ef'),box(cx,H+.1,cz,r.w,.035,r.d,'#aab5bb'));
  // Roof-edge fascia carries the sign above the glazing, with no duplicate roof mesh.
  p.solid.push(box(cx,H-.85,Fz+.03,r.w,.85,.08,'#f8f9f7'),box(cx,H-.89,Fz+.08,r.w,.025,.02,'#2876bb'));
  for(const xx of [Lx,(Lx+cx-.5)/2,cx-.5,cx+.5,(cx+.5+Rx)/2,Rx])p.solid.push(box(xx,.1,Fz+.02,.035,H-.46,.05,'#26363e'));
  for(const xx of [Lx,Rx])for(const zz of [B,cz,Fz])p.solid.push(box(xx,.1,zz,.065,H-.1,.065,'#b4c0c6'));
  for(const yy of [.1,...levels,H-.4])p.solid.push(box(cx,yy,Fz+.02,r.w,.035,.055,'#34464f'));
  // Individual front panes stop at the double entrance; side panes retain service access.
  for(const side of [-1,1]){const w=W-.48;p.glass.push(box(cx+side*(.48+w/2),.14,Fz+.02,w,H-.55,.014,'#ffffff'));}
  p.glass.push(box(cx,1.3,Fz+.02,.96,H-1.7,.014,'#ffffff'));
  for(const xx of [cx-.44,cx+.44])p.solid.push(box(xx,.1,Fz+.06,.025,1.2,.03,'#26363e'));
  p.solid.push(box(cx,1.32,Fz+.28,1.2,.055,.6,'#b6c1c7'));
  p.glass.push(box(Lx,.14,cz,.014,H-.55,r.d-.1,'#ffffff'));
  const pane=(r.d-1.02)/2-.05;for(const zz of [cz-.51-.025-pane/2,cz+.51+.025+pane/2])p.glass.push(box(Rx,.14,zz,.014,H-.55,pane,'#ffffff'));
  p.glass.push(box(Rx,1.2,cz,.014,H-1.61,1.02,'#ffffff'));
  p.solid.push(box(Rx+.26,.035,cz,.46,.025,1.02,'#343f45'),box(Rx+.03,1.17,cz,.09,.09,1.2,'#b6c1c7'),box(Rx+.03,.1,cz-.56,.09,1.07,.08,'#b6c1c7'),box(Rx+.03,.1,cz+.56,.09,1.07,.08,'#b6c1c7'));

  // Gallery wings and a rear landing on every storey; the atrium and stairs stay clear.
  const rail=r.d-.92;
  for(const level of levels){
  for(const xx of wings){
   p.solid.push(box(xx,level-.09,cz,wing,.09,r.d-.1,'#c6cfd3'));
   p.glass.push(box(xx,level,Fz-.14,wing-.03,.47,.014,'#ffffff'));
   p.solid.push(box(xx,level+.47,Fz-.14,wing,.025,.03,'#647883'));
  }
  p.solid.push(box(cx,level-.09,B+.14,1.15,.09,.22,'#c6cfd3'));
  for(const xx of [cx-.58,cx+.58]){p.glass.push(box(xx,level,Fz-.14-rail/2,.014,.47,rail,'#ffffff'));p.solid.push(box(xx,level+.47,Fz-.14-rail/2,.025,.025,rail,'#647883'));}
  }
  // One stair flight per storey along the back wall, up to the rear landings.
  for(let floor=0;floor<r.floors-1;floor++)for(let i=0;i<D.stairCount;i++)p.solid.push(box(cx+.9-i*.16,floor*F+F*i/D.stairCount+.1,B+.45,.18,.09,.5,'#aab7be'));
  // Ground-floor reception and lounge beside the side service door.
  const desk=Rx-.75;p.solid.push(box(desk,.1,cz+.35,1.3,.45,.5,'#e4e2db'),box(desk,.55,cz+.35,1.4,.045,.6,'#294237'),box(desk,.59,cz+.35,.25,.17,.045,'#203744'),box(Rx-1.3,.1,Fz-.45,.35,.24,.4,'#294237'),box(Rx-.55,.1,Fz-.45,.35,.24,.4,'#294237'));
  // Original showroom lighting (KC, 2026-10-31): one ceiling strip over each gallery wing per storey,
  // same glow. The strips hang just behind the front glass so every lit storey reads from the street;
  // set back at mid-depth under the slabs they were hidden from outside and the tower looked dark.
  for(const yy of [...levels.map(level=>level-.2),H-.2])for(const xx of wings)p.lights.push(box(xx,yy,Fz-.4,Math.min(.8,wing*.7),.05,.3,'#ffffff'));
  for(const top of [...levels,H])p.ceilings.push(box(cx,top-.13,cz,r.w-.14,.02,r.d-.14,'#ffffff'));
  const colors=['#2163ad','#e7e9e6','#a5abb0','#202b35'];
  bays(wings[0]).forEach((bx,k)=>car(p,x+bx,y+.1,z+cz+.3,colors[k%4],false));
  levels.forEach((level,i)=>[...bays(wings[0]),...bays(wings[1])].forEach((bx,k)=>car(p,x+bx,y+level,z+cz+.2,colors[(i+k)%4],k>=perWing&&k%2===0)));
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
 return <><Instanced items={[{p:[a.lot.x+a.lot.w/2,0,a.lot.z+a.lot.d/2],s:[a.lot.w,TERRACE_H,a.lot.d]}]} geometry={g.box} material={m.terrace}/><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.round} geometry={g.ball} material={m.plain}/><Instanced items={parts.lights} geometry={g.box} material={glow}/><Instanced items={parts.ceilings} geometry={g.box} material={ceiling} shadow={false}/><Instanced items={parts.glass} geometry={g.box} material={glass} pick={{...pick,keys:parts.glass.map(()=>DEALERSHIP_KEY)}}/>{traffic?<Garage key="moving" plan={a} g={g} m={m} moving={!reduced}/>:<Garage key="parked" plan={a} g={g} m={m} moving={false}/>}<mesh position={[a.x+a.showroom.cx,TERRACE_H+a.showroom.height-.425,a.z+SHOWROOM_FRONT+.08]} geometry={sign.geometry} material={sign.material} raycast={()=>null}/></>;
}

function Garage({plan,g,m,moving}:{plan:DealershipPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;moving:boolean}){
 const ref=useRef<THREE.Group>(null),clock=useRef(0);
 const visits=useMemo(()=>planDealershipTraffic({dealership:plan}),[plan]);
 const slats=useMemo<Inst[]>(()=>Array.from({length:8},(_,i)=>({p:[0,i*.13,0],s:[.035,.125,1.02],c:i%2?'#9eacb4':'#c5cdd0'})),[]);
 useFrame((_,dt)=>{if(moving)clock.current+=Math.min(dt,.1);if(ref.current){const open=dealershipGarageOpen(visits,clock.current);ref.current.position.y=TERRACE_H+.12+open*1.05;ref.current.scale.y=Math.max(.001,1-open);}});
 return <group ref={ref} position={[plan.x+plan.showroom.cx+plan.showroom.w/2+.04,TERRACE_H+.12,plan.z+plan.showroom.cz]}><Instanced items={slats} geometry={g.box} material={m.metal}/></group>;
}
