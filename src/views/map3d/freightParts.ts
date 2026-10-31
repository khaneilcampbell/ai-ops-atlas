import {profileWidthAt,interchangeArrows} from "./highwayDetails";
import {collectorProfile} from "./highwayAccess";
import {ROAD_W} from "./roads";
import {HIGHWAY,offsetRoad,distanceToRoad,roadStrips,roadProfile} from "./highway";
import type {Inst} from "./models";
import {TERRACE_H} from "./scene";
import {FREIGHT_STREET_TURN,type FreightPlan} from "./freight";
import {TRANSPORT} from "./transportScale";
import {mergeSegments} from "./mergeSegments";

/**
 * Every static box of the highway, ramps and freight lot: decks, beams, piers, markings, rails
 * and lamp posts. Pure, so tests can hold it to a size budget (see freightParts.test.ts).
 */
export function freightParts(plan:FreightPlan,lightPositions:[number,number][]):Inst[]{
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
 // Where the truck route turns onto or off a shared district street, its deck narrows to the
 // street's own width, so the turn reads as a street corner instead of a fan of wide highway boxes.
 const streetJoins=plan.localJunctions.filter(j=>(plan.streets??[]).some(st=>distanceToRoad(j,st)<1e-6));
 const nearJoin=(p:[number,number],reach:number)=>streetJoins.some(j=>Math.hypot(j[0]-p[0],j[1]-p[1])<reach);
 if(streetJoins.length){const r=profiles.get(plan.route)!;profiles.set(plan.route,{...r,widths:r.widths.map((w,i)=>{
  const d=Math.min(...streetJoins.map(j=>Math.hypot(j[0]-r.points[i][0],j[1]-r.points[i][1]))),k=Math.max(0,Math.min(1,(d-FREIGHT_STREET_TURN*1.6)/1.5));
  return TRANSPORT.cityWidth+(w-TRANSPORT.cityWidth)*k;})});}
 const roadLines=(path:[number,number][],offset:number,junctions:[number,number][]=[] )=>{
  if(!collectors.has(path))return roadStrips(path,offset,junctions);
  const p=profiles.get(path)!,line=offsetRoad(p.points,p.widths.map(w=>Math.abs(offset)<.1?offset:Math.sign(offset)*(Math.abs(offset)+(w-HIGHWAY.width)/2)));
  return line.slice(1).map((b,i)=>({a:line[i],b})).filter(q=>!junctions.some(j=>distanceToRoad(j,[q.a,q.b])<HIGHWAY.junctionRadius));
 };
 const openings=[...plan.exits,...plan.localJunctions,...access.flatMap(a=>[a.collector[a.collector.length-1]])];
 const onStreet=(x:number,z:number)=>(plan.streets??[]).some(st=>distanceToRoad([x,z],st)<.05);
 const onLand=(x:number,z:number)=>plan.land.some(r=>x>r.x&&x<r.x+r.w&&z>r.z&&z<r.z+r.d);
 for(const path of paths)for(let i=1;i<path.length;i++){
 const a=path[i-1],b=path[i];
 if(path===plan.route&&(distanceToRoad([(a[0]+b[0])/2,(a[1]+b[1])/2],plan.highway)<.1||onStreet((a[0]+b[0])/2,(a[1]+b[1])/2)))continue;
 const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.01)continue;
 const r=Math.atan2(b[0]-a[0],b[1]-a[1]);

 // Every segment, including bends, rests on a continuous structural edge beam.

 const prior=path.slice(1,i).reduce((sum,p,j)=>sum+Math.hypot(p[0]-path[j][0],p[1]-path[j][1]),0);
 for(let t=(4-prior%HIGHWAY.supportSpacing+HIGHWAY.supportSpacing)%HIGHWAY.supportSpacing;t<length;t+=HIGHWAY.supportSpacing){const px=a[0]+(b[0]-a[0])*t/length,pz=a[1]+(b[1]-a[1])*t/length;if(onLand(px,pz))continue;const width=profileWidthAt(profiles.get(path)!,[px,pz]),pierOffset=Math.max(.08,width/2-.13);for(const side of [-1,1])out.push(box(px+Math.cos(r)*side*pierOffset,-1.2,pz-Math.sin(r)*side*pierOffset,.15,TERRACE_H+1.16,.18,"#aaa99d"));out.push({p:[px,TERRACE_H-.12,pz],s:[width+.1,.12,.2],r,c:"#bcb9aa"});}

 }
 // Short shared cross-sections taper the deck and edge beams continuously into bends. Straight
 // stretches of equal width are one box each: the drawn shape is the same with far fewer boxes.
 for(const path of paths){
  const profile=profiles.get(path)!;
  type Run={a:[number,number];b:[number,number];width:number;beam:boolean};
  const runs:Run[]=[];
  for(let i=1;i<profile.points.length;i++){
   const a=profile.points[i-1],b=profile.points[i],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
   if(path===plan.route&&(distanceToRoad([x,z],plan.highway)<.1||onStreet(x,z)))continue;
   const width=(profile.widths[i-1]+profile.widths[i])/2,beam=path===plan.highway||!onLand(x,z),last=runs[runs.length-1];
   if(last&&last.beam===beam&&Math.abs(last.width-width)<.002&&Math.hypot(a[0]-last.b[0],a[1]-last.b[1])<1e-3){
    const h1=Math.atan2(last.b[1]-last.a[1],last.b[0]-last.a[0]),h2=Math.atan2(b[1]-a[1],b[0]-a[0]);
    if(Math.abs(Math.atan2(Math.sin(h2-h1),Math.cos(h2-h1)))<.01){last.b=b;continue;}
   }
   runs.push({a,b,width,beam});
  }
  for(const {a,b,width,beam} of runs){
   const x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,length=Math.hypot(b[0]-a[0],b[1]-a[1]),r=Math.atan2(b[0]-a[0],b[1]-a[1]);
   out.push({p:[x,TERRACE_H+.025,z],s:[width,.06,length+.035],r,c:path===plan.highway?"#343d3e":"#424b50"});
   if(beam)out.push({p:[x,TERRACE_H-.09,z],s:[width+.08,.12,length+.035],r,c:"#bcb9aa"});
  }
 }
 // Every rail and marking uses the same mitered curve offsets as opposing lanes.
 const strip=(a:[number,number],b:[number,number],width:number,height:number,y:number,color:string)=>{
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]);out.push({p:[(a[0]+b[0])/2,y,(a[1]+b[1])/2],s:[width,height,length+.012],r:Math.atan2(b[0]-a[0],b[1]-a[1]),c:color});
 };
 for(const path of paths){
  // Edge lines, centre dashes and curbs stop where the truck route shares a district street.
  const offStreet=(q:{a:[number,number];b:[number,number]})=>{if(path!==plan.route)return true;const m:[number,number]=[(q.a[0]+q.b[0])/2,(q.a[1]+q.b[1])/2];return !nearJoin(m,FREIGHT_STREET_TURN*1.6+1.5)&&!(plan.streets??[]).some(st=>distanceToRoad(m,st)<HIGHWAY.barrier+.12);};
  for(const side of [-1,1]){
   for(const q of mergeSegments(roadLines(path,side*HIGHWAY.shoulder,path===plan.highway?plan.exits:openings).filter(q=>offStreet(q)&&(path!==plan.route||distanceToRoad(q.a,plan.highway)>.2))))strip(q.a,q.b,.025,.01,TERRACE_H+.09,"#ede8d6");
   if(path===plan.highway)for(const q of mergeSegments(roadLines(path,side*.045,plan.exits)))strip(q.a,q.b,.022,.01,TERRACE_H+.09,"#d5b76b");
   else if(side===1&&!ramps.has(path)){
    const center=roadLines(path,0,openings);
    for(const [i,q] of center.entries())if(i%4<2&&offStreet(q)&&distanceToRoad(q.a,plan.highway)>.2)strip(q.a,q.b,.025,.01,TERRACE_H+.09,"#e5dfc9");
   }
   if(path===plan.route)for(const q of mergeSegments(roadLines(path,side*HIGHWAY.barrier,[...plan.exits,...plan.localJunctions]).filter(q=>offStreet(q)&&onLand(q.a[0],q.a[1])&&distanceToRoad(q.a,plan.highway)>1.1)))strip(q.a,q.b,.1,.035,TERRACE_H+.08,"#cfcbbd");
   if(path===plan.highway||path!==plan.route){
    const rails=roadLines(path,side*HIGHWAY.barrier,openings);
    const shown=rails.filter(q=>path===plan.highway||!onLand(q.a[0],q.a[1]));
    // One box per straight run of rail; posts keep their spacing along the original segments.
    for(const q of mergeSegments(shown))strip(q.a,q.b,.045,.075,TERRACE_H+HIGHWAY.railHeight,"#2f4a3a");
    for(const [i,q] of rails.entries())if(i%3===0&&(path===plan.highway||!onLand(q.a[0],q.a[1])))out.push(box(q.a[0],TERRACE_H+.08,q.a[1],.04,HIGHWAY.railHeight-.08,.04,"#2f4a3a"));
   }
  }

 }
 // Direction arrows identify separate entrance and exit ramps without adding labels.
 for(const p of lightPositions)out.push(box(p[0],TERRACE_H+.08,p[1],.045,.85,.045,"#68776e"));
 for(const {a,b} of interchangeArrows(access)){const r=Math.atan2(b[0]-a[0],b[1]-a[1]);
  for(const side of [-1,1])out.push({p:[b[0]+Math.cos(r)*side*.065,TERRACE_H+.1,b[1]-Math.sin(r)*side*.065],s:[.025,.012,.19],r:r+side*.55,c:'#eee6d2'});
 }
 return out;
}
