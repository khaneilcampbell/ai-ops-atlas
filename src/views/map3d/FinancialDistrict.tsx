import {CLEAR_ARCHITECTURAL_GLASS,TINTED_OFFICE_GLASS} from './architecturalGlass';
import {financialArchitecture,financialDimensions} from './financialArchitecture';
import {FinancialSigns} from "./FinancialSigns";
import {financialBrand,financialSignPlacement,FINANCIAL_SIGN} from "./financialBrands";
import {useEffect,useMemo} from 'react';
import * as THREE from 'three';
import {Instanced,type Inst,type PickHandlerSet,type useGeometries,type useMaterials} from './models';
import {FINANCIAL as F,financialKey,FINANCIAL_PARK_KEY,type FinancialPlan} from './financialPlan';
import {TRANSPORT} from './transportScale';
import {intersectionParts,type financialJunctions} from './junctions';
import {TERRACE_H} from './scene';
import {CircaTowers} from './CircaTowers';
import {CITY_SCALE,scaleFootprint} from './cityScale';
/** Static instanced skyline; shared windows switch with Atlas day/night preferences. */
export function FinancialDistrict({plan:a,junctions,g,m,pick,night,moving=false}:{plan?:FinancialPlan;junctions?:ReturnType<typeof financialJunctions>;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;pick:PickHandlerSet;night:boolean;moving?:boolean}){
 const materials=useMemo(()=>{const css=getComputedStyle(document.documentElement);return {ivory:css.getPropertyValue('--sage-50').trim()||'#f7f7f0',green:css.getPropertyValue('--forest-700').trim()||'#294237',gold:css.getPropertyValue('--gold').trim()||'#c9a35a',water:new THREE.MeshStandardMaterial({color:'#6daeb6',roughness:.35,emissive:'#225d67',emissiveIntensity:0}),window:new THREE.MeshStandardMaterial({color:'#72a7b3',roughness:.36,emissive:'#ffe0a6',emissiveIntensity:0})}},[]);
 useEffect(()=>{materials.window.color.set(night?'#e8d8a9':'#72a7b3');materials.window.emissiveIntensity=night?.65:0;materials.water.emissiveIntensity=night?.2:0},[night,materials]);
 useEffect(()=>()=>{materials.window.dispose();materials.water.dispose()},[materials]);
 const parts=useMemo(()=>{
 const solid:Inst[]=[],glass:Inst[]=[],clearGlass:Inst[]=[],tinted:Inst[]=[],tintedKeys:string[]=[],glow:Inst[]=[],clearKeys:string[]=[],bevelled:Inst[]=[],plants:Inst[]=[],lights:Inst[]=[],keys:string[]=[];if(!a)return {solid,glass,clearGlass,tinted,tintedKeys,glow,clearKeys,bevelled,plants,lights,keys};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[a.x+x,TERRACE_H+y,a.z+z],s:[w,h,d],c});
 const pane=(key:string,p:Inst)=>{glass.push(p);keys.push(key)};

 // Both blocks share the same local street and waterfront boulevard.
 // Side roads meet it at junctions: one clean opening each, with no curb, walk or dash across it.
 const center=a.w/2,span=a.w-.4,toLocal=([lo,hi]:[number,number]):[number,number]=>[lo-a.x,hi-a.x],local=(junctions?.spans??[]).map(j=>({...j,lo:j.lo-a.x,hi:j.hi-a.x}));
 const cut=intersectionParts(F.streetZ,.2,a.w-.2,F.crossings,local,{north:F.northWalkZ,south:F.promenadeZ},{north:.6,south:.65},{north:(junctions?.walks.north??[]).map(toLocal),south:(junctions?.walks.south??[]).map(toLocal)});
 solid.push(box(center,.025,F.streetZ,span,.035,TRANSPORT.cityWidth,'#424b50'));
 for(const [lo,hi] of cut.walks.south)solid.push(box((lo+hi)/2,.065,F.promenadeZ,hi-lo,.045,.65,'#e4ddcd'));
 for(const [lo,hi] of cut.walks.north)solid.push(box((lo+hi)/2,.04,F.northWalkZ,hi-lo,.045,.6,'#e4ddcd'));
 for(const d of cut.dashes)solid.push(box(d,.067,F.streetZ,.32,.006,.025,'#e5dfc9'));
 for(const [z,spans] of [[F.streetZ-TRANSPORT.cityWidth/2-.04,cut.curbs.north],[F.streetZ+TRANSPORT.cityWidth/2+.04,cut.curbs.south]] as const)for(const [lo,hi]of spans)solid.push(box((lo+hi)/2,.055,z,hi-lo,.055,.07,'#cfcbbd'));
 for(const p of cut.patches)solid.push(box(p.x,p.y,p.z,p.w,p.h,p.d,p.c));
 for(const x of F.crossings){solid.push(box(x,.04,12.15,.6,.045,.4,'#e4ddcd'),box(x,.055,13.6,.6,.045,1.1,'#e4ddcd'));for(let z=12.42;z<=12.98;z+=.12)solid.push(box(x,.069,z,.55,.008,.055,'#f7f7f0'));}
 for(const b of a.buildings){
  const dimensions=financialDimensions(b.id);
  if(financialBrand(b.id)?.architecture){
   const mesh=financialArchitecture(b.id,b.height,materials),key=financialKey(b.id);
   const place=(p:Inst):Inst=>({...p,p:[a.x+b.x+p.p[0],TERRACE_H+p.p[1],a.z+b.z+p.p[2]]});
   // Circa (twin) draws its own entrance pavilion and landing, so it gets no plinth, door landing or door lamps here.
   const twin=financialBrand(b.id)?.architecture==='twin';
   if(!twin)solid.push(box(b.x,.04,b.z,dimensions.w,.12,dimensions.d,'#d4d0bf'));solid.push(...mesh.solid.map(place));
   bevelled.push(...mesh.bevelled.map(place));plants.push(...mesh.leaves.map(place));
   for(const p of mesh.glass)pane(key,place(p));
   for(const p of mesh.clearGlass){clearGlass.push(place(p));clearKeys.push(key);}for(const p of mesh.tintedGlass){tinted.push(place(p));tintedKeys.push(key);}glow.push(...mesh.glow.map(place));
   // Sliding entrance panes are shared with the visitor simulation.
   const doorZ=b.z+dimensions.depth/2+.04,landingZ=b.approach[0][1]-a.z;if(!twin)solid.push(box(b.x,.04,(doorZ+landingZ)/2,.6,.04,landingZ-doorZ+.03,'#e5dfd0'));
   for(let i=1;i<b.approach.length;i++){const u=b.approach[i-1],v=b.approach[i],length=Math.hypot(v[0]-u[0],v[1]-u[1]);if(length>.01)solid.push({...box((u[0]+v[0])/2-a.x,.04,(u[1]+v[1])/2-a.z,.6,.04,length+.03,'#e5dfd0'),r:Math.atan2(v[0]-u[0],v[1]-u[1])});}
   if(!twin)for(const side of [-1,1])lights.push(box(b.x+side*.6*CITY_SCALE.financial.footprint,.15,b.z+dimensions.depth/2+.35,.04,.12,.04,'#ffffff'));
   continue;
  }
  // Drawn at the designed footprint about (0, 0), then narrowed in plan like the other towers (CITY_SCALE.financial).
  const x=0,z=0,h=b.height,local:Inst[]=[],localLights:Inst[]=[],localGlass:Inst[]=[],at=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[x,y,z],s:[w,h,d],c}),brand=financialBrand(b.id),body=brand?.body??materials.ivory,trim=brand?.trim??'#aabbb8',accent=brand?.accent??materials.gold,key=financialKey(b.id),w=F.towerWidth,d=F.towerDepth;
  local.push(at(x,.04,z,w+.5,.12,d+.5,'#d4d0bf'),at(x,brand?1.1:.16,z,w,(b.style==='stepped'?h*.62:h)-(brand?1.1:.16),d,body));
  if(b.style==='stepped')local.push(at(x,h*.62,z,w*.74,h*.38,d,materials.ivory));
  const levels=Math.max(12,Math.floor((h-.8)/.3)),step=(h-.8)/levels;
  for(let floor=0;floor<levels;floor++){
   const yy=.65+floor*step,ww=b.style==='stepped'&&floor>levels*.62?w*.74:w;
   if(brand&&(yy<1.1||yy>h-FINANCIAL_SIGN.windowSetback))continue;
   for(const side of [-1,1])for(let col=0;col<6;col++)localGlass.push(at(x-ww/2+.27+col*(ww-.54)/5,yy,z+side*(d/2+.012),.32,step*.7,.025,brand?brand.glass:'#ffffff'));
   for(const side of [-1,1])for(let col=0;col<4;col++)localGlass.push(at(x+side*(ww/2+.012),yy,z-d/2+.35+col*(d-.7)/3,.025,step*.7,.36,brand?brand.glass:'#ffffff'));
   if(floor%3===0)local.push(at(x,yy-.06,z,ww+.04,.035,d+.04,brand?.trim??'#b7c7c5'));
   if(b.style==='balcony'&&floor>0&&floor%3===0){local.push(at(x,yy-.09,z+d/2+.22,w+.1,.06,.45,'#deded4'),at(x,yy+.2,z+d/2+.43,w,.04,.025,materials.green));for(const dx of [-1.25,0,1.25])local.push(at(x+dx,yy-.03,z+d/2+.43,.025,.25,.025,materials.green));}
  }
  if(brand){for(const dx of [-w/2+.025,w/2-.025])for(const dz of [-d/2+.025,d/2-.025])local.push(at(x+dx,.16,z+dz,.06,h-.16,.06,trim));}
  else for(const dx of [-w/2,w/2])local.push(at(x+dx,.16,z,.06,(b.style==='stepped'?h*.62:h)-.16,d+.05,trim));
  if(b.style==='stepped')for(const dx of [-w*.37,w*.37])local.push(at(x+dx,h*.62,z,.06,h*.38,d+.05,trim));
  local.push(at(x,h,z,(b.style==='stepped'?w*.74:w)+.12,.13,d+.12,materials.ivory),at(x,h+.13,z,w*.7,.16,d*.7,'#99b6b9'));
  if(b.style==='crown'&&!brand){local.push(at(x,h+.29,z,w*.45,.38,d*.45,materials.gold),at(x,h+.67,z,.08,.5,.08,materials.gold));}
  if(b.style==='articulated'&&!brand)local.push(at(x+.8,.16,z+.15,.18,h-.16,d+.32,materials.gold));
  if(brand){
   const sign=financialSignPlacement(h,d);
   local.push(at(x,sign.bottom-.02,z+d/2+.04,2.7,.69,.055,brand.signBackground),at(x+w/2+.04,sign.bottom-.02,z,.055,.69,2.55,brand.signBackground));
   local.push(at(x,.16,z,w-.12,.04,d-.12,body),at(x,.2,z-d/2+.1,w-.12,.9,.09,body));
   // Reception and seating remain behind transparent glazing, clear of the doorway.
   local.push(at(x-.65,.2,z-.2,.9,.32,.35,body),at(x-.65,.52,z-.2,1,.045,.4,accent),at(x-.65,.56,z-.32,.25,.2,.035,trim),at(x+.9,.2,z-.35,.45,.25,.5,body),at(x+.9,.45,z-.56,.45,.3,.07,trim));
   if(b.id==='investments')for(const [level,width]of [[.13,2.35],[.33,1.8],[.58,1.2]])local.push(at(x,h+level,z,width,.2,d*.65,level===.58?accent:trim));
   else local.push(at(x,h+.3,z,w*.8,.18,d*.75,accent));
  }
  // Visible double door and thin canopy; approach remains clear of decorative planting.
  if(!brand)localGlass.push(at(x,.17,z+d/2+.04,.7,.55,.035,'#ffffff'));
  local.push(at(x,.85,z+d/2+.13,1.05,.06,.42,accent));
  for(const side of [-1,1])local.push(at(x+side*.37,.17,z+d/2+.065,.025,.65,.04,materials.green));
  for(const side of [-1,1]){local.push(at(x+side*1.6,.08,z+d/2+.2,.08,.3,.08,materials.green));localLights.push(at(x+side*.6,.15,z+d/2+.35,.04,.12,.04,'#ffffff'));}
  const k=CITY_SCALE.financial.footprint,place=(p:Inst):Inst=>({...p,p:[a.x+b.x+p.p[0],TERRACE_H+p.p[1],a.z+b.z+p.p[2]]});
  solid.push(...scaleFootprint(local,k).map(place));lights.push(...scaleFootprint(localLights,k).map(place));for(const p of scaleFootprint(localGlass,k))pane(key,place(p));
  const doorZ=b.z+dimensions.depth/2+.04,landingZ=b.approach[0][1]-a.z;solid.push(box(b.x,.04,(doorZ+landingZ)/2,.6,.04,landingZ-doorZ+.03,'#e5dfd0'));
  for(let i=1;i<b.approach.length;i++){const u=b.approach[i-1],v=b.approach[i],length=Math.hypot(v[0]-u[0],v[1]-u[1]);if(length>.01)solid.push({...box((u[0]+v[0])/2-a.x,.04,(u[1]+v[1])/2-a.z,.6,.04,length+.03,'#e5dfd0'),r:Math.atan2(v[0]-u[0],v[1]-u[1])});}
 }
 // The western waterfront stays protected. With Circa next door the west wall stops short of the shared street, walks and promenade.
 // No wall on the east side: the district opens straight onto its neighbour (KC, 2026-11-09).
 const westWall=a.circa?F.northWalkZ-.5:a.d-.4;
 solid.push(box(.18,0,.2+westWall/2,.18,.35,westWall,'#c6c3b4'));
 // No wall on the street side or the station side either: the promenade and the station walks meet the neighbouring land level (KC, 2026-11-09).
 for(const [x,z]of a.perimeterTrees){solid.push(box(x,0,z,.07,.7,.07,'#8b7f65'));plants.push(box(x,.9,z,F.perimeterTreeRadius,.8,F.perimeterTreeRadius,'#70956c'));}
 for(let x=1;x<a.w-1;x+=2.5)lights.push(box(x,.02,14.5,.06,.12,.06,'#ffffff'));
 return {solid,glass,clearGlass,tinted,tintedKeys,glow,clearKeys,bevelled,plants,lights,keys};
 },[a,junctions,materials]);
 const windows=useMemo(()=>parts.glass.map(p=>({...p,c:night?'#ffffff':p.c})),[parts,night]);
 const bevelGeometry=useMemo(()=>{
  const cx=.34/3.6,cz=.34/2.8,shape=new THREE.Shape();
  const points=[[-.5+cx,-.5],[.5-cx,-.5],[.5,-.5+cz],[.5,.5-cz],[.5-cx,.5],[-.5+cx,.5],[-.5,.5-cz],[-.5,-.5+cz]];
  shape.moveTo(points[0][0],points[0][1]);for(const [x,z]of points.slice(1))shape.lineTo(x,z);shape.closePath();
  return new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false}).rotateX(-Math.PI/2);
 },[]);
 useEffect(()=>()=>bevelGeometry.dispose(),[bevelGeometry]);
 const curtain=useMemo(()=>new THREE.MeshPhysicalMaterial(CLEAR_ARCHITECTURAL_GLASS),[]);
 const officeGlass=useMemo(()=>new THREE.MeshPhysicalMaterial(TINTED_OFFICE_GLASS),[]);
 useEffect(()=>()=>officeGlass.dispose(),[officeGlass]);
 const interiorGlow=useMemo(()=>new THREE.MeshStandardMaterial({color:'#eee4cb',emissive:'#ffe0a0',emissiveIntensity:0,roughness:.7}),[]);
 useEffect(()=>{interiorGlow.emissiveIntensity=night?.8:.02;},[night,interiorGlow]);
 useEffect(()=>()=>{curtain.dispose();interiorGlow.dispose();},[curtain,interiorGlow]);
 const lobbyGlass=useMemo(()=>new THREE.MeshStandardMaterial({color:'#c8e2e7',transparent:true,opacity:.28,depthWrite:false,roughness:.18}),[]);
 useEffect(()=>()=>lobbyGlass.dispose(),[lobbyGlass]);
 const foyer=useMemo(()=>{const items:Inst[]=[],keys:string[]=[];if(a)for(const b of a.buildings.filter(b=>financialBrand(b.id)&&financialBrand(b.id)?.architecture!=='twin')){const key=financialKey(b.id),x=a.x+b.x,z=a.z+b.z,size=financialDimensions(b.id);for(const side of [-1,1]){items.push({p:[x+side*.98*CITY_SCALE.financial.footprint,TERRACE_H+.2,z+size.depth/2+.025],s:[.72*CITY_SCALE.financial.footprint,.85,.025]},{p:[x+side*(size.width/2+.025),TERRACE_H+.2,z],s:[.025,.85,size.depth-.1]});keys.push(key,key);}}return {items,keys}},[a]);
 const parkParts=useMemo(()=>{
 const solid:Inst[]=[],plants:Inst[]=[],water:Inst[]=[],lights:Inst[]=[];if(!a)return {solid,plants,water,lights};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[a.x+x,TERRACE_H+y,a.z+z],s:[w,h,d],c});
 for(const path of a.park.paths)for(let i=1;i<path.length;i++){const u=path[i-1],v=path[i],length=Math.hypot(v[0]-u[0],v[1]-u[1]);solid.push({...box((u[0]+v[0])/2,.025,(u[1]+v[1])/2,.5,.045,length+.025,'#e5dfd0'),r:Math.atan2(v[0]-u[0],v[1]-u[1])});}
 // Plazas at the head and foot of the fountain axis, in a lighter stone than the paths.
 for(const r of a.park.plazas)solid.push(box(r.x+r.w/2,.026,r.z+r.d/2,r.w,.05,r.d,'#ece5d3'));
 // Stepped fountain (Khaneil, 2026-11-13: more realistic): four granite basins, each a little lower than the one
 // above, with a dark liner under the water, a bevelled coping, a tiered bowl and jet in the middle, and a thin
 // sheet of water spilling over the lip into the next basin.
 a.park.pools.forEach((q,i)=>{const cx=q.x+q.w/2,cz=q.z+q.d/2,next=a.park.pools[i+1];
  solid.push(box(cx,.02,cz,q.w+.36,.03,q.d+.36,'#cdc6b4'),box(cx,.02,cz,q.w,q.rise-.05,q.d,'#4f5f63'));
  water.push(box(cx,Math.max(q.rise-.035,.064),cz,q.w-.02,.02,q.d-.02,'#ffffff'));
  // Coping: a wide flat cap over a slightly narrower plinth, all four sides.
  for(const x of [q.x-.09,q.x+q.w+.09])solid.push(box(x,.02,cz,.14,q.rise+.02,q.d+.32,'#c6bfac'),box(x,q.rise+.04,cz,.19,.025,q.d+.36,'#e1dbcb'));
  for(const z of [q.z-.09,q.z+q.d+.09])solid.push(box(cx,.02,z,q.w,q.rise+.02,.14,'#c6bfac'),box(cx,q.rise+.04,z,q.w+.36,.025,.19,'#e1dbcb'));
  // Tiered bowl on a pedestal, with a jet rising out of it and a little crown of spray.
  const top=q.rise+.02;solid.push(box(cx,top,cz,.07,.16,.07,'#d4cebe'));plants.push(box(cx,top+.17,cz,.1,.02,.1,'#d4cebe'));
  water.push(box(cx,top+.185,cz,.16,.01,.16,'#ffffff'));solid.push(box(cx,top+.19,cz,.014,.3,.014,'#eef8fa'));
  // Four small arcing jets from the bowl's rim back into the basin.
  for(let k=0;k<4;k++){const t=k*Math.PI/2+Math.PI/4;solid.push({...box(cx+Math.sin(t)*.12,top+.08,cz+Math.cos(t)*.12,.012,.16,.012,'#eef8fa'),r:t,rx:-.6});}
  // Spill sheet over the south lip into the next basin.
  if(next)solid.push(box(cx,next.rise-.02,q.z+q.d+.17,q.w*.62,top-next.rise+.06,.012,'#dff1f4'));
 });
 // Ring lawns are the city's own grass (the park slab), so no brighter disc of their own (Khaneil, 2026-11-13).
 for(const ring of a.park.rings){const n=14;
  for(let i=0;i<n;i++){const t0=i/n*Math.PI*2,t1=(i+1)/n*Math.PI*2,u:[number,number]=[ring.x+Math.cos(t0)*ring.r,ring.z+Math.sin(t0)*ring.r],v:[number,number]=[ring.x+Math.cos(t1)*ring.r,ring.z+Math.sin(t1)*ring.r];
   solid.push({...box((u[0]+v[0])/2,.025,(u[1]+v[1])/2,.24,.045,Math.hypot(v[0]-u[0],v[1]-u[1])+.03,'#e5dfd0'),r:Math.atan2(v[0]-u[0],v[1]-u[1])});}}
 for(const [x,z]of a.park.sculptures){solid.push(box(x,.04,z,.32,.12,.32,'#d4cebe'),box(x-.04,.16,z,.08,.55,.08,'#c9a35a'));plants.push(box(x+.06,.78,z,.13,.13,.13,'#c9a35a'));}
 // Flower beds: a raised stone planter with a clipped boxwood edge and a dense mass of blooms over green foliage.
 for(const b of a.park.beds){const cx=b.x+b.w/2,cz=b.z+b.d/2;
  solid.push(box(cx,.02,cz,b.w+.06,.07,b.d+.06,'#cfc8b5'),box(cx,.06,cz,b.w-.04,.03,b.d-.04,'#6b5a45'));
  for(const side of [-1,1]){plants.push(box(cx+side*(b.w/2-.06),.11,cz,.05,.045,(b.d-.1)/2,'#3f6e36'),box(cx,.11,cz+side*(b.d/2-.06),(b.w-.1)/2,.045,.05,'#3f6e36'));}
  plants.push(box(cx,.1,cz,(b.w-.2)/2,.04,(b.d-.2)/2,'#4f7d45'));
  for(let k=0;k<6;k++){const u=(k%2-.5)*.14,v=(Math.floor(k/2)-1)*b.d*.24;plants.push(box(cx+u,.15+(k%3)*.012,cz+v,.065,.04,.065,b.c));}}
 // The park's palms and shrubs are the city's planting, drawn by Landscape (financialParkPlanting, Khaneil 2026-11-13).
 // Park benches (Khaneil, 2026-11-13: more realistic): timber slats on cast-iron side frames, on a stone pad.
 for(const [x,z]of a.park.benches){solid.push(box(x,.015,z,1.3,.025,.75,'#d4cebe'));
  for(const k of [-1.5,-.5,.5,1.5])solid.push(box(x,.2,z-.04+k*.07,.98,.025,.055,'#a9784c'));
  for(const k of [0,1,2])solid.push({...box(x,.27+k*.085,z+.17+k*.012,.98,.055,.022,'#a9784c'),rx:-.18});
  for(const side of [-1,1]){const sx=x+side*.44;
   solid.push(box(sx,.04,z-.11,.035,.17,.035,materials.green),box(sx,.04,z+.13,.035,.47,.035,materials.green),box(sx,.185,z+.01,.035,.025,.3,materials.green),box(sx,.31,z-.04,.035,.02,.26,materials.green),box(sx,.21,z-.15,.035,.11,.03,materials.green));}}
 for(const [x,z]of a.park.lights){solid.push(box(x,.02,z,.05,.28,.05,materials.green));lights.push(box(x,.3,z,.07,.05,.07,'#ffffff'));}
 return {solid,plants,water,lights};
 },[a,materials]);
 if(!a)return null;
 return <><FinancialSigns plan={a} night={night} pick={pick}/><CircaTowers plan={a} g={g} m={m} night={night} pick={pick} moving={moving}/><Instanced items={foyer.items} geometry={g.box} material={lobbyGlass} pick={pick.of(foyer.keys)}/><Instanced items={a?[{p:[a.x+a.park.x+a.park.w/2,TERRACE_H+.01,a.z+a.park.z+a.park.d/2],s:[a.park.w,.012,a.park.d]}]:[]} geometry={g.box} material={m.terrace} pick={pick.of([FINANCIAL_PARK_KEY])}/><Instanced items={parkParts.solid} geometry={g.box} material={m.plain}/><Instanced items={parkParts.plants} geometry={g.ball} material={m.plain}/><Instanced items={parkParts.water} geometry={g.box} material={materials.water}/><Instanced items={parkParts.lights} geometry={g.bead} material={night?m.lamp:m.plain}/><Instanced items={[{p:[a.x+a.w/2,0,a.z+a.d/2],s:[a.w,TERRACE_H,a.d]}]} geometry={g.box} material={m.terrace}/><group name="amex-clear-facade"><Instanced items={parts.clearGlass} geometry={g.box} material={curtain} shadow={false} pick={pick.of(parts.clearKeys)}/><Instanced items={parts.tinted} geometry={g.box} material={officeGlass} shadow={false} pick={pick.of(parts.tintedKeys)}/></group><Instanced items={parts.glow} geometry={g.box} material={interiorGlow} shadow={false}/><Instanced items={parts.bevelled} geometry={bevelGeometry} material={m.plain}/><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={windows} geometry={g.box} material={materials.window} pick={{...pick.of(parts.keys),keys:parts.keys}}/><Instanced items={parts.plants} geometry={g.ball} material={m.plain}/><Instanced items={parts.lights} geometry={g.bead} material={night?m.lamp:m.plain}/></>;
}
