import type {Inst} from './models';
import type {PerimeterRailPlan} from './perimeterRailPlan';
import {stationPoint} from './perimeterRailPlan';
import type {MarinaSite} from './marinaPlan';
import {COMMUNITY,type Point3} from './hillsCommunityPlan';
import {TERRACE_H,WATER_Y} from './scene';
import {planTransitGateway,gatewayRoute,type GatewayPlan,type Walkable} from './transitGateway';

/**
 * Harbour platform at Events Arena Station (Khaneil, 2026-11-16: "integrate the dock and train station so people can
 * board the train and the dock like a realistic design"). The ground-level shore track runs only .75 inside the seawall
 * here, so the station gets a second, seaward platform face built out over the seawall: trains open their doors on both
 * sides, and the seaward platform runs on as a timber harbour boardwalk to the yacht dock. A dog-leg stair hangs off the
 * boardwalk's sea edge, parallel to the shore, and lands on the existing pier root, so the pier, dock and yacht stay put
 * and the stair never meets the rails. People from the city reach the boardwalk through the Transit Gateway's footbridge
 * over the track (transitGateway.ts), which replaced the level crossing.
 */
export const HARBOUR={stationId:'service:stadium-station',edge:.325,depth:1.05,steps:12,stairRun:2.4,stairWidth:.7,stairGap:.05,landing:.8,topLanding:.6,pileSpacing:1.2,railHeight:.32} as const;

/** All x/z are world units; y values are heights above the terrace top. The track runs along world x here. */
export interface HarbourPlan {
 stopId:string;stop:[number,number];trackZ:number;
 /** +1 when the marina is east (+x) of the station, -1 when west. */
 dir:1|-1;
 /** Seaward platform (beside the train) and the boardwalk that continues it, as one deck band z0..z1 at height y. */
 y:number;z0:number;z1:number;platform:[number,number];deck:[number,number];
 /** Stair down to the pier root, along x from top (at deck height) to bottom (dock level), in band zs0..zs1. */
 stair:{top:number;bottom:number;zs0:number;zs1:number};topLanding:[number,number];landing:{x0:number;x1:number;z0:number;z1:number};
 crossingX:number;shoreZ:number;dockY:number;
 /** Entrance lobby and footbridge from the city side, landing on this boardwalk. */
 gateway:GatewayPlan;
}

const lo=(a:number,b:number)=>Math.min(a,b),hi=(a:number,b:number)=>Math.max(a,b);

/** The harbour platform, when Events Arena Station and the yacht dock share the same straight run of seawall. */
export function planHarbourPlatform(loop:Pick<PerimeterRailPlan,'stops'>|undefined,m:MarinaSite):HarbourPlan|undefined{
 const stop=loop?.stops.find(s=>s.id===HARBOUR.stationId);if(!stop)return;
 // Track along x, sea on the +z side (station local -z), and the dock within reach along the same seawall.
 if(Math.abs(Math.cos(stop.yaw))>1e-3)return;
 const sea=stationPoint(stop,0,-1)[1]-stop.point[1];if(sea<=0)return;
 const [sx,trackZ]=stop.point,gap=m.shoreZ-trackZ,span=Math.abs(m.x-sx);
 if(gap<.4||gap>1.2||span<COMMUNITY.platformLength/2+HARBOUR.stairRun+2||span>16)return;
 const dir:1|-1=m.x>sx?1:-1,half=COMMUNITY.platformLength/2;
 const z0=trackZ+HARBOUR.edge,z1=z0+HARBOUR.depth,dockY=WATER_Y+.22-TERRACE_H;
 // The boardwalk runs on past the old crossing to where the gateway's footbridge comes down.
 const gateway=planTransitGateway(trackZ,dir,m,{y:COMMUNITY.platformRise,z0,z1}),far=dir>0?gateway.bridge.x1+.1:gateway.bridge.x0-.1;
 const bottom=m.x-dir*HARBOUR.landing/2,top=bottom-dir*HARBOUR.stairRun;
 const zs0=z1+HARBOUR.stairGap,zs1=zs0+HARBOUR.stairWidth;
 return {stopId:stop.id,stop:[sx,trackZ],trackZ,dir,y:COMMUNITY.platformRise,z0,z1,
  platform:[sx-half,sx+half],deck:[lo(sx-dir*half,far),hi(sx-dir*half,far)],
  stair:{top,bottom,zs0,zs1},topLanding:[lo(top,top-dir*HARBOUR.topLanding),hi(top,top-dir*HARBOUR.topLanding)],
  landing:{x0:m.x-HARBOUR.landing/2,x1:m.x+HARBOUR.landing/2,z0:zs0,z1:m.pierZ+.12},crossingX:m.x,shoreZ:m.shoreZ,dockY,gateway};
}

