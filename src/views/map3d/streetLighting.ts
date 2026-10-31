import type {Scene3D} from './scene';
import {towerRing,type Pt,type Box} from './roads';
import {distanceToRoad} from './highway';
import {airportPoint,airportPublicPath,AIRPORT_LAYOUT} from './airport';
import {AIRPORT_BUILDINGS} from './airportBuildings';
import {HILLS} from './hillsPlan';
export const STREET_LIGHT={spacing:3.6,highwaySpacing:6,minSeparation:1.2,junctionClearance:.8,height:.95,highwayHeight:1.35,poleRadius:.025,maxFixtures:420} as const;
export interface StreetLamp {x:number;z:number;roadX:number;roadZ:number;yaw:number;height:number;highway:boolean}
export function lightingObstacles(s:Scene3D):Box[]{const boxes:Box[]=[...s.towers,...s.kiosks,...s.retail].map(b=>({x:b.x,z:b.z,w:b.size+.25,d:b.size+.25}));
 if(s.financial){const f=s.financial;boxes.push(...f.buildings.map(b=>({x:f.x+b.x,z:f.z+b.z,w:3.4,d:3})),{x:f.x+f.park.x+f.park.w/2,z:f.z+f.park.z+f.park.d/2,w:f.park.w,d:f.park.d});}
 if(s.hills){const h=s.hills;for(const b of [HILLS.mansion,HILLS.garage,HILLS.pool,HILLS.court])boxes.push({x:h.x+b.x,z:h.z+b.z,w:b.w+.2,d:b.d+.2});}
 if(s.community)boxes.push(...s.community.buildings.map(b=>({x:s.community!.x+b.x,z:s.community!.z+b.z,w:b.w+.2,d:b.d+.2})));
 if(s.dealership){const d=s.dealership;boxes.push({x:d.x+d.w/2,z:d.z+d.d/2,w:d.w,d:d.d});}
 if(s.stadium)boxes.push({x:s.stadium.x+4,z:s.stadium.z+3.5,w:7.8,d:6.8});
 if(s.airport){const a=s.airport;boxes.push(...AIRPORT_BUILDINGS.map(b=>{const p=airportPoint(a,b.x,b.z);return {x:p[0],z:p[1],w:b.w+.3,d:b.d+.3};}));for(const localX of [AIRPORT_LAYOUT.runwayX,AIRPORT_LAYOUT.taxiX]){const p=airportPoint(a,localX,AIRPORT_LAYOUT.runwayZ);boxes.push({x:p[0],z:p[1],w:3.8,d:25});}}
 boxes.push(...s.fountains.map(f=>({x:f.x,z:f.z,w:1.2*(f.k??1),d:1.2*(f.k??1)})));return boxes;
}
/** Static route-derived fixtures. No per-lamp lights, animation, timers or network activity. */
export function planStreetLights(s:Scene3D):StreetLamp[]{
 const paths:{points:Pt[];width:number;highway:boolean}[]=[];
 const add=(points:Pt[],width=.64,highway=false)=>{if(points.length>1)paths.push({points,width,highway});};
 for(const b of s.carBridges)for(const road of b.roads)add(road);
 for(const link of s.transportConnections)add(link.road);
 if(s.freight){add(s.freight.highway,1.4,true);add(s.freight.route,1.1);for(const a of s.freight.access){add(a.collector,1.1);for(const r of a.ramps)add(r,1.1);}}
 if(s.financial)add(s.financial.street);
 if(s.community)for(const road of s.community.streets)add(road);
 if(s.airport)add(airportPublicPath(s.airport),.48);
 for(const walk of s.walks)add(walk.route?.map(p=>[p.gx,p.gy] as Pt)??[[walk.x0,walk.z0],[walk.x1,walk.z1]],.48);
 for(const t of s.towers){const plaza=s.paving.filter(p=>p.w>t.size&&Math.abs(p.x+p.w/2-t.x)<.01&&Math.abs(p.z+p.d/2-t.z)<.01&&Math.abs(p.w-p.d)<.01).sort((a,b)=>a.w-b.w)[0];const r=plaza&&towerRing(t,plaza.w);if(r)add([[r.x0,r.z0],[r.x1,r.z0],[r.x1,r.z1],[r.x0,r.z1],[r.x0,r.z0]]);}
 const obstacles=lightingObstacles(s),walks=[...s.transportConnections.map(c=>c.walk),...(s.community?.walks??[]),...(s.financial?[s.financial.sidewalk]:[])];
 const junctions:Pt[]=[...s.transportConnections.flatMap(c=>[c.road[0],c.road[c.road.length-1]]),...(s.freight?.localJunctions??[]),...(s.freight?.exits??[]),...(s.community?.streets.flatMap(p=>[p[0],p[p.length-1]])??[])];
 const result:StreetLamp[]=[],cells=new Map<string,StreetLamp[]>(),cell=STREET_LIGHT.minSeparation;
 const near=(x:number,z:number)=>{const cx=Math.floor(x/cell),cz=Math.floor(z/cell);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(cells.get(`${cx+dx}:${cz+dz}`)?.some(p=>Math.hypot(x-p.x,z-p.z)<cell))return true;return false;};
 for(const path of paths){let carried=1.2,index=0;for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.001)continue;const nx=(b[1]-a[1])/len,nz=-(b[0]-a[0])/len;
 for(let d=carried;d<len;d+=path.highway?STREET_LIGHT.highwaySpacing:STREET_LIGHT.spacing){const rx=a[0]+(b[0]-a[0])*d/len,rz=a[1]+(b[1]-a[1])*d/len;if(junctions.some(p=>Math.hypot(rx-p[0],rz-p[1])<STREET_LIGHT.junctionClearance))continue;
 for(const sign of index++%2?[1,-1]:[-1,1]){let placed=false;for(const setback of [.5,.75]){const offset=path.width/2+setback,x=rx+nx*sign*offset,z=rz+nz*sign*offset;
 if(near(x,z)||(!path.highway&&!s.land.some(r=>x>r.x+.1&&x<r.x+r.w-.1&&z>r.z+.1&&z<r.z+r.d-.1)))continue;
 if(obstacles.some(o=>Math.abs(x-o.x)<o.w/2+.12&&Math.abs(z-o.z)<o.d/2+.12)||walks.some(w=>distanceToRoad([x,z],w)<.3))continue;
 if(paths.some(other=>distanceToRoad([x,z],other.points)<other.width/2+.12))continue;
 const lamp:StreetLamp={x,z,roadX:rx,roadZ:rz,yaw:Math.atan2(rx-x,rz-z),height:path.highway?STREET_LIGHT.highwayHeight:STREET_LIGHT.height,highway:path.highway};result.push(lamp);const key=`${Math.floor(x/cell)}:${Math.floor(z/cell)}`;cells.set(key,[...(cells.get(key)??[]),lamp]);placed=true;break;}
 if(placed)break;}
 if(result.length>=STREET_LIGHT.maxFixtures)return result;
 }carried=((carried-len)%(path.highway?STREET_LIGHT.highwaySpacing:STREET_LIGHT.spacing)+(path.highway?STREET_LIGHT.highwaySpacing:STREET_LIGHT.spacing))%(path.highway?STREET_LIGHT.highwaySpacing:STREET_LIGHT.spacing);}}
 return result;
}
export function stadiumFloodPositions(a:{x:number;z:number}):[number,number][]{return [-1,1].flatMap(side=>[-2.4,2.4].map(dx=>[a.x+4+dx,a.z+3.5+side*2.3] as [number,number]));}
