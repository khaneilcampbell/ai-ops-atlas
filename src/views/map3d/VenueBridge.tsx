import {connectionSpans,clipConnectionRails,splitAtLand} from "./connectionGeometry";
import {TRANSPORT} from "./transportScale";
import {useMemo} from 'react';
import type {Scene3D} from './scene';
import {TERRACE_H} from './scene';
import {bridgeParts,Instanced,type Inst,type useGeometries,type useMaterials} from './models';
import {distanceToRoad,roadIntersections} from './highway';
import {ROAD_W,type Pt,type CarBridge} from './roads';
/** Original stone bridge parts and green railings, driven by the same paths as pedestrians. */
export function VenueBridge({scene,g,m}:{scene:Scene3D;g:ReturnType<typeof useGeometries>;m:ReturnType<typeof useMaterials>}){
 const parts=useMemo(()=>{
  const solid:Inst[]=[],lamps:Inst[]=[];

  const paths=scene.transportConnections??[];
  const segments=connectionSpans(paths.map(l=>l.road));
  const junctions:Pt[]=[...(scene.freight?.access??[]).map(a=>a.junction),...(scene.freight?paths.flatMap(l=>roadIntersections(l.road,scene.freight!.highway)):[]),...segments.flatMap((u,i)=>segments.slice(i+1).flatMap(v=>{
   const h=u.a[1]===u.b[1]?u:v,k=h===u?v:u;
   if(h.a[1]!==h.b[1]||k.a[0]!==k.b[0])return [];
   const x=k.a[0],z=h.a[1];return x>=Math.min(h.a[0],h.b[0])-.01&&x<=Math.max(h.a[0],h.b[0])+.01&&z>=Math.min(k.a[1],k.b[1])-.01&&z<=Math.max(k.a[1],k.b[1])+.01?[[x,z] as Pt]:[];
  }))];
  for(const {a,b,onLand} of splitAtLand(segments,scene.land)){
   const axis=a[0]===b[0]?'z':'x',key=JSON.stringify([a,b]);
   const br={key,ends:['',''],axis,a,b,roads:[[],[]]} as CarBridge;
   const p=bridgeParts(br,[],TRANSPORT.bridgeWidth,-1.2,false);
   const exposedRails=p.rails.filter(v=>!onLand||!scene.land.some(l=>v.p[0]>l.x+.04&&v.p[0]<l.x+l.w-.04&&v.p[2]>l.z+.04&&v.p[2]<l.z+l.d-.04));
   solid.push(...p.deck,...clipConnectionRails(exposedRails,junctions,TRANSPORT.junctionOpening),...p.piers.filter(v=>!scene.land.some(l=>v.p[0]>=l.x&&v.p[0]<=l.x+l.w&&v.p[2]>=l.z&&v.p[2]<=l.z+l.d)).map(v=>({...v,c:'#bdb59e'})));
   if(!onLand)lamps.push(...p.lamps.filter(v=>!junctions.some(j=>Math.hypot(v.p[0]-j[0],v.p[2]-j[1])<TRANSPORT.junctionOpening)));
  }
  const walkPaths=connectionSpans(paths.map(l=>l.walk));
  for(const span of walkPaths){const link={walk:[span.a,span.b]};
   for(let i=1;i<link.walk.length;i++){
    const a=link.walk[i-1],b=link.walk[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.02)continue;
    const r=Math.atan2(b[0]-a[0],b[1]-a[1]),x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    const crossings=paths.flatMap(l=>roadIntersections([a,b],l.road));
    solid.push(...clipConnectionRails([{p:[x,TERRACE_H+.035,z],s:[TRANSPORT.walkWidth,.045,len+TRANSPORT.landingOverlap],r,c:'#e6d6b4'}],crossings,TRANSPORT.cityWidth/2+.04));
    for(const crossing of crossings){const road=segments.find(s=>distanceToRoad(crossing,[s.a,s.b])<.01);if(!road)continue;
     const rotation=road.a[0]===road.b[0]?0:Math.PI/2;
     for(let band=-2;band<=2;band++)solid.push({p:[crossing[0]+Math.sin(rotation)*band*.09,TERRACE_H+.061,crossing[1]+Math.cos(rotation)*band*.09],s:[TRANSPORT.bridgeWidth,.006,.045],r:rotation,c:'#f7f2df'});
    }
    // Rails protect waterfront spans, leaving the ends open for circulation.
    for(const side of [-1,1]){
     for(let t=.2;t<len-.15;t+=.4){
      const px=a[0]+(b[0]-a[0])*t/len,pz=a[1]+(b[1]-a[1])*t/len;
      if(scene.land.some(l=>px>l.x+.08&&px<l.x+l.w-.08&&pz>l.z+.08&&pz<l.z+l.d-.08))continue;
      if(paths.some(l=>distanceToRoad([px,pz],l.road)<ROAD_W/2+.12)||walkPaths.some(other=>other!==span&&distanceToRoad([px,pz],[other.a,other.b])<TRANSPORT.walkWidth/2+.08))continue;
      solid.push({p:[px+Math.cos(r)*side*(TRANSPORT.walkWidth/2-.015),TERRACE_H+.23,pz-Math.sin(r)*side*(TRANSPORT.walkWidth/2-.015)],s:[.025,.025,Math.min(.42,len-t-.1)],r,c:'#294237'}, {p:[px+Math.cos(r)*side*(TRANSPORT.walkWidth/2-.015),TERRACE_H+.08,pz-Math.sin(r)*side*(TRANSPORT.walkWidth/2-.015)],s:[.025,.16,.025],c:'#294237'});
     }
    }
    for(let t=.5;t<len;t+=1.5){const px=a[0]+(b[0]-a[0])*t/len,pz=a[1]+(b[1]-a[1])*t/len;if(scene.land.some(l=>px>=l.x&&px<=l.x+l.w&&pz>=l.z&&pz<=l.z+l.d))continue;solid.push({p:[a[0]+(b[0]-a[0])*t/len,-1.2,a[1]+(b[1]-a[1])*t/len],s:[.16,TERRACE_H+1.23,.22],c:'#bdb59e'});}
   }
  }
  return {solid,lamps};
 },[scene.transportConnections,scene.freight,scene.land]);
 return <><Instanced items={parts.solid} geometry={g.box} material={m.plain}/><Instanced items={parts.lamps} geometry={g.ball} material={m.lamp}/></>;
}
