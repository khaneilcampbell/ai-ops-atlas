import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {usePowerProfile,useWindowFocused} from '../../lib/power';
import type {Scene3D} from './scene';
import {Instanced,type Inst,type useGeometries,type useMaterials} from './models';
import {CAR_SURFACE,GALLERIA_LIFE,carHeight,driverAt,planGalleriaLife,walkerAt} from './galleriaLifePlan';

const COATS=['#346583','#a18455','#6d875e','#846798','#ab6355','#2f3a45'];
/**
 * Atlas Galleria's grounds: the entrance walk, its lamp posts, and the people and cars that come
 * and go. Static parts are instanced once; the moving ones are four instanced meshes posed on the
 * map's own frames (no render loop of their own), and hold still when motion is off.
 */
export function GalleriaLife({scene,g,m,night,moving}:{scene:Scene3D;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;night:boolean;moving:boolean}){
 const life=useMemo(()=>planGalleriaLife(scene),[scene]),power=usePowerProfile(),focused=useWindowFocused();
 const y=scene.galleria?.y0??0,L=GALLERIA_LIFE;
 const glow=useMemo(()=>new THREE.MeshBasicMaterial({color:'#ffd18a',transparent:true,opacity:.14,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),[]);
 useEffect(()=>()=>glow.dispose(),[glow]);
 const fixed=useMemo(()=>{
  const paths:Inst[]=[],kerbs:Inst[]=[],poles:Inst[]=[],heads:Inst[]=[],pools:Inst[]=[],court:Inst[]=[],drums:Inst[]=[];if(!life)return {paths,kerbs,poles,heads,pools,court,drums};
  // Driveways: asphalt a touch above the pavement they cross, with pale kerb edges and a stop line at the street.
  for(const {a:[ax,az],b:[bx,bz]} of life.driveways){
   const len=Math.hypot(bx-ax,bz-az),yaw=Math.atan2(bx-ax,bz-az),mx=(ax+bx)/2,mz=(az+bz)/2,w=L.driveWidth;
   court.push({p:[mx,y,mz],s:[w,CAR_SURFACE.driveway,len+.1],r:yaw,c:'#4a504d'});
   for(const side of [-1,1])court.push({p:[mx+Math.cos(yaw)*side*w/2,y,mz-Math.sin(yaw)*side*w/2],s:[.035,CAR_SURFACE.driveway+.01,len+.1],r:yaw,c:'#c9bfa6'});
   const k=Math.max(0,len-.55)/len;court.push({p:[ax+(bx-ax)*k,y+CAR_SURFACE.driveway,az+(bz-az)*k],s:[w*.9,.003,.03],r:yaw,c:'#f3efe4'});
   // Two lanes: a dashed centre line from the car park to the stop line.
   const ux=(bx-ax)/len,uz=(bz-az)/len;for(let d=.25;d<len-.75;d+=.36)court.push({p:[ax+ux*d,y+CAR_SURFACE.driveway,az+uz*d],s:[.025,.003,.18],r:yaw,c:'#f3efe4'});
   // A wider apron over the last stretch to the road's edge, so turning cars have room.
   const mk=Math.max(0,len-.9);court.push({p:[ax+ux*mk,y,az+uz*mk],s:[w+.36,CAR_SURFACE.driveway,.9],r:yaw,c:'#4a504d'});
  }
  // The main entrance, in the building's own language (KC, 2026-11-08): the same teal glass with slim mullions and a
  // warm-lit band, under a gently bowed canopy whose edge is a band of white fins with a wavy hem and rope lights, like
  // every floor above it. A glass revolving door in the middle, an entry pair of sliding doors on one side and an exit
  // pair on the other, a brass header, and pale chevrons on the mats pointing in and out.
  {const P=L.portal,pt=life.portal,front=P.d-.05,yaw=Math.atan2(pt.u[0],pt.u[1]),hw=P.w/2+.3,door=.85;
   const at=(k:number,j:number,h:number,s:[number,number,number],c:string,list:Inst[]=court,turn=0)=>list.push({p:[pt.x-pt.u[0]*front/2+pt.u[0]*k+pt.p[0]*j,y+h,pt.z-pt.u[1]*front/2+pt.u[1]*k+pt.p[1]*j],s,r:yaw+turn,c});
   const GLASS='#9fb8bd',WARM='#e9d3a6',MULLION='#3b4744',WHITE='#f7f7f0',BRASS='#c9a35a',LEAF='#b9d2d0';
   // The vestibule: glass sides and transom, warm band, mullions every pane, a white cornice.
   at(front/2,0,0,[P.w,P.h,front-.02],GLASS);at(front/2,0,door+.12,[P.w+.01,.16,front],WARM,heads);
   for(let j=-P.w/2;j<=P.w/2+1e-6;j+=P.w/6)at(front+.012,j,0,[.03,P.h,.04],MULLION);
   at(front+.012,0,door,[P.w,.035,.045],BRASS);at(front/2,0,P.h,[P.w+.06,.06,front+.06],WHITE);
   // Canopy: a bowed slab built from slices, deepest in the middle.
   const bow=(j:number)=>front+.25+.28*(1-(j/hw)**2),N=10;
   for(let i=0;i<N;i++){const j0=-hw+2*hw*i/N,j1=j0+2*hw/N,jm=(j0+j1)/2,k=bow(jm);at(k/2,jm,P.h+.07,[j1-j0+.005,.05,k],WHITE);
    // Soffit downlights under the canopy.
    if(i%2)at(k*.6,jm,P.h+.06,[.06,.012,.06],'#f6dfac',heads);}
   // The canopy's fin band: white fins round the bowed edge with a wavy hem, and rope lights along top and hem.
   for(let j=-hw+.02;j<=hw-.02;j+=.09){const k=bow(j),slope=-.56*j/(hw*hw),turn=Math.atan(slope),hang=.12+.1*(.5+.5*Math.sin(j*5.2+1));
    at(k,j,P.h+.12-hang,[.018,hang+.06,.07],WHITE,court,turn);
    at(k+.04,j,P.h+.13,[.034,.026,.026],'#fff3d6',heads,turn);at(k+.04,j,P.h+.11-hang,[.034,.026,.026],'#fff3d6',heads,turn);}
   // Slender white columns at the canopy's outer corners.
   for(const j of [-1,1])at(bow(j*(hw-.12))-.06,j*(hw-.12),0,[.06,P.h+.08,.06],WHITE);
   // Revolving door: a glass drum, four wings and a brass post, in the middle.
   drums.push({p:[pt.x+pt.u[0]*(front/2+.05),y,pt.z+pt.u[1]*(front/2+.05)],s:[.56,door,.56],c:LEAF});
   for(const t of [0,Math.PI/2])at(front+.05,0,.02,[.52,door-.04,.02],GLASS,court,t+Math.PI/4);
   at(front+.05,0,0,[.035,door,.035],BRASS);
   for(const [j0,sign] of [[P.slide,1],[-P.slide,-1]] as const){
    // Sliding leaves parted to show the open doorway, slim frames, a mat with a chevron pointing in (entry) or out (exit).
    // The leaves glow warm at night, as if the lobby behind them is lit.
    for(const s of [-1,1])at(front+.03,j0+s*(P.door/4+.06),.01,[P.door/2-.1,door-.02,.02],LEAF,heads);
    for(const s of [-1,1])at(front+.014,j0+s*P.door/2,0,[.03,door,.045],MULLION);
    at(front+.18,j0,0,[P.door,.008,.28],'#4a504d');
    for(const s of [-1,1])at(front+.18,j0+s*.05,.008,[.015,.004,.13],'#e9e2cf',court,s*sign*.7);
   }}
  // Zebra stripes on a station walk where a driveway passes under it, matching the city's road crossings.
  for(const c of life.crossings)for(let d=-L.driveWidth/2+.04;d<=L.driveWidth/2-.03;d+=.14)court.push({p:[c.x+Math.cos(c.yaw)*d,y+.109,c.z-Math.sin(c.yaw)*d],s:[.065,.005,.48],r:c.yaw,c:'#f7f7f0'});
  for(let i=1;i<life.walk.length;i++){
   const [ax,az]=life.walk[i-1],[bx,bz]=life.walk[i],len=Math.hypot(bx-ax,bz-az),yaw=Math.atan2(bx-ax,bz-az);
   paths.push({p:[(ax+bx)/2,y,(az+bz)/2],s:[L.walkWidth,.02,len+L.walkWidth],r:yaw,c:'#e3dac4'});
   for(const s of [-1,1])kerbs.push({p:[(ax+bx)/2+Math.cos(yaw)*s*L.walkWidth/2,y,(az+bz)/2-Math.sin(yaw)*s*L.walkWidth/2],s:[.04,.035,len+L.walkWidth],r:yaw,c:'#c9bfa6'});
  }
  for(const l of life.lamps){
   poles.push({p:[l.x,y,l.z],s:[.04,L.lampHeight,.04],c:'#294237'},{p:[l.x,y,l.z],s:[.09,.07,.09],c:'#b4ac8e'},{p:[l.x+Math.sin(l.yaw)*.1,y+L.lampHeight,l.z+Math.cos(l.yaw)*.1],s:[.035,.035,.22],r:l.yaw,c:'#294237'});
   heads.push({p:[l.x+Math.sin(l.yaw)*.19,y+L.lampHeight-.02,l.z+Math.cos(l.yaw)*.19],s:[.1,.04,.14],r:l.yaw,c:'#f6dfac'});
   pools.push({p:[l.x+Math.sin(l.yaw)*.19,y+.025,l.z+Math.cos(l.yaw)*.19],s:[1.1,.003,1.1],c:'#ffffff'});
  }
  // The street court: asphalt, bay lines, and the parked cars nobody is about to drive.
  if(life.court){
   for(const p of life.court.pad)court.push({p:[p.x+p.w/2,y,p.z+p.d/2],s:[p.w,.012,p.d],c:'#5d6360'});
   for(const [x,z] of life.court.stripes)court.push({p:[x,y+.012,z],s:[.38,.004,.025],c:'#f3efe4'});
   for(const c of life.court.cars)court.push({p:[c.x,y+.012,c.z],s:[.38,.1,.2],c:c.c},{p:[c.x,y+.112,c.z],s:[.2,.07,.17],c:'#26323a'});
  }
  return {paths,kerbs,poles,heads,pools,court,drums};
 },[life,y,L]);

 const enabled=moving&&focused&&power.idleFps>15,elapsed=useRef(0);
 const bodies=useRef<THREE.InstancedMesh>(null),faces=useRef<THREE.InstancedMesh>(null),cars=useRef<THREE.InstancedMesh>(null),cabins=useRef<THREE.InstancedMesh>(null);
 const people=(life?.walkers.length??0)+(life?.drivers.length??0),fleet=life?.drivers.length??0;
 const o=useMemo(()=>new THREE.Object3D(),[]);
 const place=(t:number)=>{
  if(!life)return;let i=0;
  const person=(p:ReturnType<typeof walkerAt>,step:number)=>{
   if(p.visible){o.position.set(p.x,y+.02+step,p.z);o.rotation.set(0,p.yaw,0);o.scale.set(.07,.16,.06);}else o.scale.setScalar(0);
   o.updateMatrix();bodies.current?.setMatrixAt(i,o.matrix);
   if(p.visible){o.position.y=y+.23+step;o.scale.setScalar(.035);}o.updateMatrix();faces.current?.setMatrixAt(i,o.matrix);i++;
  };
  life.walkers.forEach((w,k)=>person(walkerAt(w,t),Math.abs(Math.sin(t*6+k))*.008));
  life.drivers.forEach((d,k)=>{
   const {person:p,car}=driverAt(d,t);person(p,Math.abs(Math.sin(t*6+k))*.008);
   const lift=car.visible?carHeight(life,car.x,car.z):0;
   if(car.visible){o.position.set(car.x,y+lift,car.z);o.rotation.set(0,car.yaw,0);o.scale.set(.2,.1,.38);}else o.scale.setScalar(0);
   o.updateMatrix();cars.current?.setMatrixAt(k,o.matrix);
   if(car.visible){o.position.y=y+lift+.1;o.scale.set(.17,.07,.2);}o.updateMatrix();cabins.current?.setMatrixAt(k,o.matrix);
  });
  for(const r of [bodies,faces,cars,cabins])if(r.current)r.current.instanceMatrix.needsUpdate=true;
 };
 useLayoutEffect(()=>{
  if(!life)return;const c=new THREE.Color();
  for(let i=0;i<people;i++){bodies.current?.setColorAt(i,c.set(COATS[i%COATS.length]));faces.current?.setColorAt(i,c.set(i%3?'#dfb996':'#9b6d50'));}
  life.drivers.forEach((d,k)=>{cars.current?.setColorAt(k,c.set(d.car.c));cabins.current?.setColorAt(k,c.set('#26323a'));});
  for(const r of [bodies,faces,cars,cabins])if(r.current?.instanceColor)r.current.instanceColor.needsUpdate=true;
  place(elapsed.current);
  // Posed once when paused; frames then do the work only while moving.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[life,enabled]);
 useFrame((_,dt)=>{if(!enabled||document.visibilityState==='hidden')return;elapsed.current+=Math.min(dt,.1);place(elapsed.current);});
 if(!life)return null;
 return <group name="galleria-life">
  <Instanced items={fixed.paths} geometry={g.box} material={m.plain} shadow={false}/>
  <Instanced items={fixed.kerbs} geometry={g.box} material={m.plain} shadow={false}/>
  <Instanced items={fixed.court} geometry={g.box} material={m.plain} shadow={false}/>
  <Instanced items={fixed.drums} geometry={g.cyl} material={m.plain} shadow={false}/>
  <Instanced items={fixed.poles} geometry={g.box} material={m.plain}/>
  <Instanced items={fixed.heads} geometry={g.box} material={night?m.lamp:m.plain} shadow={false}/>
  {night&&<Instanced items={fixed.pools} geometry={g.cyl} material={glow} shadow={false}/>}
  <instancedMesh name="galleria-shoppers" ref={bodies} args={[g.cyl,m.plain,people]} castShadow frustumCulled={false} raycast={()=>null}/>
  <instancedMesh ref={faces} args={[g.ball,m.plain,people]} frustumCulled={false} raycast={()=>null}/>
  {fleet>0&&<instancedMesh name="galleria-cars" ref={cars} args={[g.box,m.plain,fleet]} castShadow frustumCulled={false} raycast={()=>null}/>}
  {fleet>0&&<instancedMesh ref={cabins} args={[g.box,m.plain,fleet]} frustumCulled={false} raycast={()=>null}/>}
 </group>;
}
