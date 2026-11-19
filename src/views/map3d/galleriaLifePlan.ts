import {galleriaCar,type GalleriaCarKind} from './galleriaFleet';
import type {Pt,Pt3} from './roads';
import type {Scene3D} from './scene';
import {GALLERIA_NOTCH,insidePoly} from './galleriaPlan';
import {along,commuterRoute,type CommuterRoute} from './railCommuters';
import {buildStreetGraph,nearestStreet,streetLines} from './streetGraph';

/**
 * Life round Atlas Galleria (Khaneil, 2026-11-08): a paved walk from the entrance out to the nearest
 * street, lamp posts round the building and along the walk, shoppers coming and going and
 * strolling round it, and drivers who walk out to a parked car, back out and drive off the lot,
 * then come back later and walk in again. Pure and deterministic, like the district visitors:
 * the same clock always gives the same picture, and nothing here is a real agent or a real car.
 */
export const GALLERIA_LIFE={
 walkWidth:.5,driveWidth:.95,lampStep:2.1,lampRing:.5,lampHeight:.95,
 pace:.32,drive:1.1,shoppers:8,strollers:5,
 /** A street farther than this from the lot's edge is too far to walk to; the walk stops at the lot. */
 maxStreet:5,
 /** Where people go in and out at the notch's glass: how far out of the glass they stop, and how far apart the in and out points stand. */
 portal:{d:.12,door:.46,slide:.68},
 /** Clear distance kept between anyone walking and the fountain's rim. */
 fountainClear:.4,
 /** Offset of a car from the drive's centre line, so traffic keeps right. */
 lane:.22,
} as const;

export interface GalleriaLamp {x:number;z:number;yaw:number}
export interface GalleriaWalker {route:CommuterRoute;phase:number;pace:number;lane:number;
 /** Out-and-back (a shopper going in) or a closed loop (a stroller round the building). */
 loop:boolean;rest:number;
 /** A shopper's way back out, through the exit doors and round the other side of the fountain. */
 back?:CommuterRoute}
/**
 * The main entrance at the V-notch's glass, where people go in on one side and come out on the other
 * (the building keeps its original design; there is no separate entrance structure).
 * `u` points out of the building, `p` across it toward the entry side.
 */
export interface GalleriaPortal {x:number;z:number;u:Pt;p:Pt;entry:Pt;exit:Pt}
export interface GalleriaDriver {walk:CommuterRoute;drive:CommuterRoute;car:{x:number;z:number;yaw:number;c:string;kind:GalleriaCarKind};offset:number;wait:number;
 /** Backs out of a bay into the aisle (the car park behind the building) rather than pulling straight out (the street court). */
 backOut:boolean}
/** Where the lot is too shallow for the car park behind the building: a row of bays each side of the walk, facing the street. */
export interface GalleriaCourt {pad:{x:number;z:number;w:number;d:number}[];stripes:Pt[];cars:{x:number;z:number;c:string;kind:GalleriaCarKind}[]}
/** An asphalt drive from a car park to the street (Khaneil, 2026-11-08), centre line a→b; b is on the street's centre line. */
export interface GalleriaDriveway {a:Pt;b:Pt}
export interface GalleriaLife {portal:GalleriaPortal;walk:Pt[];lamps:GalleriaLamp[];walkers:GalleriaWalker[];drivers:GalleriaDriver[];court?:GalleriaCourt;driveways:GalleriaDriveway[];
 /** Car park surfaces (the lot behind the building, or the street court), for carHeight. */
 lots:{x:number;z:number;w:number;d:number}[];
 /** Where a driveway passes under a station or district walk: a zebra crossing is painted on the walk, as at the city's roads. */
 crossings:{x:number;z:number;yaw:number}[]}
/** Surface heights above the ground a car sits on: car park asphalt, a driveway (over the pavement it crosses), and the street. */
export const CAR_SURFACE={lot:.012,driveway:.04,street:.03} as const;
export type LifePose={visible:false}|{visible:true;x:number;z:number;yaw:number};

