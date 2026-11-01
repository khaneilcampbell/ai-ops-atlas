import type {Inst} from './models';
import {COMMUNITY as C} from './hillsCommunityPlan';
import type {Pt} from './roads';

/**
 * Financial Park station, after Dubai's rail architecture (KC, 2026-10-31): a Dubai Metro style
 * shell over the platform (Aedas' metro stations) and an enclosed, glazed skybridge with sweeping
 * arch ribs down to the park, like the Al Yalayis link between Etihad Rail and the Metro.
 * Everything is boxes on the shared instanced geometry: no new lights and no new meshes per frame.
 * Heights are relative to the terrace top, like the rest of the rail.
 */
export const PARK_STATION={
 /** Shell vault: half-axes across the track (z) and up (y), length along the track, slat count. */
 shell:{across:1,up:1.55,length:8.4,slats:13,maxAngle:72*Math.PI/180,centreZ:.45,lift:.15,glassBelow:40*Math.PI/180},
 ribs:[-4.2,-2.1,0,2.1,4.2],
 /** Glazed stair tube: stair centre line offset, half width, wall height, arch rise above the tube. */
 bridge:{dx:1,halfWidth:.6,wall:.78,archRise:.85,archSegments:12,foot:6.1},
 colors:{shell:'#e2dccd',rib:'#f4f2ec',accent:'#c9a35a',lift:'#d8d1c1',frame:'#8f9c9c'},
} as const;

export interface ParkStationParts {metal:Inst[];glass:Inst[];accents:Inst[]}

/** Rotation about x that lays a box's local z along the direction (dz, dy). */
const tilt=(dz:number,dy:number)=>Math.atan2(-dy,dz);

export function parkStationParts([x,z]:Pt,base:number):ParkStationParts{
 const metal:Inst[]=[],glass:Inst[]=[],accents:Inst[]=[],s=PARK_STATION.shell;
 const cy=base+C.platformRise+s.lift,cz=z+s.centreZ;
 const at=(t:number):[number,number]=>[cz+s.across*Math.sin(t),cy+s.up*Math.cos(t)];
 // Shell: slats around the cross-section, metal over the top and glass down the sides.
 const step=2*s.maxAngle/(s.slats-1);
 for(let i=0;i<s.slats;i++){
  const t=-s.maxAngle+i*step,[pz,py]=at(t),[qz,qy]=at(t+step*.5),[oz,oy]=at(t-step*.5);
  const width=Math.hypot(qz-oz,qy-oy)+.02,item:Inst={p:[x,py,pz],s:[s.length,.045,width],rx:tilt(qz-oz,qy-oy)};
  // The box's long side runs along the track (x); rx curls it around the vault.
  (Math.abs(t)<s.glassBelow?metal:glass).push({...item,c:Math.abs(t)<s.glassBelow?PARK_STATION.colors.shell:'#a9cfd2'});
 }
 // Ribs ring the shell like the gold-edged metro shells; the end ribs are the accent colour.
 for(const dx of PARK_STATION.ribs)for(let i=0;i<s.slats;i++){
  const t=-s.maxAngle+i*step,[pz,py]=at(t),[qz,qy]=at(t+step*.5),[oz,oy]=at(t-step*.5);
  const out=.05,nz=Math.sin(t)*out,ny=Math.cos(t)*out;
  (Math.abs(dx)===4.2?accents:metal).push({p:[x+dx,py+ny,pz+nz],s:[.1,.06,Math.hypot(qz-oz,qy-oy)+.03],rx:tilt(qz-oz,qy-oy),c:Math.abs(dx)===4.2?PARK_STATION.colors.accent:PARK_STATION.colors.rib});
 }
 // Columns carry the shell's lower edge on the platform side and the viaduct side.
 for(const dx of PARK_STATION.ribs)for(const t of [-s.maxAngle,s.maxAngle]){const [pz,py]=at(t);metal.push({p:[x+dx,base+C.railRise-.2,pz],s:[.07,py-(base+C.railRise-.2),.07],c:PARK_STATION.colors.frame});}
 // Glazed skybridge over the park stairs: glass walls and roof follow the stair slope.
 const b=PARK_STATION.bridge,sx=x+b.dx,top=z+1.7,run=4.2,len=Math.hypot(C.platformRise,run),slope=tilt(run,-C.platformRise),midZ=top+run/2,midY=base+C.platformRise/2;
 for(const side of [-1,1])glass.push({p:[sx+side*b.halfWidth,midY+.02,midZ],s:[.03,b.wall,len],rx:slope,c:'#a9cfd2'});
 glass.push({p:[sx,midY+b.wall+.02,midZ],s:[2*b.halfWidth+.06,.03,len],rx:slope,c:'#a9cfd2'});
 for(const side of [-1,1])metal.push({p:[sx+side*b.halfWidth,midY+b.wall+.02,midZ],s:[.06,.05,len],rx:slope,c:PARK_STATION.colors.frame});
 // Two sweeping arches, one each side, spring from the park and land on the platform.
 const foot:[number,number]=[z+b.foot,base],head:[number,number]=[top-.2,base+C.platformRise+.7];
 const arch=(k:number):[number,number]=>[foot[0]+(head[0]-foot[0])*k,foot[1]+(head[1]-foot[1])*k+b.archRise*Math.sin(Math.PI*k)+.25*Math.sin(Math.PI*k)*(1-k)];
 for(const side of [-1,1])for(let i=0;i<b.archSegments;i++){
  const [az,ay]=arch(i/b.archSegments),[bz,by]=arch((i+1)/b.archSegments);
  metal.push({p:[sx+side*(b.halfWidth+.12),(ay+by)/2,(az+bz)/2],s:[.08,.08,Math.hypot(bz-az,by-ay)+.04],rx:tilt(bz-az,by-ay),c:PARK_STATION.colors.rib});
 }
 return {metal,glass,accents};
}
