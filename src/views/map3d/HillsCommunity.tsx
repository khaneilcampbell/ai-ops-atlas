import {SIMULATED_COMMUTERS,commuterLane} from './districtLifePlan';
import {useMemo,useRef,useEffect} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {Instanced,type Inst,type PickHandlerSet,type useGeometries,type useMaterials} from './models';
import {TERRACE_H} from './scene';
import {COMMUNITY as C,communityKey,commuterStage,railDeck,railPoint,railState,walkPoint,type CommunityPlan,type RailPlan,type Point3} from './hillsCommunityPlan';
import {TRANSPORT} from './transportScale';
import {MANSION_COLORS} from './hillsMansion';
import {distanceToRoad,offsetRoad,roadIntersections} from './highway';
import {usePowerProfile,useWindowFocused} from '../../lib/power';
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
 // Mansion theme (hillsMansion.ts): stone plinth, white stacked volumes, a cantilevered slab, timber fin, glass bands.
 const M=MANSION_COLORS,low=h*.55,glassTint=night?'#ffe9b9':'#5f7f88';
 solid.push(box(x,0,z,w+.25,.12,d+.25,M.stone),box(x,.12,z,w,low,d,M.concrete),box(x,.12+low,z+.12,w+.3,.08,d+.35,M.concrete));
 solid.push(box(x+w*.12,.2+low,z-.1,w*.7,h-low-.08,d*.8,M.concrete),box(x+w*.12,.12+h,z-.05,w*.82,.08,d*.92,M.concrete),box(x-w/2-.03,.12,z,.06,h,d*.6,M.timber));
 for(const side of [-1,1]){glass.push(box(x,.25,z+side*(d/2+.02),w*.86,low-.22,.03,glassTint));keys.push(key);for(let k=1;k<4;k++)solid.push(box(x-w*.43+k*w*.86/4,.25,z+side*(d/2+.04),.035,low-.22,.035,M.frame));}
 glass.push(box(x+w*.12,.3+low,z-.1+d*.4+.02,w*.6,h-low-.3,.03,glassTint));keys.push(key);
 for(const [k,c]of [M.green,M.pink,M.green].entries())plants.push(box(x+w*.3+k*.35,.26+low,z+d/2+.12,.18,.12,.16,c));
 if(house){
 // A short garage drive meets the local street; the fourth home's drive meets the side street.
 if(b.id==='home-4')strip([p.x+x-w/2,p.z+z],[p.x+21,p.z+z],.65,.04,.025,'#888c83');else strip([p.x+x-.8,p.z+z+d/2],[p.x+x-.8,p.z+27],.65,.04,.025,'#888c83');
 solid.push(box(x-.7,.15,z+d/2+.05,.95,.8,.035,M.timber));}
 else solid.push(box(x,.14,z+d/2+.35,w*.9,.05,.7,'#d2c4a0'));
 // Dedicated front door and path, kept free of canopy columns and vegetation.
 glass.push(box(x+.65,.15,z+d/2+.05,.38,Math.min(.85,low-.1),.045,night?'#ffe9b9':'#3e3f3d'));keys.push(key);
 if(b.kind==='gym')solid.push(box(x+w*.12,h+.2,z-.05,w*.5,.35,d*.5,'#91b4b8'));
 if(b.id==='social')solid.push(box(x+w*.12,h+.2,z-.05,w*.5,.3,d*.5,MANSION_COLORS.timber));
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
/** Elevated track, platforms and stair approaches share the same sampled route as the train. */
export function CommunityRail({plan:p,roads,g,m,pick,moving,night}:{plan?:RailPlan;roads:[number,number][][];pick:PickHandlerSet;moving:boolean;night:boolean}&Shared){
 const power=usePowerProfile(),focused=useWindowFocused(),carriages=useRef<(THREE.Group|null)[]>([]),doors=useRef<(THREE.Group|null)[]>([]),people=useRef<(THREE.Group|null)[]>([]),riders=useRef<(THREE.Group|null)[]>([]),elapsed=useRef(0);
 const enabled=moving&&focused&&power.idleFps>15;
 const deck=useMemo(()=>p?railDeck(p):undefined,[p]);
 const trainGlass=useMemo(()=>new THREE.MeshStandardMaterial({color:night?'#f5dfb1':'#9ec6c8',transparent:true,opacity:.38,depthWrite:false,roughness:.35,emissive:night?'#ffe2a6':'#000000',emissiveIntensity:night?.2:0}),[night]);
 useEffect(()=>()=>trainGlass.dispose(),[trainGlass]);
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
  solid.push(box(x,C.platformRise+.005,z+.38,C.platformLength,.015,.07,'#d0ad69'),box(x,C.platformRise+1.15,z+.85,C.platformLength+.2,.08,.8,'#d9e3df'));
  for(const dx of [-3.5,3.5])solid.push(box(x+dx,C.platformRise,z+1.25,.07,1.15,.07,palette.green));
  solid.push(box(x+1,C.platformRise-.2,z+1.45,1,.2,.5,'#ded8c7'),box(x+1,.035,z+5.9,1,.07,.7,'#ded8c7'),box(x-3.4,C.platformRise-.2,z+1.5,.7,.2,.5,'#ded8c7'));
  strip([x+1,z+5.9],[x-3.4,z+5.9],.48,.075,.03,'#e3dfd2',paths);strip([x-3.4,z+5.9],[x-3.4,z+1.8],.48,.075,.03,'#e3dfd2',paths);
  for(let i=0;i<15;i++)solid.push(box(x+1,C.platformRise*(1-(i+1)/15),z+1.7+i*.28,1,C.platformRise/15,.29,'#d6d0bd'));
  // Separate protected lift and stairs make the raised platform reachable from ground paths.
  solid.push(box(x-3.4,.02,z+1.3,.65,C.platformRise+1,.7,'#819f9b'),box(x-3.4,.05,z+1.67,.35,.8,.035,'#435e58'),box(x-3.4,C.platformRise+.05,z+1.67,.35,.8,.035,'#435e58'));
  for(const dx of [-.58,.58]){solid.push({...box(x+1+dx,C.platformRise/2+.6,z+3.8,.035,.035,Math.hypot(C.platformRise,4.2),palette.green),rx:Math.atan2(C.platformRise,4.2)});}
  for(const dx of [-.58,.58])for(let i=0;i<15;i++)solid.push(box(x+1+dx,C.platformRise*(1-i/15),z+1.7+i*.28,.035,.6,.035,palette.green));
  for(const [dx,w]of [[-1.75,4.3],[2.75,2.3]])solid.push(box(x+dx,C.platformRise+.55,z+1.38,w,.035,.035,palette.green));
  for(const dx of [-2,2])lights.push(box(x+dx,C.platformRise+1.08,z+.85,.8,.025,.12,night?'#ffe6b7':'#e4dfcf'));
 }
 const bridgeX=p.financialLand.x-C.financialShoreGap/2,bridgeZ=p.financial[1]+5.9;
 solid.push(box(bridgeX,0,bridgeZ,C.financialShoreGap+.2,.105,.6,'#d6d0bd'));
 for(const side of [-1,1]){solid.push(box(bridgeX,.45,bridgeZ+side*.28,C.financialShoreGap+.2,.035,.035,palette.green));for(const dx of [-1,0,1])solid.push(box(bridgeX+dx,.105,bridgeZ+side*.28,.035,.35,.035,palette.green));}
 solid.push({p:[bridgeX,-1.2,bridgeZ],s:[.18,TERRACE_H+1.2,.35],c:'#bdb59e'});
 for(const path of [p.financialWalk,p.hillsWalk])for(let i=1;i<path.length;i++)if(path[i][1]===0&&path[i-1][1]===0)strip([path[i-1][0],path[i-1][2]],[path[i][0],path[i][2]],TRANSPORT.walkWidth,.075,.03,'#e3dfd2',paths);
 for(const path of [p.financialWalk,p.hillsWalk]){const ground=path.filter(point=>point[1]===0).map(point=>[point[0],point[2]] as [number,number]);for(const road of roads)for(const crossing of roadIntersections(road,ground)){let nearest=1;for(let i=2;i<road.length;i++)if(distanceToRoad(crossing,[road[i-1],road[i]])<distanceToRoad(crossing,[road[nearest-1],road[nearest]]))nearest=i;const a=road[nearest-1],b=road[nearest],yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);for(let d=-.55;d<=.55;d+=.14)solid.push({...box(crossing[0]+Math.cos(yaw)*d,.109,crossing[1]-Math.sin(yaw)*d,.065,.005,.48,'#f7f7f0'),r:yaw});}}
 return {solid,lights,platforms,paths,stationKeys};},[p,roads,night,palette,deck]);
 const commutes=useMemo(()=>p?Array.from({length:SIMULATED_COMMUTERS},(_,i)=>p.hillsWalk.map((point,j)=>j<2?[point[0]-12+(i%3)*6,point[1],point[2]] as Point3:point)):[],[p]);
 useFrame((_,delta)=>{if(!p||!deck||!enabled)return;elapsed.current+=Math.min(delta,.15);const state=railState(elapsed.current,p.length),commuter=commuterStage(state);riders.current.forEach(r=>{if(r)r.visible=commuter.aboard;});carriages.current.forEach((car,i)=>{if(!car)return;const q=railPoint(deck,(deck.length-p.length)/2+state.distance+(i-1)*C.carriageSpacing);car.position.set(q.x,TERRACE_H+C.railRise+.1,q.z);car.rotation.y=q.yaw;});doors.current.forEach((door,i)=>{if(door)door.rotation.y=state.doors*Math.PI/2*(i%2?1:-1);});
  people.current.forEach((person,i)=>{if(!person)return;person.visible=!commuter.aboard;if(!person.visible)return;const path=commuter.hills?commutes[i]:p.financialWalk,point=walkPoint(path,commuter.progress);person.position.set(point[0]+commuterLane(i),TERRACE_H+(point[1]>0?Math.ceil(point[1]/(C.platformRise/15))*(C.platformRise/15)+.02:.105),point[2]);});
 });
 if(!p||!deck)return null;
 return <><Instanced items={[{p:[p.financialLand.x+p.financialLand.w/2,0,p.financialLand.z+p.financialLand.d/2],s:[p.financialLand.w,TERRACE_H,p.financialLand.d]}]} geometry={g.box} material={m.terrace}/><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.paths} geometry={g.box} material={m.plain}/><Instanced items={parts.platforms} geometry={g.box} material={m.plain} pick={pick.of(parts.stationKeys)}/><Instanced items={parts.lights} geometry={g.box} material={night?m.lamp:m.plain}/>
 {[0,1,2].map(i=>{const start=railPoint(deck,(deck.length-p.length)/2+(i-1)*C.carriageSpacing);return <group key={i} ref={node=>{carriages.current[i]=node;}} position={[start.x,TERRACE_H+C.railRise+.1,start.z]} rotation={[0,start.yaw,0]}>
  <Instanced geometry={g.box} material={m.plain} items={[{p:[0,0,0],s:[.52,.16,1.02],c:'#f0f0e5'},{p:[0,.65,0],s:[.48,.07,.96],c:palette.green},{p:[0,.04,0],s:[.55,.06,1],c:palette.gold},{p:[0,-.055,0],s:[.42,.06,.65],c:'#394b49'}]}/>
  <Instanced geometry={g.box} material={trainGlass} items={[-1,1].map(side=>({p:[side*.266,.22,0],s:[.015,.33,.85],c:night?'#f4dfb1':'#86b0b8'} as Inst))}/>
  {[-1,1].map((side,k)=><group key={side} ref={node=>{doors.current[i*2+k]=node;}} position={[side*.275,.16,.24]} rotation={[0,side*Math.PI/2,0]}><Instanced geometry={g.box} material={m.plain} items={[{p:[0,0,.09],s:[.014,.4,.18],c:'#779b9f'}]}/></group>)}
  <group ref={node=>{riders.current[i]=node;}} visible={false}><Instanced geometry={g.box} material={m.plain} items={[-.2,.2].map(z=>({p:[0,.16,z],s:[.06,.09,.06],c:palette.green}))}/><Instanced geometry={g.ball} material={m.plain} items={[-.2,.2].map(z=>({p:[0,.25,z],s:[.035,.035,.035],c:'#c6ad8f'}))}/></group>
  {i!==1&&<Instanced geometry={g.ball} material={m.plain} items={[{p:[0,0,i===0?-.49:.49],s:[.5,.6,.25],c:'#f0f0e5'}]}/>}
 </group>;})}
 {Array.from({length:SIMULATED_COMMUTERS},(_,i)=><group name="rail-commuter" key={i} ref={node=>{people.current[i]=node;}} position={[p.hillsWalk[p.hillsWalk.length-1][0]+commuterLane(i),TERRACE_H+C.platformRise+.02,p.hillsWalk[p.hillsWalk.length-1][2]]}><mesh geometry={g.box} material={m.plain} scale={[.07,.16,.06]}><meshStandardMaterial color={['#304d67','#8c7760','#64856c'][i%3]}/></mesh><mesh geometry={g.ball} position={[0,.21,0]} scale={[.035,.035,.035]} material={m.plain}/></group>)}
 </>;
}