const flat=(p:Pt):Pt3=>[p[0],0,p[1]];
const dist=(a:Pt,b:Pt)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
/** A closed outline pushed `k` outward (positive) along each vertex's averaged normal. */
function offset(line:Pt[],k:number):Pt[]{
 const area=line.reduce((a,[x,z],i)=>{const [u,v]=line[(i+1)%line.length];return a+x*v-u*z;},0),sign=area>0?1:-1;
 return line.map(([x,z],i)=>{const [px,pz]=line[(i-1+line.length)%line.length],[nx,nz]=line[(i+1)%line.length],dx=nx-px,dz=nz-pz,l=Math.hypot(dx,dz)||1;return [x+sign*dz/l*k,z-sign*dx/l*k];});
}
/** Points every `step` round a closed line. */
function every(line:Pt[],step:number):{p:Pt;a:number}[]{
 const out:{p:Pt;a:number}[]=[],ring=[...line,line[0]];let carry=0;
 for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],len=dist(a,b);let t=carry;while(t<len){out.push({p:[a[0]+(b[0]-a[0])*t/len,a[1]+(b[1]-a[1])*t/len],a:Math.atan2(b[1]-a[1],b[0]-a[0])});t+=step;}carry=t-len;}
 return out;
}
/** Distance in plan from p to segment ab. */
const toSegment=(p:Pt,a:Pt,b:Pt)=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/l));return dist(p,[a[0]+dx*t,a[1]+dz*t]);};
/** Where segments ab and cd cross, if they do. */
function intersect(a:Pt,b:Pt,c:Pt,d:Pt):Pt|undefined{
 const r=[b[0]-a[0],b[1]-a[1]],q=[d[0]-c[0],d[1]-c[1]],den=r[0]*q[1]-r[1]*q[0];if(Math.abs(den)<1e-9)return;
 const t=((c[0]-a[0])*q[1]-(c[1]-a[1])*q[0])/den,u=((c[0]-a[0])*r[1]-(c[1]-a[1])*r[0])/den;
 return t>=0&&t<=1&&u>=0&&u<=1?[a[0]+r[0]*t,a[1]+r[1]*t]:undefined;
}
const inRect=(r:{x:number;z:number;w:number;d:number},[x,z]:Pt,m=0)=>x>r.x-m&&x<r.x+r.w+m&&z>r.z-m&&z<r.z+r.d+m;

