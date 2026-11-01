import {useMemo,useEffect} from 'react';
import * as THREE from 'three';
import {Instanced,type Inst,type Pick,type useGeometries,type useMaterials} from './models';
import {HILLS as H,HILLS_KEY,type HillsPlan} from './hillsPlan';
import {TERRACE_H} from './scene';
/** A static estate: shared instanced boxes, faceted planting, and one reusable pavilion mesh. */
export default function AtlasHills({plan:a,g,m,pick,night}:{plan?:HillsPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:Pick;night:boolean}){
 const materials=useMemo(()=>{const css=getComputedStyle(document.documentElement),color=(name:string,fallback:string)=>css.getPropertyValue(name).trim()||fallback;return {ivory:color('--sage-50','#f7f7f0'),green:color('--forest-700','#294237'),gold:color('--gold','#d0ad69'),window:new THREE.MeshStandardMaterial({color:'#8eb7c2',emissive:'#ffe0a6',emissiveIntensity:0,roughness:.4}),water:new THREE.MeshStandardMaterial({color:'#6daeb6',emissive:'#326f7a',emissiveIntensity:0,roughness:.3}),pavilion:new THREE.CylinderGeometry(1,1,1,16),arch:new THREE.ShapeGeometry((()=>{const s=new THREE.Shape();s.moveTo(-.45,0);s.lineTo(.45,0);s.lineTo(.45,.85);s.absarc(0,.85,.45,0,Math.PI,false);s.lineTo(-.45,0);return s})())}},[]);
 useEffect(()=>{materials.window.color.set(night?'#ffe8b8':'#8eb7c2');materials.window.emissiveIntensity=night?1.15:0;materials.water.emissiveIntensity=night?.35:0},[night,materials]);
 useEffect(()=>()=>{materials.window.dispose();materials.water.dispose();materials.pavilion.dispose();materials.arch.dispose()},[materials]);
 const parts=useMemo(()=>{
 const solid:Inst[]=[],glass:Inst[]=[],plants:Inst[]=[],water:Inst[]=[],lights:Inst[]=[];if(!a)return {solid,glass,plants,water,lights};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[a.x+x,TERRACE_H+y,a.z+z],s:[w,h,d],c});
 const rect=(r:{x:number;z:number;w:number;d:number},y:number,h:number,c:string)=>box(r.x,y,r.z,r.w,h,r.d,c);
 // Stone foundation, ivory facade, roof cornice and a clear central front door.
 solid.push(rect(H.mansion,.15,3.2,materials.ivory),rect({...H.mansion,w:9.3,d:5.3},3.35,.12,'#c2bcae'),rect({...H.mansion,w:8.8,d:4.8},3.47,.035,'#e3dfd2'),rect({...H.mansion,w:9.6,d:5.6},0,.15,'#d8d2c2'));
 for(const y of [.45,2])for(const x of [9.3,11,15,16.7]){
  glass.push(box(x,y,12.525,.7,1.12,.025,'#ffffff'),box(x,y,7.475,.7,1.12,.025,'#ffffff'));
  solid.push(box(x,y+.55,12.55,.025,.025,.035,materials.ivory),box(x,y,12.55,.025,1.1,.035,materials.ivory));
 }
 for(const z of [8.4,10,11.6])for(const y of [.45,2])glass.push(box(8.475,y,z,.025,1.12,.7,'#ffffff'));
 for(const x of [10,15]){solid.push(box(x,1.9,12.85,2,.12,.65,'#d4cebe'));for(let dx=-.8;dx<=.8;dx+=.4)solid.push(box(x+dx,2.02,13.13,.025,.5,.025,materials.green));solid.push(box(x,2.52,13.13,1.85,.03,.03,materials.green));}
 for(const angle of [-.2,.55,1.1,1.6])for(const y of [.45,2])glass.push({...box(17.3+Math.cos(angle)*1.115,y,12+Math.sin(angle)*1.115,.45,1.05,.025,'#ffffff'),r:Math.PI/2-angle});
 // Raised entrance landing and three matching steps connect to the courtyard.
 solid.push(box(13,.15,12.85,1.6,.12,.7,'#d8d2c2'));
 for(let i=0;i<3;i++)solid.push(box(13,.05+i*(.22/3),13.8-i*.24,1.6,.22/3,.24,'#d8d2c2'));
 // Courtyard fountain is offset from the direct entrance circulation.
 solid.push(box(13,.015,14.7,8,.035,3.6,'#e3dfd2'),box(10,.05,14.6,1.3,.22,1.3,'#b9b5a6'),box(10,.27,14.6,1.12,.03,1.12,'#6daeb6'),box(10,.3,14.6,.13,.5,.13,'#c2cbb9'));
 // Separate garage and three static cars, all using the city's existing vehicle scale.
 solid.push(rect(H.garage,.05,1.5,materials.ivory),rect({...H.garage,w:5.2,d:3.2},1.55,.1,'#a9a69a'));
 for(const x of [3,4.5,6])solid.push(box(x,.1,5.52,1.1,1.15,.035,'#536464'));
 // Lit transoms over the doors and side windows, so the garage is not a dark block at night.
 for(const x of [3,4.5,6])glass.push(box(x,1.3,5.52,1,.14,.03,'#ffffff'));
 for(const x of [1.99,7.01])for(const z of [3.3,4.7])glass.push(box(x,.75,z,.03,.4,.5,'#ffffff'));
 for(const route of [a.drive,a.promenade])for(let i=1;i<route.length;i++){const u=route[i-1],v=route[i],d=Math.hypot(v[0]-u[0],v[1]-u[1]);solid.push({p:[(u[0]+v[0])/2,TERRACE_H+(route===a.drive?.025:.05),(u[1]+v[1])/2],s:[route===a.drive?.85:.48,.035,d+.02],r:Math.atan2(v[0]-u[0],v[1]-u[1]),c:route===a.drive?'#68716f':'#e3dfd2'});}
 // Quiet pool terrace, coping, four loungers and a pergola.
 solid.push(rect({...H.pool,w:3.4,d:7},.02,.03,'#e3dfd2'));for(const z of [6.925,13.075])solid.push(box(6.2,.06,z,2.7,.08,.15,'#ece7d8'));for(const x of [4.925,7.475])solid.push(box(x,.06,10,.15,.08,6,'#ece7d8'));water.push(rect(H.pool,.08,.025,'#ffffff'));
 for(const z of [8,9.3,10.6,11.9])solid.push(box(4.65,.05,z,.3,.2,.65,'#f1ede1'),box(4.65,.25,z+.2,.3,.25,.1,'#d6c9a8'));
 for(const x of [14,17])for(const z of [3.7,5.8])solid.push(box(x,0,z,.07,1.6,.07,materials.green));for(let x=13.9;x<17.2;x+=.3)solid.push(box(x,1.6,4.75,.09,.06,2.4,'#cab991'));
 solid.push(box(15.5,0,4.8,.08,.5,.08,materials.green),box(15.5,.5,4.8,.8,.05,.7,'#cab991'));for(const x of [14.6,16.4])solid.push(box(x,0,4.8,.45,.28,.5,materials.ivory),box(x,.28,5,.45,.4,.08,materials.ivory));
 // Tennis proportions preserve a 2:1 court, service boxes, net and safe perimeter fence.
 solid.push(rect(H.court,.02,.04,'#5b879e'));for(const x of [1,3.8,1.365,3.435])solid.push(box(x,.067,11,.025,.008,H.court.playDepth,'#f7f7f0'));for(const z of [7.96,14.04,9.4,12.6])solid.push(box(2.4,.067,z,H.court.playWidth,.008,.025,'#f7f7f0'));solid.push(box(2.4,.067,11,.025,.008,3.2,'#f7f7f0'),box(2.4,.08,11,3.03,.38,.025,'#4d6054'));
 for(const z of [6.8,15.2]){for(let x=.5;x<=4.3;x+=.6)solid.push(box(x,.06,z,.025,1.1,.025,materials.green));for(const y of [.4,.8,1.16])solid.push(box(2.4,y,z,3.8,.025,.025,materials.green));}
 for(const x of [.5,4.3])for(let z=6.8;z<=15.2;z+=.7)solid.push(box(x,.06,z,.025,1.1,.025,materials.green));for(const x of [.5,4.3])solid.push(box(x,1.16,11,.03,.03,8.4,materials.green));
 // Low walls retain the view; two separate gates remain unobstructed.
 for(const x of [.25,19.75])solid.push(box(x,0,9.5,.16,.6,18.5,'#c6c3b4'));solid.push(box(6,0,18.75,11.5,.6,.16,'#c6c3b4'),box(16.875,0,18.75,5.75,.6,.16,'#c6c3b4'));
 for(const [x,w]of [[4.2,4.5],[14.025,11.45]])solid.push(box(x,0,.25,w,.6,.16,'#c6c3b4'));
 for(const x of [.48,1.52,7.6,8.3])solid.push(box(x,0,.25,.15,.85,.2,'#c6c3b4'));for(const x of [.55,1.45])solid.push(box(x,.05,.6,.04,.45,.7,materials.green));
 for(const [x,z]of [[1.2,17],[18.4,17],[18.5,7],[7.9,17],[9,2.8],[18,2.8]]){solid.push(box(x,0,z,.09,.65,.09,'#827a60'));plants.push(box(x,.55,z,.9,1.1,.9,'#63875e'));}
 // Palm crowns are static low-poly fronds, positioned clear of roof and paths.
 for(const [x,z]of [[18.8,3],[18.7,14.8]]){solid.push(box(x,0,z,.1,2.3,.1,'#8e8467'));for(const angle of [0,.9,1.8,2.7])plants.push({...box(x,2.1,z,1.5,.18,.22,'#63875e'),r:angle});}
 for(let x=9;x<18;x+=.6)if(Math.abs(x-13)>.6)plants.push(box(x,.06,17.9,.5,.4,.4,'#63875e'));
 for(const [x,z]of [[12.1,12.6],[13.9,12.6],[7.1,1.2],[8.4,1],[8.3,8],[8.3,15.6],[18.5,16.4]])lights.push(box(x,.12,z,.07,.12,.07,'#ffffff'));
 return {solid,glass,plants,water,lights};
 },[a,materials]);
 if(!a)return null;
 return <><Instanced items={[{p:[a.x+a.w/2,0,a.z+a.d/2],s:[a.w,TERRACE_H,a.d]}]} geometry={g.box} material={m.terrace}/><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.plants} geometry={g.ball} material={m.plain}/><Instanced items={parts.glass} geometry={g.box} material={materials.window} pick={{...pick,keys:parts.glass.map(()=>HILLS_KEY)}}/><Instanced items={parts.water} geometry={g.box} material={materials.water}/><Instanced items={parts.lights} geometry={g.box} material={night?m.lamp:m.plain}/><mesh position={[a.x+17.3,TERRACE_H+1.7,a.z+12]} geometry={materials.pavilion} scale={[1.1,3.1,1.1]} material={m.plain} castShadow/><mesh position={[a.x+17.3,TERRACE_H+3.35,a.z+12]} geometry={materials.pavilion} scale={[1.2,.12,1.2]} material={m.plain}/><mesh position={[a.x+13,TERRACE_H+.27,a.z+12.54]} geometry={materials.arch} material={materials.window}/></>;
}
