import {commuterAt,planRailCommuters} from './railCommuters';
import {crowdLimit,planDistrictWalkers,walkerAt} from './districtWalkers';
import {useQualityLevel} from '../../lib/governor';
import type {FinancialPlan} from './financialPlan';
import {useMemo,useRef,useEffect} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type PickHandlerSet,type useGeometries,type useMaterials} from './models';
import {TERRACE_H} from './scene';
import {COMMUNITY as C,communityKey,railDeck,railPoint,railState,type CommunityPlan,type RailPlan} from './hillsCommunityPlan';
import {TRANSPORT} from './transportScale';
import {distanceToRoad,offsetRoad,roadIntersections} from './highway';
import {usePowerProfile,useWindowFocused} from '../../lib/power';
import {PARK_STATION,parkStationParts} from './parkStationPlan';
function useCommunityPalette(){return useMemo(()=>{const css=getComputedStyle(document.documentElement);return {green:css.getPropertyValue('--forest-700').trim()||'#294237',gold:css.getPropertyValue('--gold').trim()||'#c9a35a'};},[]);}
type Shared={g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>};
/** All neighborhood architecture is static and instanced. The original estate stays separate. */
export function HillsCommunity({plan:p,g,m,pick,night}:{plan?:CommunityPlan;pick:PickHandlerSet;night:boolean}&Shared){
 const palette=useCommunityPalette();
 const parts=useMemo(()=>{const solid:Inst[]=[],glass:Inst[]=[],plants:Inst[]=[],lights:Inst[]=[],keys:string[]=[];if(!p)return {solid,glass,plants,lights,keys};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[p.x+x,TERRACE_H+y,p.z+z],s:[w,h,d],c});
 const strip=(a:[number,number],b:[number,number],w:number,y:number,h:number,c:string)=>{const len=Math.hypot(b[0]-a[0],b[1]-a[1]);solid.push({p:[(a[0]+b[0])/2,TERRACE_H+y,(a[1]+b[1])/2],s:[w,h,len+.015],r:Math.atan2(b[0]-a[0],b[1]-a[1]),c});};
 for(const path of p.streets)for(let i=1;i<path.length;i++)strip(path[i-1],path[i],TRANSPORT.cityWidth,.025,.035,'#424b50');
 for(let i=1;i<p.golfPath.length;i++)strip(p.golfPath[i-1],p.golfPath[i],.18,.06,.02,'#c7ccaf');
 for(const path of p.walks)for(let i=1;i<path.length;i++)strip(path[i-1],path[i],TRANSPORT.walkWidth,.07,.035,'#e3dfd2');
 // Village plaza and spa relaxation garden are kept away from the street.
 solid.push(box(10,.02,36.5,17.5,.04,2.6,'#ded8c8'),box(18.6,.015,41,1.1,.04,3.6,'#c9d9bd'));
 for(const x of [6.5,13.5]){solid.push(box(x,.05,36.5,1,.18,.5,'#b7b29d'),box(x,.23,36.7,1,.32,.07,palette.green));plants.push(box(x,.15,37.2,.4,.7,.4,'#64875d'));}
 // Gates frame separate pedestrian and driveway openings; residential frontages stay open.
 for(const z of [21.5,26.8])for(const [x,w]of [[1.5,1.5],[6.9,1.3],[12.9,1.3],[18.4,1.1]])solid.push(box(x,.05,z,w,.4,.1,'#c7c2b0'));
 solid.push(box(20.55,.05,22,.12,.8,.14,'#b9ad8d'),box(21.45,.05,22,.12,.8,.14,'#b9ad8d'),box(20.6,.05,22.3,.035,.6,.6,palette.green),box(21.4,.05,22.3,.035,.6,.6,palette.green));
 // Marked pedestrian crossing across the local access street, never the rail.
 for(const z of [20.5,26.35,29,34.5])for(let x=20.72;x<21.3;x+=.12)solid.push(box(x,.069,z,.06,.008,.48,'#f7f7f0'));
 for(let z=1.22;z<1.8;z+=.12)solid.push(box(7.95,.069,z,.48,.008,.06,'#f7f7f0'));
 for(const b of p.buildings){if(b.kind==='station'||b.kind==='golf')continue;
 const {x,z,w,d,h}=b,key=communityKey(b.id),house=b.kind==='house';
 solid.push(box(x,0,z,w+.25,.12,d+.25,'#cfc7b6'),box(x,.12,z,w,h,d,b.color),box(x,h+.12,z,w+.25,.1,d+.25,'#53675e'));
 if(house){solid.push(box(x+.25,h+.22,z,w*.65,.22,d*.65,'#dfd9cb'));solid.push(box(x+.7,1.2,z+d/2+.3,1.1,.09,.6,'#c8b789'));for(const dx of [.2,1.2])solid.push(box(x+dx,1.29,z+d/2+.55,.025,.35,.025,palette.green));solid.push(box(x+.7,1.65,z+d/2+.55,1.05,.025,.025,palette.green));
 // A short garage drive meets the local street; the fourth home's drive meets the side street.
 if(b.id==='home-4')strip([p.x+x-w/2,p.z+z],[p.x+21,p.z+z],.65,.04,.025,'#888c83');else strip([p.x+x-.8,p.z+z+d/2],[p.x+x-.8,p.z+27],.65,.04,.025,'#888c83');
 solid.push(box(x-.7,.15,z+d/2+.025,.95,.8,.035,'#596965'));}
 else solid.push(box(x,.14,z+d/2+.35,w*.9,.05,.7,'#d2c4a0'));
 for(const side of [-1,1])for(let col=0;col<4;col++){if(house&&side===1&&col<3)continue;glass.push(box(x-w/2+.45+col*(w-.9)/3,.55,z+side*(d/2+.025),.45,house?.65:h*.62,.035,night?'#ffe9b9':'#8eb7c2'));keys.push(key);}
 if(house&&h>2)for(const side of [-1,1])for(const dx of [-.9,.9]){glass.push(box(x+dx,1.5,z+side*(d/2+.025),.5,.55,.035,night?'#ffe9b9':'#8eb7c2'));keys.push(key);}
 // Dedicated front door and path, kept free of canopy columns and vegetation.
 glass.push(box(x+.65,.15,z+d/2+.05,.38,.85,.045,night?'#ffe9b9':'#7caaa9'));keys.push(key);
 if(b.kind==='shop')for(const dx of [-1.15,0,1.15])solid.push(box(x+dx,1.25,z+d/2+.24,.95,.1,.55,palette.green));
 if(b.kind==='gym')solid.push(box(x,h+.22,z,w*.6,.35,d*.55,'#91b4b8'));
 if(b.id==='social'){solid.push(box(x,h+.23,z,w*.6,.35,d*.6,'#d8d0be'));for(const dx of [-w/2,w/2])solid.push(box(x+dx,h+.22,z,.025,.35,d,'#294237'));}
 if(b.kind==='spa')solid.push(box(x+2.6,.06,z,.45,.025,1.6,'#83b5b7'));
 if(b.kind==='cafe')for(const dx of [-1.4,1.4]){solid.push(box(x+dx,.04,z+2.2,.06,.45,.06,palette.green),box(x+dx,.49,z+2.2,.5,.04,.5,'#c2b28b'));}
 if(b.kind==='spa')for(const dz of [-1,0,1])plants.push(box(x+2.5,.05,z+dz,.35,.55,.35,'#64875d'));
 }
 // Compact three-hole short course: golf boundaries do not double as public paths.
 solid.push(box(28,.025,37.4,8,.025,13.1,'#729668'));
 for(const [i,z]of [33,37,41].entries()){solid.push(box(28,.06,z,5,.02,2.8,'#8cae70'),box(29,.083,z,.95,.015,1.2,'#a7be7b'),box(26.2,.084,z+.5,.65,.015,.65,'#d8ccab'),box(29,.1,z,.025,.5,.025,'#d6ddd4'),box(29.16,.48,z,.3,.18,.025,i===1?'#c8a35a':'#eee7d1'));}
 for(const x of [23.9,32.1])solid.push(box(x,.03,37.4,.06,.35,13.4,palette.green));
 // Static tree-lined paths with clear sightlines at corners, doors, and crossings.
 for(const [x,z]of [[23,3],[32,11],[24,14],[31.8,16],[2,29],[7,29],[13,29],[18.5,29],[2,37.7],[18,36.6],[32,44.8],[23,45],[1,45.4],[7,45.4],[13,45.4]]){solid.push(box(x,.03,z,.1,.7,.1,'#827a60'));plants.push(box(x,.63,z,.85,1.1,.85,'#64875d'));}
 for(const z of [6,13,30,36,44]){solid.push(box(19.55,.04,z,.045,.65,.045,palette.green));lights.push(box(19.55,.69,z,.12,.1,.12,night?'#ffe6af':'#d5cfb6'));}
 return {solid,glass,plants,lights,keys};},[p,night,palette]);
 return <><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.glass} geometry={g.box} material={night?m.lamp:m.plain} pick={pick.of(parts.keys)}/><Instanced items={parts.plants} geometry={g.ball} material={m.plain}/><Instanced items={parts.lights} geometry={g.ball} material={night?m.lamp:m.plain}/></>;
}
/** Bullet carriage shell: underframe, skirt, body below and above the window band, accent lines, gangway. */
const BULLET_BODY=(gold:string):Inst[]=>[{p:[0,-.07,0],s:[.42,.08,.8],c:'#33403f'},{p:[0,0,0],s:[.5,.2,1.02],c:'#f4f4ef'},{p:[0,.12,0],s:[.505,.03,1.02],c:gold},{p:[0,.05,0],s:[.505,.015,1.02],c:'#2d4f6a'},{p:[0,.44,0],s:[.5,.035,1.02],c:'#f4f4ef'},{p:[0,.02,.55],s:[.4,.4,.1],c:'#2f3a3c'}];
/** Elevated track, platforms and stair approaches share the same sampled route as the train. */
export function CommunityRail({plan:p,community,financial,roads,g,m,pick,moving,night}:{plan?:RailPlan;community?:CommunityPlan;financial?:FinancialPlan;roads:[number,number][][];pick:PickHandlerSet;moving:boolean;night:boolean}&Shared){
 const power=usePowerProfile(),focused=useWindowFocused(),carriages=useRef<(THREE.Group|null)[]>([]),doors=useRef<(THREE.Group|null)[]>([]),bodies=useRef<THREE.InstancedMesh>(null),heads=useRef<THREE.InstancedMesh>(null),riders=useRef<(THREE.Group|null)[]>([]),elapsed=useRef(0);
 const enabled=moving&&focused&&power.idleFps>15;
 const deck=useMemo(()=>p?railDeck(p):undefined,[p]);
 const trainGlass=useMemo(()=>new THREE.MeshStandardMaterial({color:night?'#f5dfb1':'#9ec6c8',transparent:true,opacity:.38,depthWrite:false,roughness:.35,emissive:night?'#ffe2a6':'#000000',emissiveIntensity:night?.2:0}),[night]);
 useEffect(()=>()=>trainGlass.dispose(),[trainGlass]);
 const stationGlass=useMemo(()=>new THREE.MeshStandardMaterial({color:'#ffffff',transparent:true,opacity:.42,depthWrite:false,roughness:.15,metalness:.3,emissive:night?'#ffe2a6':'#000000',emissiveIntensity:night?.25:0}),[night]);
 useEffect(()=>()=>stationGlass.dispose(),[stationGlass]);
 const station=useMemo(()=>p?parkStationParts(p.financial,TERRACE_H):undefined,[p]);
 const palette=useCommunityPalette();
 const parts=useMemo(()=>{const solid:Inst[]=[],lights:Inst[]=[],platforms:Inst[]=[],paths:Inst[]=[],stationKeys:string[]=[];if(!p)return {solid,lights,platforms,paths,stationKeys};
 const track=deck!;
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[x,TERRACE_H+y,z],s:[w,h,d],c});
 const strip=(a:[number,number],b:[number,number],w:number,y:number,h:number,c:string,target=solid)=>target.push({p:[(a[0]+b[0])/2,TERRACE_H+y,(a[1]+b[1])/2],s:[w,h,Math.hypot(b[0]-a[0],b[1]-a[1])+.015],r:Math.atan2(b[0]-a[0],b[1]-a[1]),c});
 for(let i=1;i<track.route.length;i++)strip(track.route[i-1],track.route[i],1.08,C.railRise-.2,.2,'#c5beaa');
 for(const offset of [-.18,.18]){const line=offsetRoad(track.route,offset);for(let i=1;i<line.length;i++)strip(line[i-1],line[i],.028,C.railRise+.045,.05,'#718785');}
 for(const offset of [-.51,.51]){const line=offsetRoad(track.route,offset);for(let i=1;i<line.length;i++){const at=track.lengths[i];if(at<5||at>track.length-5)continue;strip(line[i-1],line[i],.035,C.railRise+.45,.04,palette.green);}}
 for(let d=.3;d<track.length;d+=.48){const q=railPoint(track,d);solid.push({...box(q.x,C.railRise,q.z,.66,.035,.08,'#6d766e'),r:q.yaw});}
 for(let d=6;d<track.length-5;d+=6){const q=railPoint(track,d);if(roads.every(path=>distanceToRoad([q.x,q.z],path)>1.4))solid.push({p:[q.x,-1.2,q.z],s:[.25,TERRACE_H+C.railRise+1,.4],c:'#bdb59e'});for(const side of [-1,1])if(d>5&&d<track.length-5)solid.push(box(q.x+Math.cos(q.yaw)*side*.51,C.railRise,q.z-Math.sin(q.yaw)*side*.51,.035,.45,.035,palette.green));}
 for(const [index,s]of [p.hills,p.financial].entries()){
  const [x,z]=s,key=index===0?communityKey('station'):'service:financial-station';
  platforms.push(box(x,C.platformRise-.2,z+.85,C.platformLength,.2,C.platformWidth,'#ded8c7'));stationKeys.push(key);
  solid.push(box(x,C.platformRise+.005,z+.38,C.platformLength,.015,.07,'#d0ad69'));
  // The Hills keeps its flat canopy; Financial Park has the Dubai-style shell instead (parkStationPlan).
  if(index===0)solid.push(box(x,C.platformRise+1.15,z+.85,C.platformLength+.2,.08,.8,'#d9e3df'));
  for(const dx of [-3.5,3.5])solid.push(box(x+dx,C.platformRise,z+1.25,.07,1.15,.07,palette.green));
  solid.push(box(x+1,C.platformRise-.2,z+1.45,1,.2,.5,'#ded8c7'),box(x+1,.035,z+5.9,1,.07,.7,'#ded8c7'),box(x-3.4,C.platformRise-.2,z+1.5,.7,.2,.5,'#ded8c7'));
  strip([x+1,z+5.9],[x-3.4,z+5.9],.48,.075,.03,'#e3dfd2',paths);strip([x-3.4,z+5.9],[x-3.4,z+1.8],.48,.075,.03,'#e3dfd2',paths);
  for(let i=0;i<15;i++)solid.push(box(x+1,C.platformRise*(1-(i+1)/15),z+1.7+i*.28,1,C.platformRise/15,.29,'#d6d0bd'));
  // Separate protected lift and stairs make the raised platform reachable from ground paths.
  solid.push(box(x-3.4,.02,z+1.3,.65,C.platformRise+1,.7,index===0?'#819f9b':PARK_STATION.colors.lift),box(x-3.4,.05,z+1.67,.35,.8,.035,'#435e58'),box(x-3.4,C.platformRise+.05,z+1.67,.35,.8,.035,'#435e58'));
  for(const dx of [-.58,.58]){solid.push({...box(x+1+dx,C.platformRise/2+.6,z+3.8,.035,.035,Math.hypot(C.platformRise,4.2),palette.green),rx:Math.atan2(C.platformRise,4.2)});}
  for(const dx of [-.58,.58])for(let i=0;i<15;i++)solid.push(box(x+1+dx,C.platformRise*(1-i/15),z+1.7+i*.28,.035,.6,.035,palette.green));
  for(const [dx,w]of [[-1.75,4.3],[2.75,2.3]])solid.push(box(x+dx,C.platformRise+.55,z+1.38,w,.035,.035,palette.green));
  for(const dx of [-2,2])lights.push(box(x+dx,C.platformRise+1.08,z+.85,.8,.025,.12,night?'#ffe6b7':'#e4dfcf'));
 }
 for(const path of [p.financialWalk,p.hillsWalk])for(let i=1;i<path.length;i++)if(path[i][1]===0&&path[i-1][1]===0)strip([path[i-1][0],path[i-1][2]],[path[i][0],path[i][2]],TRANSPORT.walkWidth,.075,.03,'#e3dfd2',paths);
 for(const path of [p.financialWalk,p.hillsWalk]){const ground=path.filter(point=>point[1]===0).map(point=>[point[0],point[2]] as [number,number]);for(const road of roads)for(const crossing of roadIntersections(road,ground)){let nearest=1;for(let i=2;i<road.length;i++)if(distanceToRoad(crossing,[road[i-1],road[i]])<distanceToRoad(crossing,[road[nearest-1],road[nearest]]))nearest=i;const a=road[nearest-1],b=road[nearest],yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);for(let d=-.55;d<=.55;d+=.14)solid.push({...box(crossing[0]+Math.cos(yaw)*d,.109,crossing[1]-Math.sin(yaw)*d,.065,.005,.48,'#f7f7f0'),r:yaw});}}
 return {solid,lights,platforms,paths,stationKeys};},[p,roads,night,palette,deck]);
 // Simulated people, all drawn as two instanced meshes (bodies and heads): KC's twelve rail
 // commuters first, then Financial District people riding to Hills places and office workers
 // walking the sidewalk between towers, interleaved so a smaller crowd keeps both kinds.
 const commuters=useMemo(()=>planRailCommuters(community,financial,p),[community,financial,p]);
 const walkers=useMemo(()=>planDistrictWalkers(financial),[financial]);
 const people=useMemo(()=>{if(!commuters)return [];const riders=commuters.commuters,base=riders.slice(0,12),extra=riders.slice(12),out:{rider?:typeof riders[number];walker?:typeof walkers[number]}[]=base.map(rider=>({rider}));
  for(let i=0;i<Math.max(extra.length,walkers.length);i++){if(extra[i])out.push({rider:extra[i]});if(walkers[i])out.push({walker:walkers[i]});}return out;},[commuters,walkers]);
 const count=people.length,qualityLevel=useQualityLevel(),limit=crowdLimit(count,{qualityLevel,saver:power.pauseInBackground});
 useEffect(()=>{const colors=['#304d67','#8c7760','#64856c','#7a4f5a','#4f6f7a','#a08a5c'],c=new THREE.Color();for(let i=0;i<count;i++){bodies.current?.setColorAt(i,c.set(colors[i%colors.length]));heads.current?.setColorAt(i,c.set('#c6ad8f'));}for(const mesh of [bodies.current,heads.current])if(mesh?.instanceColor)mesh.instanceColor.needsUpdate=true;},[count]);
 const pose=useMemo(()=>new THREE.Object3D(),[]);
 const placePeople=(seconds:number)=>{
  const body=bodies.current,head=heads.current;if(!commuters||!body||!head)return {outbound:false,back:false};
  let outbound=false,back=false;body.count=head.count=limit;
  for(let i=0;i<limit;i++){const {rider,walker}=people[i],at=rider?commuterAt(commuters,rider,seconds):walkerAt(walker!,seconds);
   if(!at.visible){if('where' in at&&at.where==='aboard'){if(at.direction==='outbound')outbound=true;else back=true;}pose.scale.setScalar(0);pose.position.set(0,-10,0);pose.updateMatrix();body.setMatrixAt(i,pose.matrix);head.setMatrixAt(i,pose.matrix);continue;}
   const y=TERRACE_H+(at.y>0?Math.ceil(at.y/(C.platformRise/15))*(C.platformRise/15)+.02:.105);
   pose.rotation.set(0,at.yaw,0);pose.position.set(at.x,y,at.z);pose.scale.set(.07,.16,.06);pose.updateMatrix();body.setMatrixAt(i,pose.matrix);
   pose.position.set(at.x,y+.21,at.z);pose.scale.setScalar(.035);pose.updateMatrix();head.setMatrixAt(i,pose.matrix);
  }
  body.instanceMatrix.needsUpdate=true;head.instanceMatrix.needsUpdate=true;return {outbound,back};
 };
 useEffect(()=>{placePeople(elapsed.current);});
 useFrame((_,delta)=>{if(!p||!deck||!enabled)return;elapsed.current+=Math.min(delta,.15);const state=railState(elapsed.current,p.length),aboard=placePeople(elapsed.current);riders.current.forEach(r=>{if(r)r.visible=(state.phase==='outbound'&&aboard.outbound)||(state.phase==='return'&&aboard.back);});carriages.current.forEach((car,i)=>{if(!car)return;const q=railPoint(deck,(deck.length-p.length)/2+state.distance+(i-1)*C.carriageSpacing);car.position.set(q.x,TERRACE_H+C.railRise+.1,q.z);car.rotation.y=q.yaw;});doors.current.forEach((door,i)=>{if(door)door.rotation.y=state.doors*Math.PI/2*(i%2?1:-1);});});
 if(!p||!deck)return null;
 return <><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.paths} geometry={g.box} material={m.plain}/><Instanced items={parts.platforms} geometry={g.box} material={m.plain} pick={pick.of(parts.stationKeys)}/><Instanced items={parts.lights} geometry={g.box} material={night?m.lamp:m.plain}/>
 {station&&<><Instanced items={station.metal} geometry={g.box} material={m.metal}/><Instanced items={station.accents} geometry={g.box} material={m.plain}/><Instanced items={station.glass} geometry={g.box} material={stationGlass} shadow={false}/></>}
 {[0,1,2].map(i=>{const start=railPoint(deck,(deck.length-p.length)/2+(i-1)*C.carriageSpacing);return <group key={i} ref={node=>{carriages.current[i]=node;}} position={[start.x,TERRACE_H+C.railRise+.1,start.z]} rotation={[0,start.yaw,0]}>
  {/* Bullet train: low white body, a continuous window band, gold line, and gangways between cars. */}
  <Instanced geometry={g.box} material={m.plain} items={BULLET_BODY(palette.gold)}/>
  <Instanced geometry={g.ball} material={m.plain} items={[{p:[0,.47,0],s:[.25,.08,.5],c:'#f4f4ef'}]}/>
  <Instanced geometry={g.box} material={trainGlass} items={[-1,1].map(side=>({p:[side*.256,.2,0],s:[.015,.24,.9],c:night?'#f4dfb1':'#86b0b8'} as Inst))}/>
  {[-1,1].map((side,k)=><group key={side} ref={node=>{doors.current[i*2+k]=node;}} position={[side*.26,.16,.24]} rotation={[0,side*Math.PI/2,0]}><Instanced geometry={g.box} material={m.plain} items={[{p:[0,0,.09],s:[.014,.4,.18],c:'#779b9f'}]}/></group>)}
  <group ref={node=>{riders.current[i]=node;}} visible={false}><Instanced geometry={g.box} material={m.plain} items={[-.2,.2].map(z=>({p:[0,.16,z],s:[.06,.09,.06],c:palette.green}))}/><Instanced geometry={g.ball} material={m.plain} items={[-.2,.2].map(z=>({p:[0,.25,z],s:[.035,.035,.035],c:'#c6ad8f'}))}/></group>
  {i!==1&&<><Instanced geometry={g.ball} material={m.plain} items={[{p:[0,.2,i===0?-.5:.5],s:[.25,.27,.8],c:'#f4f4ef'}]}/><Instanced geometry={g.ball} material={m.darkGlass} items={[{p:[0,.4,i===0?-.7:.7],s:[.18,.09,.34]}]}/></>}
 </group>;})}
 {count>0&&<><instancedMesh name="rail-commuters" ref={bodies} args={[g.box,m.plain,count]} castShadow frustumCulled={false}/><instancedMesh ref={heads} args={[g.ball,m.plain,count]} frustumCulled={false}/></>}
 </>;
}