/** Walking line along the deck, then down the stair and onto the pier root (heights above the terrace). */
function toPier(h:HarbourPlan,m:MarinaSite):Point3[]{
 const mid=(h.z0+h.z1)/2,sz=(h.stair.zs0+h.stair.zs1)/2,turn=h.stair.top-h.dir*HARBOUR.topLanding/2;
 return [[turn,h.y,mid],[turn,h.y,sz],[h.stair.top,h.y,sz],[h.stair.bottom,h.dockY,sz],[m.x,h.dockY,sz],[m.x,h.dockY,m.pierZ]];
}
/** From the station plaza through the Transit Gateway and over the footbridge onto the boardwalk, then down to the pier root.
 * `closed` closes gateway ways (a closed stair reroutes by the lift). */
export function harbourAccess(h:HarbourPlan,m:MarinaSite,closed?:Parameters<typeof gatewayRoute>[3]):Point3[]{
 const way=gatewayRoute(h.gateway,'station_plaza','waterfront_boardwalk',closed)??[];
 return [...way,...toPier(h,m)];
}
/** Walkable surfaces beyond the gateway: boardwalk, stair head, the stair down and the dock landing on to the pier root. */
export function harbourWalkable(h:HarbourPlan,m:MarinaSite):Walkable[]{
 const [d0,d1]=h.deck,[t0,t1]=h.topLanding,s=h.stair,L=h.landing;
 return [
  {name:'harbour boardwalk',x0:d0,x1:d1,z0:h.z0,z1:h.z1,y0:h.y,y1:h.y,kind:'floor'},
  {name:'stair head',x0:t0,x1:t1,z0:h.z1-.02,z1:s.zs1,y0:h.y,y1:h.y,kind:'floor'},
  {name:'stair to the dock',x0:lo(s.top,s.bottom),x1:hi(s.top,s.bottom),z0:s.zs0,z1:s.zs1,y0:h.dockY,y1:h.y,kind:'stair',rises:h.dir>0?-1:1},
  {name:'dock landing',x0:L.x0,x1:L.x1,z0:L.z0,z1:L.z1,y0:h.dockY,y1:h.dockY,kind:'floor'},
  {name:'pier root',x0:m.x-.25,x1:m.x+.25,z0:L.z0,z1:m.pierZ+.3,y0:h.dockY,y1:h.dockY,kind:'floor'},
 ];
}
/** Off the train's seaward doors onto the harbour platform, along the boardwalk and down to the pier root. */
export function harbourAlight(h:HarbourPlan,m:MarinaSite,stop:Parameters<typeof stationPoint>[0]):Point3[]{
 const door=stationPoint(stop,.24,-.27),step=stationPoint(stop,.24,-.85);
 return [[door[0],h.y,door[1]],[step[0],h.y,step[1]],...toPier(h,m)];
}