export function planGalleriaLife(scene:Scene3D):GalleriaLife|undefined{
 const g=scene.galleria;if(!g)return;
 const L=GALLERIA_LIFE,{rect,footprint:f,entrance:e}=g,east=rect.x+rect.w;
 const graph=buildStreetGraph(streetLines(scene));
 // The entrance walk: out of the forecourt to the lot's east edge, then on to the street if one is close. It starts
 // at a junction just short of the fountain (the plan's entrance point sits almost on its rim); paths round the fountain begin there.
 const F:Pt=[g.fountain.x,g.fountain.z],clear=g.fountain.r+L.fountainClear,gap=Math.abs(e.z-F[1]);
 const J:Pt=gap>=clear?[e.x,e.z]:[Math.max(e.x,F[0]+Math.sqrt(clear*clear-gap*gap)+.1),e.z];
 const walk:Pt[]=[J,[east,e.z]];
 const street=nearestStreet(graph,[east,0,e.z]);
 if(street.d<L.maxStreet)walk.push([street.q[0],street.q[2]]);
 else{
  // Across a street from the Marketplace, the street runs past the lot's south end: the walk turns
  // down just outside the lot's east edge, clear of the building and beside the car park, to the
  // point nearest it.
  const wx=east+L.walkWidth/2+.1;let best:{z:number;q:Pt3;d:number}|undefined;
  for(let z=e.z;z<=rect.z+rect.d;z+=.1){const q=nearestStreet(graph,[wx,0,z]);if(!best||q.d<best.d)best={z,q:q.q,d:q.d};}
  if(best&&best.d<L.maxStreet){walk[1]=[wx,e.z];walk.push([wx,best.z],[best.q[0],best.q[2]]);}
 }
 // Lamps: a ring a little outside the ground floor, skipping the forecourt and the walk, then pairs along the walk.
 const ring=offset(g.slabs[0],L.lampRing),lamps:GalleriaLamp[]=[];
 const clearOfWalk=([x,z]:Pt)=>!(x>J[0]-1.4&&Math.abs(z-e.z)<1.1);
 // A lamp may stand at the lot's edge, but never in a street, on another building or in the car park.
 const blocks=[...scene.towers,...scene.kiosks].map(b=>({x:b.x-b.size/2,z:b.z-b.size/2,w:b.size,d:b.size}));
 if(scene.mall)blocks.push(scene.mall);
 const offStreet=(p:Pt)=>nearestStreet(graph,[p[0],0,p[1]]).d>.45;
 for(const {p,a} of every(ring,L.lampStep))if(clearOfWalk(p)&&inRect(rect,p,.3)&&offStreet(p)&&!blocks.some(b=>inRect(b,p,.2))&&!(g.parking&&inRect(g.parking.area,p,.2)))lamps.push({x:p[0],z:p[1],yaw:-a});
 for(let i=1;i<walk.length;i++){const a=walk[i-1],b=walk[i],len=dist(a,b),n=Math.floor(len/1.6),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
  for(let k=1;k<=n;k++){const x=a[0]+dx*k*len/(n+1),z=a[1]+dz*k*len/(n+1);for(const s of [-1,1])lamps.push({x:x-dz*s*(L.walkWidth/2+.12),z:z+dx*s*(L.walkWidth/2+.12),yaw:Math.atan2(dx*s,-dz*s)});}}
 // People go in and out at the notch's apex on the ground-floor glass, facing the forecourt.
 const apex=g.toMap(GALLERIA_NOTCH),A=g.glass[0].reduce((b,q)=>dist(q,apex)<dist(b,apex)?q:b,g.glass[0][0]);
 const ul=dist(A,J)||1,u:Pt=[(J[0]-A[0])/ul,(J[1]-A[1])/ul],pp:Pt=[-u[1],u[0]],P=L.portal;
 const at=(k:number,j:number):Pt=>[A[0]+u[0]*k+pp[0]*j,A[1]+u[1]*k+pp[1]*j];
 const front=P.d-.05,entry=at(front,P.slide),exit=at(front,-P.slide),[cx,cz]=at(front/2,0);
 const portal:GalleriaPortal={x:cx,z:cz,u,p:pp,entry,exit};
 // In by the entry doors round one side of the fountain, out by the exit doors round the other; never through it.
 const side=(j:number)=>{const fe=[J[0]-F[0],J[1]-F[1]],k=Math.max(clear,fe[0]*u[0]+fe[1]*u[1]);
  return [[F[0]+u[0]*k+pp[0]*j*clear,F[1]+u[1]*k+pp[1]*j*clear],[F[0]+pp[0]*j*clear*1.05,F[1]+pp[1]*j*clear*1.05],[F[0]-u[0]*clear*.6+pp[0]*j*clear,F[1]-u[1]*clear*.6+pp[1]*j*clear]] as Pt[];};
 const inPath:Pt[]=[J,...side(1),at(front+.3,P.slide),entry],outPath:Pt[]=[exit,at(front+.3,-P.slide),...side(-1).reverse(),J];
 // Shoppers walk the entrance walk in and out; strollers circle the building on the lamp ring.
 const walkers:GalleriaWalker[]=[];
 const inbound=commuterRoute([...[...walk].reverse(),...inPath.slice(1)].map(flat)),outbound=commuterRoute([...outPath,...walk.slice(1)].map(flat));
 for(let i=0;i<L.shoppers;i++)walkers.push({route:inbound,back:outbound,phase:i*7.3,pace:L.pace*(.85+.3*((i*5)%7)/7),lane:((i%3)-1)*.06,loop:false,rest:6+(i%4)*3});
 const stroll=commuterRoute([...offset(g.slabs[0],L.lampRing-.3),offset(g.slabs[0],L.lampRing-.3)[0]].map(flat));
 for(let i=0;i<L.strollers;i++)walkers.push({route:stroll,phase:i*stroll.length/L.strollers/(L.pace*.8),pace:L.pace*.8,lane:i%2?.08:-.08,loop:true,rest:0});
 // Drivers: out of the entrance, down to their car, then the car backs into the aisle and drives east off the lot.
 const drivers:GalleriaDriver[]=[],driveways:GalleriaDriveway[]=[];let court:GalleriaCourt|undefined;
 const farEnd=(q:Pt3,seg:number):Pt3|undefined=>{const sg=graph.segments[seg];if(!sg)return;const [a,b]=sg.map(n=>graph.nodes[n]);return dist([a[0],a[2]],[q[0],q[2]])>dist([b[0],b[2]],[q[0],q[2]])?[a[0],0,a[2]]:[b[0],0,b[2]];};
 if(!g.parking&&walk.length===3){
  // Bays across the strip between the lot and the street, nose to the street, clear of the walk, trees and lamps.
  // x1 stops short of the street's pavement, which runs about a unit either side of its centre line.
  // A lane runs along the court's street side; bays sit west of it, nose to the lane, and each half leaves by its own driveway.
  const sx=walk[2][0],x0=east+.25,x1=sx-1.05,lane=x1-.25,cx=(x0+lane-.25)/2;
  if(lane-.25-x0>=.4){
   const trees=[...scene.trees,...scene.bushes],busy=(x:number,z:number)=>trees.some(t=>Math.abs(t.x-x)<.32&&Math.abs(t.z-z)<.3)||lamps.some(l=>Math.abs(l.x-x)<.32&&Math.abs(l.z-z)<.25);
   court={pad:[],stripes:[],cars:[]};const bays:Pt[]=[];
   const exits:{z0:number;z1:number;z:number}[]=[];
   for(const [z0,z1] of [[rect.z+.3,e.z-.55],[e.z+.55,rect.z+rect.d-.3]] as const){
    if(z1-z0<1)continue;court.pad.push({x:x0,z:z0-.05,w:x1-x0,d:z1-z0+.1});
    // The driveway leaves from the middle of the half; no bay stands in front of it.
    const dz=(z0+z1)/2,q=nearestStreet(graph,[sx,0,dz]);exits.push({z0,z1,z:dz});
    driveways.push({a:[lane,dz],b:[q.q[0],q.q[2]]});
    for(let z=z0+.17;z<=z1-.17;z+=.34){court.stripes.push([cx,z-.17]);if(!busy(cx,z))bays.push([cx,z]);}
    court.stripes.push([cx,z1]);
   }
   bays.forEach(([x,z],k)=>{
    if(k%2)return;const {kind,c}=galleriaCar(k/2);
    if(drivers.length<5&&k%4===0){
     const door:Pt=[x,z+(z<e.z?.2:-.2)],walkPts:Pt[]=[...outPath,[east,e.z],[east+.1,door[1]],door];
     // Forward into the lane, along it to this half's driveway, out along the driveway and onto the street.
     const half=exits.find(h=>z>=h.z0-.01&&z<=h.z1+.01)??exits[0],ex=nearestStreet(graph,[sx,0,half.z]);
     const drivePts:Pt3[]=[[x,0,z],[lane,0,z],[lane,0,half.z],ex.q];const far=farEnd(ex.q,ex.seg);if(far)drivePts.push(far);
     drivers.push({walk:commuterRoute(walkPts.map(flat)),drive:commuterRoute(drivePts),car:{x,z,yaw:Math.PI/2,c,kind},offset:drivers.length*23,wait:28+drivers.length*6,backOut:false});
    }else court!.cars.push({x,z,c,kind});
   });
  }
 }
 if(g.parking){
  // One driveway from the east end of the aisle to the nearest street.
  const pk=g.parking,out:Pt=[pk.area.x+pk.area.w,pk.aisle],exitStreet=nearestStreet(graph,[out[0],0,out[1]]);
  if(exitStreet.d<L.maxStreet)driveways.push({a:out,b:[exitStreet.q[0],exitStreet.q[2]]});
  pk.driven.forEach((c,i)=>{
   const side=c.z<pk.aisle?-1:1,door:Pt=[c.x-.18,c.z-side*.05];
   const walkPts:Pt[]=[...outPath,[J[0],f.z+f.d+.15],[door[0],f.z+f.d+.15],door];
   const drivePts:Pt3[]=[[c.x,0,c.z],[c.x,0,pk.aisle],[out[0],0,out[1]]];
   if(exitStreet.d<L.maxStreet){drivePts.push(exitStreet.q);const far=farEnd(exitStreet.q,exitStreet.seg);if(far)drivePts.push(far);}
   drivers.push({walk:commuterRoute(walkPts.map(flat)),drive:commuterRoute(drivePts),car:{x:c.x,z:c.z,yaw:c.yaw,c:c.c,kind:c.kind},offset:i*23,wait:28+i*6,backOut:true});
  });
 }
 // Lamps step off the driveways, and out of the car park and the building where the walk runs beside them.
 const lit=lamps.filter(l=>driveways.every(d=>toSegment([l.x,l.z],d.a,d.b)>L.driveWidth/2+.15)&&!(g.parking&&inRect(g.parking.area,[l.x,l.z],.1))&&!insidePoly(g.slabs[0],[l.x,l.z]));
 const lots=[...(court?.pad??[]),...(g.parking?[g.parking.area]:[])];
 // Station and district walks run on the ground over roads; mark each driveway crossing the way the city marks its road crossings.
 const crossings:{x:number;z:number;yaw:number}[]=[];
 const paths=[...(scene.communityRail?.loop?.stops??[]).map(st=>st.walk.filter(p=>p[1]===0).map((p):Pt=>[p[0],p[2]])),...scene.transportConnections.map(c=>c.walk)];
 for(const d of driveways)for(const path of paths)for(let i=1;i<path.length;i++){const x=intersect(d.a,d.b,path[i-1],path[i]);if(x)crossings.push({x:x[0],z:x[1],yaw:Math.atan2(d.b[0]-d.a[0],d.b[1]-d.a[1])});}
 return {portal,walk,lamps:lit,walkers,drivers,court,driveways,lots,crossings};
}

