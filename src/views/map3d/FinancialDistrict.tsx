import {CLEAR_ARCHITECTURAL_GLASS} from './architecturalGlass';
import {financialArchitecture,financialDimensions} from './financialArchitecture';
import {FinancialSigns} from "./FinancialSigns";
import {financialBrand,financialSignPlacement,FINANCIAL_SIGN} from "./financialBrands";
import {useEffect,useMemo} from 'react';
import * as THREE from 'three';
import {Instanced,type Inst,type PickHandlerSet,type useGeometries,type useMaterials} from './models';
import {FINANCIAL as F,financialKey,FINANCIAL_PARK_KEY,type FinancialPlan} from './financialPlan';
import {TRANSPORT} from './transportScale';
import {TERRACE_H} from './scene';
/** Static instanced skyline; shared windows switch with Atlas day/night preferences. */
export function FinancialDistrict({plan:a,g,m,pick,night}:{plan?:FinancialPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:PickHandlerSet;night:boolean}){
 const materials=useMemo(()=>{const css=getComputedStyle(document.documentElement);return {ivory:css.getPropertyValue('--sage-50').trim()||'#f7f7f0',green:css.getPropertyValue('--forest-700').trim()||'#294237',gold:css.getPropertyValue('--gold').trim()||'#c9a35a',water:new THREE.MeshStandardMaterial({color:'#6daeb6',roughness:.35,emissive:'#225d67',emissiveIntensity:0}),window:new THREE.MeshStandardMaterial({color:'#72a7b3',roughness:.36,emissive:'#ffe0a6',emissiveIntensity:0})}},[]);
 useEffect(()=>{materials.window.color.set(night?'#e8d8a9':'#72a7b3');materials.window.emissiveIntensity=night?.65:0;materials.water.emissiveIntensity=night?.2:0},[night,materials]);
 useEffect(()=>()=>{materials.window.dispose();materials.water.dispose()},[materials]);
 const parts=useMemo(()=>{
 const solid:Inst[]=[],glass:Inst[]=[],clearGlass:Inst[]=[],glow:Inst[]=[],clearKeys:string[]=[],bevelled:Inst[]=[],plants:Inst[]=[],lights:Inst[]=[],keys:string[]=[];if(!a)return {solid,glass,clearGlass,glow,clearKeys,bevelled,plants,lights,keys};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[a.x+x,TERRACE_H+y,a.z+z],s:[w,h,d],c});
 const pane=(key:string,p:Inst)=>{glass.push(p);keys.push(key)};

 // Both blocks share the same local street and waterfront boulevard.
 const center=a.w/2,span=a.w-.4;
 solid.push(box(center,.025,F.streetZ,span,.035,TRANSPORT.cityWidth,'#424b50'),box(center,.065,F.promenadeZ,span,.045,.65,'#e4ddcd'),box(center,.04,F.northWalkZ,span,.045,.6,'#e4ddcd'));
 for(let x=1;x<a.w-1;x+=.7)if(!F.crossings.some(c=>Math.abs(c-x)<.45))solid.push(box(x,.067,F.streetZ,.32,.006,.025,'#e5dfc9'));
 const curbSpans:[number,number][]=[];let previous=.2;
 for(const crossing of F.crossings){curbSpans.push([previous,crossing-.35]);previous=crossing+.35;}curbSpans.push([previous,a.w-.2]);
 for(const z of [F.streetZ-TRANSPORT.cityWidth/2-.04,F.streetZ+TRANSPORT.cityWidth/2+.04])for(const [lo,hi]of curbSpans)solid.push(box((lo+hi)/2,.055,z,hi-lo,.055,.07,'#cfcbbd'));
 for(const x of F.crossings){solid.push(box(x,.04,12.15,.6,.045,.4,'#e4ddcd'),box(x,.055,13.6,.6,.045,1.1,'#e4ddcd'));for(let z=12.42;z<=12.98;z+=.12)solid.push(box(x,.069,z,.55,.008,.055,'#f7f7f0'));}
 for(const b of a.buildings){
  const dimensions=financialDimensions(b.id);
  if(financialBrand(b.id)?.architecture){
   const mesh=financialArchitecture(b.id,b.height,materials),key=financialKey(b.id);
   const place=(p:Inst):Inst=>({...p,p:[a.x+b.x+p.p[0],TERRACE_H+p.p[1],a.z+b.z+p.p[2]]});
   solid.push(box(b.x,.04,b.z,dimensions.w,.12,dimensions.d,'#d4d0bf'),...mesh.solid.map(place));
   bevelled.push(...mesh.bevelled.map(place));plants.push(...mesh.leaves.map(place));
   for(const p of mesh.glass)pane(key,place(p));
   for(const p of mesh.clearGlass){clearGlass.push(place(p));clearKeys.push(key);}glow.push(...mesh.glow.map(place));
   // Sliding entrance panes are shared with the visitor simulation.
   const doorZ=b.z+dimensions.depth/2+.04,landingZ=b.approach[0][1]-a.z;solid.push(box(b.x,.04,(doorZ+landingZ)/2,.6,.04,landingZ-doorZ+.03,'#e5dfd0'));
   for(let i=1;i<b.approach.length;i++){const u=b.approach[i-1],v=b.approach[i],length=Math.hypot(v[0]-u[0],v[1]-u[1]);if(length>.01)solid.push({...box((u[0]+v[0])/2-a.x,.04,(u[1]+v[1])/2-a.z,.6,.04,length+.03,'#e5dfd0'),r:Math.atan2(v[0]-u[0],v[1]-u[1])});}
   for(const side of [-1,1])lights.push(box(b.x+side*.6,.15,b.z+dimensions.depth/2+.35,.04,.12,.04,'#ffffff'));
   continue;
  }
  const {x,z,height:h}=b,brand=financialBrand(b.id),body=brand?.body??materials.ivory,trim=brand?.trim??'#aabbb8',accent=brand?.accent??materials.gold,key=financialKey(b.id),w=F.towerWidth,d=F.towerDepth;
  solid.push(box(x,.04,z,w+.5,.12,d+.5,'#d4d0bf'),box(x,brand?1.1:.16,z,w,(b.style==='stepped'?h*.62:h)-(brand?1.1:.16),d,body));
  if(b.style==='stepped')solid.push(box(x,h*.62,z,w*.74,h*.38,d,materials.ivory));
  const levels=Math.max(12,Math.floor((h-.8)/.3)),step=(h-.8)/levels;
  for(let floor=0;floor<levels;floor++){
   const yy=.65+floor*step,ww=b.style==='stepped'&&floor>levels*.62?w*.74:w;
   if(brand&&(yy<1.1||yy>h-FINANCIAL_SIGN.windowSetback))continue;
   for(const side of [-1,1])for(let col=0;col<6;col++)pane(key,box(x-ww/2+.27+col*(ww-.54)/5,yy,z+side*(d/2+.012),.32,step*.7,.025,brand?brand.glass:'#ffffff'));
   for(const side of [-1,1])for(let col=0;col<4;col++)pane(key,box(x+side*(ww/2+.012),yy,z-d/2+.35+col*(d-.7)/3,.025,step*.7,.36,brand?brand.glass:'#ffffff'));
   if(floor%3===0)solid.push(box(x,yy-.06,z,ww+.04,.035,d+.04,brand?.trim??'#b7c7c5'));
   if(b.style==='balcony'&&floor>0&&floor%3===0){solid.push(box(x,yy-.09,z+d/2+.22,w+.1,.06,.45,'#deded4'),box(x,yy+.2,z+d/2+.43,w,.04,.025,materials.green));for(const dx of [-1.25,0,1.25])solid.push(box(x+dx,yy-.03,z+d/2+.43,.025,.25,.025,materials.green));}
  }
  if(brand){for(const dx of [-w/2+.025,w/2-.025])for(const dz of [-d/2+.025,d/2-.025])solid.push(box(x+dx,.16,z+dz,.06,h-.16,.06,trim));}
  else for(const dx of [-w/2,w/2])solid.push(box(x+dx,.16,z,.06,(b.style==='stepped'?h*.62:h)-.16,d+.05,trim));
  if(b.style==='stepped')for(const dx of [-w*.37,w*.37])solid.push(box(x+dx,h*.62,z,.06,h*.38,d+.05,trim));
  solid.push(box(x,h,z,(b.style==='stepped'?w*.74:w)+.12,.13,d+.12,materials.ivory),box(x,h+.13,z,w*.7,.16,d*.7,'#99b6b9'));
  if(b.style==='crown'&&!brand){solid.push(box(x,h+.29,z,w*.45,.38,d*.45,materials.gold),box(x,h+.67,z,.08,.5,.08,materials.gold));}
  if(b.style==='articulated'&&!brand)solid.push(box(x+.8,.16,z+.15,.18,h-.16,d+.32,materials.gold));
  if(brand){
   const sign=financialSignPlacement(h,d);
   solid.push(box(x,sign.bottom-.02,z+d/2+.04,2.7,.69,.055,brand.signBackground),box(x+w/2+.04,sign.bottom-.02,z,.055,.69,2.55,brand.signBackground));
   solid.push(box(x,.16,z,w-.12,.04,d-.12,body),box(x,.2,z-d/2+.1,w-.12,.9,.09,body));
   // Reception and seating remain behind transparent glazing, clear of the doorway.
   solid.push(box(x-.65,.2,z-.2,.9,.32,.35,body),box(x-.65,.52,z-.2,1,.045,.4,accent),box(x-.65,.56,z-.32,.25,.2,.035,trim),box(x+.9,.2,z-.35,.45,.25,.5,body),box(x+.9,.45,z-.56,.45,.3,.07,trim));
   if(b.id==='investments')for(const [level,width]of [[.13,2.35],[.33,1.8],[.58,1.2]])solid.push(box(x,h+level,z,width,.2,d*.65,level===.58?accent:trim));
   else solid.push(box(x,h+.3,z,w*.8,.18,d*.75,accent));
  }
  // Visible double door and thin canopy; approach remains clear of decorative planting.
  if(!brand)pane(key,box(x,.17,z+d/2+.04,.7,.55,.035,'#ffffff'));
  solid.push(box(x,.85,z+d/2+.13,1.05,.06,.42,accent));
  for(const side of [-1,1])solid.push(box(x+side*.37,.17,z+d/2+.065,.025,.65,.04,materials.green));
  const doorZ=z+d/2+.04,landingZ=b.approach[0][1]-a.z;solid.push(box(x,.04,(doorZ+landingZ)/2,.6,.04,landingZ-doorZ+.03,'#e5dfd0'));
  for(let i=1;i<b.approach.length;i++){const u=b.approach[i-1],v=b.approach[i],length=Math.hypot(v[0]-u[0],v[1]-u[1]);if(length>.01)solid.push({...box((u[0]+v[0])/2-a.x,.04,(u[1]+v[1])/2-a.z,.6,.04,length+.03,'#e5dfd0'),r:Math.atan2(v[0]-u[0],v[1]-u[1])});}
  for(const side of [-1,1]){solid.push(box(x+side*1.6,.08,z+d/2+.2,.08,.3,.08,materials.green));lights.push(box(x+side*.6,.15,z+d/2+.35,.04,.12,.04,'#ffffff'));}
 }
 // Keep the original eastern gates open; the western waterfront stays protected.
 solid.push(box(.18,0,a.d/2,.18,.35,a.d-.4,'#c6c3b4'),box(a.w-.18,0,5.7,.18,.35,11,'#c6c3b4'),box(a.w-.18,0,14.65,.18,.35,.2,'#c6c3b4'));
 solid.push(box(center,0,.18,span,.35,.18,'#c6c3b4'),box(center,0,a.d-.18,span,.23,.16,'#c6c3b4'),box(center,.5,a.d-.18,span,.035,.035,materials.green));
 for(let x=.4;x<a.w-.3;x+=.5)solid.push(box(x,.23,a.d-.18,.025,.27,.025,materials.green));
 for(const [x,z]of a.perimeterTrees){solid.push(box(x,0,z,.07,.7,.07,'#8b7f65'));plants.push(box(x,.9,z,F.perimeterTreeRadius,.8,F.perimeterTreeRadius,'#70956c'));}
 for(let x=1;x<a.w-1;x+=2.5)lights.push(box(x,.14,14.5,.06,.12,.06,'#ffffff'));
 return {solid,glass,clearGlass,glow,clearKeys,bevelled,plants,lights,keys};
 },[a,materials]);
 const windows=useMemo(()=>parts.glass.map(p=>({...p,c:night?'#ffffff':p.c})),[parts,night]);
 const bevelGeometry=useMemo(()=>{
  const cx=.34/3.6,cz=.34/2.8,shape=new THREE.Shape();
  const points=[[-.5+cx,-.5],[.5-cx,-.5],[.5,-.5+cz],[.5,.5-cz],[.5-cx,.5],[-.5+cx,.5],[-.5,.5-cz],[-.5,-.5+cz]];
  shape.moveTo(points[0][0],points[0][1]);for(const [x,z]of points.slice(1))shape.lineTo(x,z);shape.closePath();
  return new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false}).rotateX(-Math.PI/2);
 },[]);
 useEffect(()=>()=>bevelGeometry.dispose(),[bevelGeometry]);
 const curtain=useMemo(()=>new THREE.MeshPhysicalMaterial(CLEAR_ARCHITECTURAL_GLASS),[]);
 const interiorGlow=useMemo(()=>new THREE.MeshStandardMaterial({color:'#eee4cb',emissive:'#ffe0a0',emissiveIntensity:0,roughness:.7}),[]);
 useEffect(()=>{interiorGlow.emissiveIntensity=night?.8:.02;},[night,interiorGlow]);
 useEffect(()=>()=>{curtain.dispose();interiorGlow.dispose();},[curtain,interiorGlow]);
 const lobbyGlass=useMemo(()=>new THREE.MeshStandardMaterial({color:'#c8e2e7',transparent:true,opacity:.28,depthWrite:false,roughness:.18}),[]);
 useEffect(()=>()=>lobbyGlass.dispose(),[lobbyGlass]);
 const foyer=useMemo(()=>{const items:Inst[]=[],keys:string[]=[];if(a)for(const b of a.buildings.filter(b=>financialBrand(b.id))){const key=financialKey(b.id),x=a.x+b.x,z=a.z+b.z,size=financialDimensions(b.id);for(const side of [-1,1]){items.push({p:[x+side*.98,TERRACE_H+.2,z+size.depth/2+.025],s:[.72,.85,.025]},{p:[x+side*(size.width/2+.025),TERRACE_H+.2,z],s:[.025,.85,size.depth-.1]});keys.push(key,key);}}return {items,keys}},[a]);
 const parkParts=useMemo(()=>{
 const solid:Inst[]=[],plants:Inst[]=[],water:Inst[]=[],lights:Inst[]=[];if(!a)return {solid,plants,water,lights};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[a.x+x,TERRACE_H+y,a.z+z],s:[w,h,d],c});
 for(const path of a.park.paths)for(let i=1;i<path.length;i++){const u=path[i-1],v=path[i],length=Math.hypot(v[0]-u[0],v[1]-u[1]);solid.push({...box((u[0]+v[0])/2,.025,(u[1]+v[1])/2,.5,.045,length+.025,'#e5dfd0'),r:Math.atan2(v[0]-u[0],v[1]-u[1])});}
 // Plazas at the head and foot of the fountain axis, in a lighter stone than the paths.
 for(const r of a.park.plazas)solid.push(box(r.x+r.w/2,.026,r.z+r.d/2,r.w,.05,r.d,'#ece5d3'));
 // Stepped fountain: four basins, each a little lower than the one above it, with stone rims.
 for(const q of a.park.pools){const cx=q.x+q.w/2,cz=q.z+q.d/2;
  solid.push(box(cx,.025,cz,q.w+.3,.035,q.d+.3,'#d4cebe'),box(cx,.025,cz,q.w,q.rise-.06,q.d,'#bfb7a2'));water.push(box(cx,Math.max(q.rise-.035,.064),cz,q.w,.02,q.d,'#ffffff'));
  for(const x of [q.x-.08,q.x+q.w+.08])solid.push(box(x,.025,cz,.12,q.rise+.03,q.d+.3,'#cfc8b5'));
  for(const z of [q.z-.08,q.z+q.d+.08])solid.push(box(cx,.025,z,q.w,q.rise+.03,.12,'#cfc8b5'));
  solid.push(box(cx,q.rise,cz,.08,.14,.08,'#cfc8b5'));}
 // Sculpture gardens: a bright round lawn ringed by a narrow path.
 for(const ring of a.park.rings){const n=14;plants.push(box(ring.x,-.05,ring.z,ring.r-.12,.08,ring.r-.12,'#8fbf6a'));
  for(let i=0;i<n;i++){const t0=i/n*Math.PI*2,t1=(i+1)/n*Math.PI*2,u:[number,number]=[ring.x+Math.cos(t0)*ring.r,ring.z+Math.sin(t0)*ring.r],v:[number,number]=[ring.x+Math.cos(t1)*ring.r,ring.z+Math.sin(t1)*ring.r];
   solid.push({...box((u[0]+v[0])/2,.025,(u[1]+v[1])/2,.24,.045,Math.hypot(v[0]-u[0],v[1]-u[1])+.03,'#e5dfd0'),r:Math.atan2(v[0]-u[0],v[1]-u[1])});}}
 for(const [x,z]of a.park.sculptures){solid.push(box(x,.04,z,.32,.12,.32,'#d4cebe'),box(x-.04,.16,z,.08,.55,.08,'#c9a35a'));plants.push(box(x+.06,.78,z,.13,.13,.13,'#c9a35a'));}
 // Flower beds: a soil planter with three clumps of blooms.
 for(const b of a.park.beds){solid.push(box(b.x+b.w/2,.02,b.z+b.d/2,b.w,.05,b.d,'#7d6a52'));for(const k of [-1,0,1])plants.push(box(b.x+b.w/2+(k===0?.05:-.04),.1,b.z+b.d/2+k*b.d*.3,.17,.11,.16,b.c));}
 for(const [x,z,r]of a.park.shrubs)plants.push(box(x,r*.55,z,r,r*.8,r,'#5f8a58'));
 // Palms (KC, 2026-10-31): a ringed trunk and a crown of drooping fronds, each a flattened ball
 // pushed out from the top and tipped down, with a few coconuts. Same instanced meshes as before.
 for(const [i,[x,z]]of a.park.trees.entries()){const top=1.75+(i%3)*.12;
  solid.push(box(x,.02,z,.11,top*.5,.11,'#9a8a68'),box(x,.02+top*.5,z,.09,top*.5,.09,'#8e7f5f'));
  for(const y of [.45,.9,1.35])if(y<top)solid.push(box(x,y,z,.12,.03,.12,'#7d6f53'));
  for(let k=0;k<7;k++){const t=k/7*Math.PI*2+i*.4;plants.push({...box(x+Math.sin(t)*.42,top-.05,z+Math.cos(t)*.42,.16,.06,.55,k%2?'#5c8f4e':'#6ea35a'),r:t,rx:.42});}
  plants.push(box(x,top+.02,z,.16,.12,.16,'#5c8f4e'));
  for(const t of [.6,2.7,4.8])plants.push(box(x+Math.sin(t)*.09,top-.12,z+Math.cos(t)*.09,.06,.06,.06,'#8a6a3e'));}
 for(const [x,z]of a.park.benches){solid.push(box(x,.015,z,1.3,.025,.75,'#d4cebe'),box(x,.18,z,1,.08,.35,'#b68c60'),box(x,.26,z+.15,1,.4,.07,'#b68c60'));for(const side of [-1,1])solid.push(box(x+side*.38,.04,z,.07,.14,.28,materials.green));}
 for(const [x,z]of a.park.lights){solid.push(box(x,.02,z,.05,.28,.05,materials.green));lights.push(box(x,.3,z,.07,.05,.07,'#ffffff'));}
 return {solid,plants,water,lights};
 },[a,materials]);
 if(!a)return null;
 return <><FinancialSigns plan={a} night={night} pick={pick}/><Instanced items={foyer.items} geometry={g.box} material={lobbyGlass} pick={pick.of(foyer.keys)}/><Instanced items={a?[{p:[a.x+a.park.x+a.park.w/2,TERRACE_H+.01,a.z+a.park.z+a.park.d/2],s:[a.park.w,.012,a.park.d],c:'#82a871'}]:[]} geometry={g.box} material={m.plain} pick={pick.of([FINANCIAL_PARK_KEY])}/><Instanced items={parkParts.solid} geometry={g.box} material={m.plain}/><Instanced items={parkParts.plants} geometry={g.ball} material={m.plain}/><Instanced items={parkParts.water} geometry={g.box} material={materials.water}/><Instanced items={parkParts.lights} geometry={g.ball} material={night?m.lamp:m.plain}/><Instanced items={[{p:[a.x+a.w/2,0,a.z+a.d/2],s:[a.w,TERRACE_H,a.d]}]} geometry={g.box} material={m.terrace}/><group name="amex-clear-facade"><Instanced items={parts.clearGlass} geometry={g.box} material={curtain} shadow={false} pick={pick.of(parts.clearKeys)}/></group><Instanced items={parts.glow} geometry={g.box} material={interiorGlow} shadow={false}/><Instanced items={parts.bevelled} geometry={bevelGeometry} material={m.plain}/><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={windows} geometry={g.box} material={materials.window} pick={{...pick.of(parts.keys),keys:parts.keys}}/><Instanced items={parts.plants} geometry={g.ball} material={m.plain}/><Instanced items={parts.lights} geometry={g.ball} material={night?m.lamp:m.plain}/></>;
}