/** Concrete harbour platform, timber boardwalk, railings, piles, stair and landings (world positions, bottom-anchored boxes). */
export function harbourParts(h:HarbourPlan):{deck:Inst[];rails:Inst[];lamps:Inst[]}{
 const deck:Inst[]=[],rails:Inst[]=[],lamps:Inst[]=[],T=TERRACE_H;
 const box=(x0:number,x1:number,y0:number,y1:number,z0:number,z1:number,c:string,target=deck)=>target.push({p:[(x0+x1)/2,T+y0,(z0+z1)/2],s:[x1-x0,y1-y0,z1-z0],c});
 const {z0,z1,y,dockY}=h,[p0,p1]=h.platform,[d0,d1]=h.deck,water=WATER_Y-T-.45;
 // Platform beside the train: a concrete kerb like the landward face, with the yellow safety line at the track edge.
 box(p0,p1,-.02,y,z0,lo(z1,h.shoreZ),'#ded8c7');
 box(p0,p1,y-.12,y,h.shoreZ,z1,'#d4cdbb');
 box(p0,p1,y+.005,y+.02,z0+.03,z0+.1,'#d0ad69');
 // The boardwalk continues the same band in timber, on the quay and then out over the water.
 for(const [a,b] of [[d0,p0],[p1,d1]] as [number,number][])if(b-a>.01){
  box(a,b,y-.1,y,z0,z1,'#b08a5e');box(a,b,-.02,y-.1,z0,lo(z1,h.shoreZ),'#c9c2ae');
 }
 // Dark fascia on the sea edge and piles down into the water wherever the deck is past the seawall.
 box(d0,d1,y-.2,y-.08,z1-.04,z1,'#5f5144');
 for(let x=d0+.15;x<=d1-.1;x+=HARBOUR.pileSpacing)box(x-.04,x+.04,water,y-.1,z1-.14,z1-.06,'#54493f');
 // Top landing at deck height, then twelve treads down to the pier root, and the dock-level landing over the water.
 const [t0,t1]=h.topLanding,{zs0,zs1}=h.stair,run=Math.abs(h.stair.top-h.stair.bottom),tread=run/HARBOUR.steps;
 box(t0,t1,y-.1,y,z1-.02,zs1,'#b08a5e');
 box(t0+.04,t1-.04,water,y-.1,zs1-.12,zs1-.04,'#54493f');
 for(let i=0;i<HARBOUR.steps;i++){
  const top=y-(y-dockY)*(i+1)/HARBOUR.steps,x=h.stair.top+h.dir*(i+.5)*tread;
  box(x-tread/2-.008,x+tread/2+.008,dockY-.12,top,zs0,zs1,i%2?'#aaa99e':'#bab7a8');
 }
 const L=h.landing;box(L.x0,L.x1,dockY-.09,dockY,L.z0,L.z1,'#b89569');
 for(const [px,pz] of [[L.x0+.06,L.z0+.06],[L.x1-.06,L.z0+.06],[L.x0+.06,L.z1-.2],[L.x1-.06,L.z1-.2]])box(px-.04,px+.04,water,dockY-.09,pz-.04,pz+.04,'#54493f');
 // Railings: green posts and a teal top rail like the old marina stair. Sea edge along the whole deck except the
 // stair top; land edge along the whole boardwalk away from the train (nobody crosses the track at rail level any more).
 const R=HARBOUR.railHeight;
 const railX=(a:number,b:number,z:number,base:number)=>{if(b-a<.05)return;box(a,b,base+R-.02,base+R+.01,z-.017,z+.017,'#76b5ae',rails);const n=Math.max(1,Math.ceil((b-a)/.3));for(let i=0;i<=n;i++){const x=a+(b-a)*i/n;box(x-.012,x+.012,base,base+R,z-.012,z+.012,'#335b58',rails);}};
 railX(d0,t0,z1-.03,y);railX(t1,d1,z1-.03,y);
 railX(t0,t1,zs1-.03,y);
 const away=h.dir>0?[p1,d1]:[d0,p0];
 railX(away[0],away[1],z0+.03,y);
 // Stair handrails on both sides follow the treads down.
 for(const z of [zs0+.03,zs1-.03])for(let i=0;i<HARBOUR.steps;i++){const top=y-(y-dockY)*(i+1)/HARBOUR.steps,x=h.stair.top+h.dir*(i+.5)*tread;box(x-.012,x+.012,top,top+R,z-.012,z+.012,'#335b58',rails);box(x-tread/2-.01,x+tread/2+.01,top+R-.02,top+R+.01,z-.017,z+.017,'#76b5ae',rails);}
 railX(L.x0,L.x1,L.z0+.03,dockY);
 // Lamp posts along the sea edge of the harbour face (the station shell's arches already reach over its track edge).
 for(const x of [p0+1.2,p1-1.2]){box(x-.025,x+.025,y,y+1.05,z1-.125,z1-.075,'#2f3a3c',rails);lamps.push({p:[x,T+y+1.08,z1-.1],s:[.07,.07,.07]});}
 // A lamp post at the stair head.
 {const x=(t0+t1)/2,z=zs1-.08;box(x-.025,x+.025,y,y+1.05,z-.025,z+.025,'#2f3a3c',rails);lamps.push({p:[x,T+y+1.08,z],s:[.07,.07,.07]});}
 return {deck,rails,lamps};
}