/** A shopper or stroller at time t. Shoppers walk in, stay inside a while, then walk back out. */
export function walkerAt(w:GalleriaWalker,t:number):LifePose{
 const len=w.route.length;if(!len)return {visible:false};
 if(w.loop){const p=along(w.route,((t*w.pace+w.phase*w.pace)%len+len)%len,w.lane);return {visible:true,x:p.x,z:p.z,yaw:p.yaw};}
 const leg=len/w.pace,period=leg+2*w.rest+(w.back?w.back.length/w.pace:leg),u=((t+w.phase)%period+period)%period;
 if(u<leg){const p=along(w.route,u*w.pace,w.lane);return {visible:true,x:p.x,z:p.z,yaw:p.yaw};}
 if(u<leg+w.rest)return {visible:false};
 if(w.back){const back=w.back.length/w.pace;if(u<leg+w.rest+back){const p=along(w.back,(u-leg-w.rest)*w.pace,w.lane);return {visible:true,x:p.x,z:p.z,yaw:p.yaw};}return {visible:false};}
 if(u<2*leg+w.rest){const p=along(w.route,len-(u-leg-w.rest)*w.pace,-w.lane);return {visible:true,x:p.x,z:p.z,yaw:p.yaw+Math.PI};}
 return {visible:false};
}

