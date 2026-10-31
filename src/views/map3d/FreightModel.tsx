import {highwayLightPositions,profileWidthAt,interchangeArrows} from "./highwayDetails";
import {collectorProfile} from "./highwayAccess";
import {MODELS,SCALE} from "./vehicleModels";
import {ROAD_W} from "./roads";
import {HIGHWAY,offsetRoad,distanceToRoad,roadStrips,roadProfile} from "./highway";
import {useMemo,useRef} from "react";
import {useFrame} from "@react-three/fiber";
import type {Group} from "three";
import {Instanced,type Inst,type useGeometries,type useMaterials} from "./models";
import {TERRACE_H} from "./scene";
import {vehicleAt} from "./vehicles";
import type {FreightPlan} from "./freight";
export function Freight({plan,g,m,moving,visible=true}:{plan?:FreightPlan;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>;moving:boolean;visible?:boolean}){
 const ref=useRef<Group>(null),clock=useRef(0);
 const lightPositions=useMemo(()=>plan?highwayLightPositions(plan.highway,[...plan.exits,...plan.localJunctions]):[],[plan]);
 const parts=useMemo(()=>{
 if(!plan)return [];
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string):Inst=>({p:[x,y,z],s:[w,h,d],c});
 const out=[box(plan.lot.x,TERRACE_H+.025,plan.lot.z,2.2,.06,2,"#414a49")];
 for(let i=0;i<4;i++)out.push(box(plan.lot.x-.8+i*.5,TERRACE_H+.09,plan.lot.z-.5,.025,.015,.8,"#eee4c9"));
 const cityAccess=plan.cityAccess??[];
 for(let i=1;i<cityAccess.length;i++){
  const a=cityAccess[i-1],b=cityAccess[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;
  out.push({p:[(a[0]+b[0])/2,TERRACE_H+.034,(a[1]+b[1])/2],s:[ROAD_W,.008,len+.04],r:Math.atan2(b[0]-a[0],b[1]-a[1]),c:"#424b50"});
 }
 const access=plan.access??[];
 const ramps=new Set(access.flatMap(a=>a.ramps));
 const paths=[plan.highway,plan.route,...access.flatMap(a=>[a.collector,...a.ramps])];
 const collectors=new Set(access.map(a=>a.collector));
 const profiles=new Map(paths.map(p=>[p,collectors.has(p)?collectorProfile(p):roadProfile(p)]));
 const roadLines=(path:[number,number][],offset:number,junctions:[number,number][]=[] )=>{
  if(!collectors.has(path))return roadStrips(path,offset,junctions);
  const p=profiles.get(path)!,line=offsetRoad(p.points,p.widths.map(w=>Math.abs(offset)<.1?offset:Math.sign(offset)*(Math.abs(offset)+(w-HIGHWAY.width)/2)));
  return line.slice(1).map((b,i)=>({a:line[i],b})).filter(q=>!junctions.some(j=>distanceToRoad(j,[q.a,q.b])<HIGHWAY.junctionRadius));
 };
 const openings=[...plan.exits,...plan.localJunctions,...access.flatMap(a=>[a.collector[a.collector.length-1]])];
 const onLand=(x:number,z:number)=>plan.land.some(r=>x>r.x&&x<r.x+r.w&&z>r.z&&z<r.z+r.d);
 for(const path of paths)for(let i=1;i<path.length;i++){
 const a=path[i-1],b=path[i];
 if(path===plan.route&&distanceToRoad([(a[0]+b[0])/2,(a[1]+b[1])/2],plan.highway)<.1)continue;
 const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.01)continue;
 const r=Math.atan2(b[0]-a[0],b[1]-a[1]);

 // Every segment, including bends, rests on a continuous structural edge beam.

 const prior=path.slice(1,i).reduce((sum,p,j)=>sum+Math.hypot(p[0]-path[j][0],p[1]-path[j][1]),0);
 for(let t=(4-prior%HIGHWAY.supportSpacing+HIGHWAY.supportSpacing)%HIGHWAY.supportSpacing;t<length;t+=HIGHWAY.supportSpacing){const px=a[0]+(b[0]-a[0])*t/length,pz=a[1]+(b[1]-a[1])*t/length;if(onLand(px,pz))continue;const width=profileWidthAt(profiles.get(path)!,[px,pz]),pierOffset=Math.max(.08,width/2-.13);for(const side of [-1,1])out.push(box(px+Math.cos(r)*side*pierOffset,-1.2,pz-Math.sin(r)*side*pierOffset,.15,TERRACE_H+1.16,.18,"#aaa99d"));out.push({p:[px,TERRACE_H-.12,pz],s:[width+.1,.12,.2],r,c:"#bcb9aa"});}

 }
 // Short shared cross-sections taper the deck and edge beams continuously into bends.
 for(const path of paths){
  const profile=profiles.get(path)!;
  for(let i=1;i<profile.points.length;i++){
   const a=profile.points[i-1],b=profile.points[i],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
   if(path===plan.route&&distanceToRoad([x,z],plan.highway)<.1)continue;
   const length=Math.hypot(b[0]-a[0],b[1]-a[1]),width=(profile.widths[i-1]+profile.widths[i])/2,r=Math.atan2(b[0]-a[0],b[1]-a[1]);
   out.push({p:[x,TERRACE_H+.025,z],s:[width,.06,length+.035],r,c:path===plan.highway?"#343d3e":"#424b50"});
   if(path===plan.highway||!onLand(x,z))out.push({p:[x,TERRACE_H-.09,z],s:[width+.08,.12,length+.035],r,c:"#bcb9aa"});
  }
 }
 // Every rail and marking uses the same mitered curve offsets as opposing lanes.
 const strip=(a:[number,number],b:[number,number],width:number,height:number,y:number,color:string)=>{
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]);out.push({p:[(a[0]+b[0])/2,y,(a[1]+b[1])/2],s:[width,height,length+.012],r:Math.atan2(b[0]-a[0],b[1]-a[1]),c:color});
 };
 for(const path of paths){
  for(const side of [-1,1]){
   for(const q of roadLines(path,side*HIGHWAY.shoulder,path===plan.highway?plan.exits:openings))if(path!==plan.route||distanceToRoad(q.a,plan.highway)>.2)strip(q.a,q.b,.025,.01,TERRACE_H+.09,"#ede8d6");
   if(path===plan.highway)for(const q of roadLines(path,side*.045,plan.exits))strip(q.a,q.b,.022,.01,TERRACE_H+.09,"#d5b76b");
   else if(side===1&&!ramps.has(path)){
    const center=roadLines(path,0,openings);
    for(const [i,q] of center.entries())if(i%4<2&&distanceToRoad(q.a,plan.highway)>.2)strip(q.a,q.b,.025,.01,TERRACE_H+.09,"#e5dfc9");
   }
   if(path===plan.route)for(const q of roadLines(path,side*HIGHWAY.barrier,[...plan.exits,...plan.localJunctions]))if(onLand(q.a[0],q.a[1])&&distanceToRoad(q.a,plan.highway)>1.1)strip(q.a,q.b,.1,.035,TERRACE_H+.08,"#cfcbbd");
   if(path===plan.highway||path!==plan.route){
    const rails=roadLines(path,side*HIGHWAY.barrier,openings);
    for(const [i,q] of rails.entries()){
     if(path!==plan.highway&&onLand(q.a[0],q.a[1]))continue;
     strip(q.a,q.b,.045,.075,TERRACE_H+HIGHWAY.railHeight,"#2f4a3a");
     if(i%3===0)out.push(box(q.a[0],TERRACE_H+.08,q.a[1],.04,HIGHWAY.railHeight-.08,.04,"#2f4a3a"));
    }
   }
  }

 }
 // Direction arrows identify separate entrance and exit ramps without adding labels.
 for(const p of lightPositions)out.push(box(p[0],TERRACE_H+.08,p[1],.045,.85,.045,"#68776e"));
 for(const {a,b} of interchangeArrows(access)){const r=Math.atan2(b[0]-a[0],b[1]-a[1]);
  for(const side of [-1,1])out.push({p:[b[0]+Math.cos(r)*side*.065,TERRACE_H+.1,b[1]-Math.sin(r)*side*.065],s:[.025,.012,.19],r:r+side*.55,c:'#eee6d2'});
 }
 return out;
 },[plan,lightPositions]);
 const lights=useMemo<Inst[]>(()=>lightPositions.map(p=>({p:[p[0],TERRACE_H+.96,p[1]],s:[.07,.045,.07]})),[lightPositions]);
 const truck=useMemo<Inst[]>(()=>MODELS.semi.parts.map(p=>({p:p.at.map(v=>v*SCALE) as [number,number,number],s:p.size.map(v=>v*SCALE) as [number,number,number],c:p.color??'#294237'})),[]);
 useFrame((_,dt)=>{if(!plan||!ref.current)return;if(moving)clock.current+=Math.min(dt,.1);const p=vehicleAt(plan.truck,clock.current);ref.current.position.set(p.x,TERRACE_H+.03+p.y,p.z);ref.current.rotation.y=Math.atan2(-p.dz,p.dx);});
 if(!plan)return null;
 return <><group name="atlas-road-infrastructure"><Instanced items={parts} geometry={g.box} material={m.plain}/><Instanced items={lights} geometry={g.ball} material={m.lamp}/></group><group name="atlas-freight-truck" ref={ref} visible={visible} position={[plan.lot.x,TERRACE_H+.11,plan.lot.z]}><Instanced items={truck} geometry={g.box} material={m.plain}/></group></>;
}
