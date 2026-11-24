import type {Pt} from '../map3d/roads';
import {AIOPS,AIOPS_FLOORS,floorElevation,podiumRing,ribbonSpan,towerPoint,towerRing} from '../map3d/aiOpsCenterPlan';

/**
 * The Atlas AI Operations Center's interior, drawn from the map model's own plan (aiOpsCenterPlan.ts):
 * the lobby and operations floor take the podium storeys' outlines, the tower floors the tower's
 * ellipse at their height, and the bronze ribbon passes the tower floors' glass exactly where it
 * does outside. Interior units are map units times INTERIOR_K, centred on the podium.
 */
export const INTERIOR_K=3.2;
export const STOREY=3.2;
/** The tower height the interior is drawn for; a test ties it to the planned building. */
export const INTERIOR_HEIGHT=12.5;
export const AIOPS_LEVELS=[0,1,2,3,4] as const;

type Item={p:[number,number,number];s:[number,number,number];c:string;r?:number};
export interface InteriorFloor{
 level:number;label:string;summary:string;role:string;
 /** Floor outline, interior units, counter-clockwise from above. */
 outline:Pt[];span:[number,number];glass:string;
 core:{x:number;z:number;w:number;d:number};
 drum?:{x:number;z:number;r:number};
 /** The planned role's desk (gold), labelled in the single-floor view. */
 desks:{id:string;label:string;role:string;x:number;z:number}[];
 /** Bronze ribbon louvres outside the glass on tower floors: span angles at each louvre height. */
 ribbon:{y:number;from:number;to:number}[];
 items:Item[];
}

const K=INTERIOR_K,P=AIOPS.palette;
const toIn=([x,z]:Pt):Pt=>[x*K,z*K];
export function insidePoly(poly:Pt[],[x,z]:Pt){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;}
const seg=(a:Pt,b:Pt,y:number,h:number,t:number,c:string):Item=>({p:[(a[0]+b[0])/2,y,(a[1]+b[1])/2],s:[Math.hypot(b[0]-a[0],b[1]-a[1])+.02,h,t],c,r:-Math.atan2(b[1]-a[1],b[0]-a[0])});