/** One driver's whole cycle: walk out, drive off, away, drive back, park, walk in, inside. */
/** Lane offset share along the bay's own stretch: none in the bay (its neighbours are parked close), full by the aisle. */
const ease=(dd:number,first:number)=>first>0?Math.min(1,Math.max(0,dd/first)):1;
export function driverAt(d:GalleriaDriver,t:number):{person:LifePose;car:LifePose&{moving?:boolean}}{
 const L=GALLERIA_LIFE,walk=d.walk.length/L.pace,drive=d.drive.length/L.drive,inside=d.wait;
 const period=2*walk+2*drive+d.wait+inside,u=((t+d.offset)%period+period)%period;
 const parked={visible:true as const,x:d.car.x,z:d.car.z,yaw:d.car.yaw};
 // Cars keep to the right-hand lane of the two-lane drive: one side going out, the other coming back.
 const at=(r:CommuterRoute,dd:number,flip=false,lane=0)=>{const p=along(r,dd,lane);return {visible:true as const,x:p.x,z:p.z,yaw:p.yaw+(flip?Math.PI:0)};};
 let s=u;
 if(s<walk)return {person:at(d.walk,s*L.pace),car:parked};s-=walk;
 // Backing out of the bay faces the car the way it parked; once in the aisle it drives forwards.
 if(s<drive){const dd=s*L.drive,first=d.drive.lengths[1]??0;return {person:{visible:false},car:{...at(d.drive,dd,d.backOut&&dd<first,L.lane*ease(dd,first)),moving:true}};}s-=drive;
 if(s<d.wait)return {person:{visible:false},car:{visible:false}};s-=d.wait;
 if(s<drive){const dd=d.drive.length-s*L.drive,first=d.drive.lengths[1]??0;return {person:{visible:false},car:{...at(d.drive,dd,dd>first,-L.lane*ease(dd,first)),moving:true}};}s-=drive;
 if(s<walk)return {person:at(d.walk,d.walk.length-s*L.pace,true),car:parked};
 return {person:{visible:false},car:parked};
}

/** Height of the surface under a car at (x, z): driveway first (it runs over the pavement), then car park, otherwise the street. */
export function carHeight(life:Pick<GalleriaLife,'driveways'|'lots'>,x:number,z:number){
 if(life.driveways.some(d=>toSegment([x,z],d.a,d.b)<=GALLERIA_LIFE.driveWidth/2))return CAR_SURFACE.driveway;
 return life.lots.some(r=>inRect(r,[x,z],.05))?CAR_SURFACE.lot:CAR_SURFACE.street;
}