/** One floor of the building, with its furniture as boxes. */
export function interiorFloor(level:number,height=INTERIOR_HEIGHT):InteriorFloor{
 const meta=AIOPS_FLOORS[level],tower=level>=2,elev=floorElevation(level);
 const outline=(tower?towerRing(elev,height,1,64):podiumRing(Math.min(level,1),64)).map(toIn);
 const xs=outline.map(p=>p[0]),zs=outline.map(p=>p[1]);
 const T=AIOPS.tower,core={x:T.cx*K,z:T.cz*K,w:3.4,d:2.6};
 const A=AIOPS.atrium,drum=level<=1?{x:A.x*K,z:A.z*K,r:A.r*K}:undefined;
 const items:Item[]=[],H=STOREY-.3;
 // Mullions at every other outline point: the exterior's fin rhythm.
 outline.forEach((p,i)=>{if(i%2)return;items.push({p:[p[0],0,p[1]],s:[.12,H,.12],c:P.mullion});});
 // Ceiling band round the glass, in the slab colour.
 outline.forEach((a,i)=>items.push(seg(a,outline[(i+1)%outline.length],H-.18,.18,.16,P.slab)));
 // Lift and stair core at the tower's centre, bronze doors facing the front.
 items.push({p:[core.x,0,core.z],s:[core.w,H,core.d],c:'#d3d6cf'},{p:[core.x,0,core.z+core.d/2+.02],s:[1.4,2.2,.06],c:P.bronze});
 // Bronze ribbon passing the tower floors: louvres outside the glass, at the exterior's angles for this height.
 const ribbon:InteriorFloor['ribbon']=[];
 if(tower)for(let k=0;k<4;k++){
  const y=elev+k*AIOPS.tower.floor,span=ribbonSpan(y,height);if(!span)continue;
  ribbon.push({y,from:span.from,to:span.to});
  const S=10,yi=k*STOREY/4+.25;
  for(let i=0;i<S;i++){const a=toIn(towerPoint(span.from+(span.to-span.from)*i/S,y,height,1.06)),b=toIn(towerPoint(span.from+(span.to-span.from)*(i+1)/S,y,height,1.06));items.push(seg(a,b,yi,.14,.36,P.bronze));}
  for(const phi of [span.from,span.to]){const [x,z]=toIn(towerPoint(phi,y,height,1.05));items.push({p:[x,yi-.25,z],s:[.12,STOREY/4+.05,.4],c:P.bronzeDark});}
 }
 // Desks in rows round the core, clear of the glass, the core and the atrium drum.
 const shrink=outline.map(([x,z]):Pt=>{const cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;return [cx+(x-cx)*.86,cz+(z-cz)*.86];});
 const desks:InteriorFloor['desks']=[];const free=(x:number,z:number)=>insidePoly(shrink,[x,z])&&!(Math.abs(x-core.x)<core.w/2+1.3&&Math.abs(z-core.z)<core.d/2+1.3)&&!(drum&&Math.hypot(x-drum.x,z-drum.z)<drum.r+1.4);
 if(level>0){
  const spots:Pt[]=[];for(let x=Math.min(...xs)+1.5;x<Math.max(...xs)-1;x+=3.1)for(let z=Math.min(...zs)+1.5;z<Math.max(...zs)-1;z+=2.8)if(free(x,z))spots.push([x,z]);
  // The planned role's desk: the one nearest the front of the floor, in gold.
  const front=spots.reduce((b,p)=>p[1]-Math.abs(p[0]-core.x)*.3>b[1]-Math.abs(b[0]-core.x)*.3?p:b,spots[0]);
  for(const [x,z] of spots){const lead=front&&x===front[0]&&z===front[1];
   items.push({p:[x,0,z],s:[1.4,.74,.75],c:lead?'#c9944f':'#b9a07a'},{p:[x,.74,z-.18],s:[.62,.36,.04],c:'#1f3431'},{p:[x,0,z+.65],s:[.5,.5,.5],c:'#41605b'});}
  if(front)desks.push({id:`${meta.id}-role`,label:`${meta.label} desk`,role:meta.role,x:front[0],z:front[1]});
 }else{
  // Lobby: a curved reception desk inside the atrium drum, lounge seating and the entrance mat.
  const d=drum!;for(let k=0;k<20;k++){const t=Math.PI*.15+k/20*Math.PI*.7;items.push({p:[d.x+Math.cos(t+Math.PI)*d.r*.45,0,d.z+Math.sin(t+Math.PI)*d.r*.45],s:[.6,1.05,.4],c:k%2?P.bronze:'#e9e2d3',r:-t});}
  for(const dx of [-6,-3.5,6.5,9])items.push({p:[dx,0,4.5],s:[1.6,.45,.8],c:'#58706a'},{p:[dx,0,5.6],s:[.8,.4,.8],c:'#d8cdb6'});
  // The glazed entrance vestibule on the drum's street face, as outside: bronze frame, glass, dark doors.
  const E=AIOPS.entry,vw=E.w*K,vd=E.d*K,vh=E.h*K,vz=(A.z+A.r-.05+E.d/2)*K,fz=vz+vd/2;
  for(const dx of [-vw/2,-vw/6,vw/6,vw/2])items.push({p:[d.x+dx,0,fz],s:[.11,vh,.11],c:P.bronze});
  for(const sx of [-1,1])items.push({p:[d.x+sx*vw/2,vh*.78,vz],s:[.11,.11,vd],c:P.bronze});
  items.push({p:[d.x,vh,vz],s:[vw+.18,.16,vd+.16],c:P.slab},{p:[d.x,0,fz+.03],s:[vw/3-.12,vh*.76,.04],c:'#2c3b38'});
  items.push({p:[d.x,0,fz+1],s:[3,.03,1.4],c:'#5a4630'});
  desks.push({id:'lobby-reception',label:'Reception',role:meta.role,x:d.x,z:d.z});
 }
 if(drum&&level===1)for(let k=0;k<36;k++){const t=k/36*Math.PI*2;items.push({p:[drum.x+Math.cos(t)*(drum.r+.1),0,drum.z+Math.sin(t)*(drum.r+.1)],s:[.9,1,.06],c:'#cfe3e0',r:-t-Math.PI/2},{p:[drum.x+Math.cos(t)*(drum.r+.1),1,drum.z+Math.sin(t)*(drum.r+.1)],s:[.9,.06,.1],c:P.bronze,r:-t-Math.PI/2});}
 return {level,label:meta.label,summary:meta.summary,role:meta.role,outline,span:[Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs)],glass:P.glassBottom,core,drum,desks,ribbon,items};
}
