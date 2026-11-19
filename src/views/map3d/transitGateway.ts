import type {Inst} from './models';
import {COMMUNITY,TRAIN_ENVELOPE,type Point3} from './hillsCommunityPlan';
import type {MarinaSite} from './marinaPlan';

/**
 * Transit Gateway at Events Arena Station (Khaneil, 2026-11-16: "Transit Gateway & Boardwalk Entrance"). The walk from the
 * station plaza to the yacht dock used to cross the ground-level track on a level crossing. The gateway replaces it: a
 * glazed entrance lobby on the city side of the track with a stair and a lift, an enclosed footbridge over the track, and
 * a covered exit stair down onto the harbour boardwalk. People never set foot on the track bed.
 *
 * All x/z are world units and y values are heights above the terrace top, like the rest of the rail. The track runs along
 * world x here and the sea is on +z. `u` measures along the shore from the marina's centre line, positive away from the
 * station, so the bridge stands on the far side of the old crossing from the platforms.
 */
export const GATEWAY={
 /** Lobby along the shore (u) and its depth from the track bed's landward edge, with a gap kept clear of the bed. */
 lobby:{u0:-.8,u1:2.5,depth:1.75,gap:.2},
 /** Headroom kept between the top of the train (TRAIN_ENVELOPE) and the underside of the footbridge deck: a design margin. */
 headroom:.25,deck:.08,
 /** Wall height above a floor, and the rise of the curved roofs over the lobby and the bridge. */
 wall:.62,bridgeWall:.5,lobbyVault:.3,bridgeVault:.16,
 door:.56,stair:{foot:-.2,top:1.8,width:.6,steps:12},
 bridge:{u0:1.8,u1:2.45},lift:{u0:1.85,u1:2.4,depth:.72},
 exit:{top:1.8,bottom:.4,width:.5,steps:8},
 colors:{shell:'#e2dccd',rib:'#f4f2ec',accent:'#c9a35a',frame:'#2f3a3c',steel:'#8f9c9c',floor:'#d9d3c3',glass:'#a9cfd2',tread:'#bab7a8',tread2:'#aaa99e'},
} as const;

/** The six named stops of the gateway walk, for any route that needs to pass through it. */
export const GATEWAY_NODES=['station_plaza','gateway_entrance','gateway_concourse','protected_crossing','boardwalk_exit','waterfront_boardwalk'] as const;
export type GatewayNode=typeof GATEWAY_NODES[number];
/** A walkable stretch between two stops. `points` run from a to b; the route is walked in either direction. */
export interface GatewayEdge {id:'approach'|'entrance'|'stair'|'lift'|'bridge'|'exit';a:GatewayNode;b:GatewayNode;points:Point3[]}
/** A walkable volume: flat floor (y0 = y1), a stair rising along x from x0 to x1 (or x1 to x0 when `down`), or a lift shaft (any y between y0 and y1). */
export interface Walkable {name:string;x0:number;x1:number;z0:number;z1:number;y0:number;y1:number;kind:'floor'|'stair'|'lift';rises?:1|-1}

export interface GatewayPlan {
 dir:1|-1;crossingX:number;trackZ:number;
 /** Lobby footprint, the walk level on the bridge and the height of the deck's underside. */
 x0:number;x1:number;z0:number;z1:number;level:number;underside:number;
 /** Track corridor people must not enter below the bridge: |z - trackZ| < corridor. */
 corridor:number;
 bridge:{x0:number;x1:number;z0:number;z1:number};
 stair:{foot:number;top:number;z0:number;z1:number};
 lift:{x0:number;x1:number;z0:number;z1:number};
 exit:{top:number;bottom:number;z0:number;z1:number};
 /** The harbour boardwalk the exit lands on: deck height and its band across the shore. */
 boardwalk:{y:number;z0:number;z1:number};
 concourseZ:number;nodes:Record<GatewayNode,Point3>;edges:GatewayEdge[];walkable:Walkable[];
}

const lo=Math.min,hi=Math.max;

/**
 * The gateway beside the marina's centre line `m.x`, for a track along x at `trackZ` and a harbour boardwalk band
 * z0..z1 at height `deckY` on the sea side. `dir` is +1 when the marina is east of the station.
 */
export function planTransitGateway(trackZ:number,dir:1|-1,m:MarinaSite,board:{y:number;z0:number;z1:number}):GatewayPlan{
 const X=(u:number)=>m.x+dir*u,span=(a:number,b:number):[number,number]=>[lo(X(a),X(b)),hi(X(a),X(b))];
 const L=GATEWAY.lobby,bed=COMMUNITY.bedWidth/2;
 const corridor=hi(bed,TRAIN_ENVELOPE.halfWidth);
 const z1=trackZ-bed-L.gap,z0=z1-L.depth;
 const underside=TRAIN_ENVELOPE.top+GATEWAY.headroom,level=underside+GATEWAY.deck;
 const S=GATEWAY.stair,stairZ1=z1-.07,stairZ0=stairZ1-S.width,stairMid=(stairZ0+stairZ1)/2;
 const liftZ0=z0+.15,liftZ1=liftZ0+GATEWAY.lift.depth,concourseZ=(liftZ0+liftZ1)/2;
 const B=GATEWAY.bridge,bu=(B.u0+B.u1)/2,[bx0,bx1]=span(B.u0,B.u1),[lx0,lx1]=span(GATEWAY.lift.u0,GATEWAY.lift.u1);
 const E=GATEWAY.exit,exitZ1=board.z1-.05,exitZ0=exitZ1-E.width,exitMid=(exitZ0+exitZ1)/2,boardMid=(board.z0+board.z1)/2;
 const nodes:Record<GatewayNode,Point3>={
  station_plaza:[X(0),0,z0-.6],gateway_entrance:[X(0),0,z0],gateway_concourse:[X(0),0,concourseZ],
  protected_crossing:[X(bu),level,trackZ],boardwalk_exit:[X(E.bottom-.15),board.y,exitMid],waterfront_boardwalk:[X(E.bottom-.15),board.y,boardMid],
 };
 const edges:GatewayEdge[]=[
  {id:'approach',a:'station_plaza',b:'gateway_entrance',points:[nodes.station_plaza,nodes.gateway_entrance]},
  {id:'entrance',a:'gateway_entrance',b:'gateway_concourse',points:[nodes.gateway_entrance,nodes.gateway_concourse]},
  // Main way up: across the concourse, up the stair along the glass wall, onto the landing and out over the track.
  {id:'stair',a:'gateway_concourse',b:'protected_crossing',points:[nodes.gateway_concourse,[X(S.foot-.15),0,concourseZ],[X(S.foot-.15),0,stairMid],[X(S.foot),0,stairMid],[X(S.top),level,stairMid],[X(bu),level,stairMid],nodes.protected_crossing]},
  // Step-free way up: the glass lift at the far end of the concourse opens onto the same landing.
  {id:'lift',a:'gateway_concourse',b:'protected_crossing',points:[nodes.gateway_concourse,[X(bu),0,concourseZ],[X(bu),level,concourseZ],[X(bu),level,stairMid],nodes.protected_crossing]},
  {id:'bridge',a:'protected_crossing',b:'boardwalk_exit',points:[nodes.protected_crossing,[X(bu),level,exitMid],[X(E.top),level,exitMid],[X(E.bottom),board.y,exitMid],nodes.boardwalk_exit]},
  {id:'exit',a:'boardwalk_exit',b:'waterfront_boardwalk',points:[nodes.boardwalk_exit,nodes.waterfront_boardwalk]},
 ];
 const [ax0,ax1]=span(-.25,.25),[fx0,fx1]=span(L.u0+.05,L.u1-.05),[sx0,sx1]=span(S.foot,S.top),[ex0,ex1]=span(E.bottom,E.top);
 const walkable:Walkable[]=[
  {name:'plaza approach',x0:ax0,x1:ax1,z0:nodes.station_plaza[2]-.05,z1:z0+.05,y0:0,y1:0,kind:'floor'},
  {name:'lobby concourse',x0:fx0,x1:fx1,z0,z1:stairZ1,y0:0,y1:0,kind:'floor'},
  {name:'lobby stair',x0:sx0,x1:sx1,z0:stairZ0,z1:stairZ1,y0:0,y1:level,kind:'stair',rises:dir},
  {name:'lift',x0:lx0,x1:lx1,z0:liftZ0,z1:liftZ1,y0:0,y1:level,kind:'lift'},
  {name:'landing and footbridge',x0:bx0,x1:bx1,z0:liftZ1,z1:board.z1,y0:level,y1:level,kind:'floor'},
  {name:'boardwalk exit stair',x0:ex0,x1:ex1,z0:exitZ0,z1:exitZ1,y0:board.y,y1:level,kind:'stair',rises:dir},
 ];
 return {dir,crossingX:m.x,trackZ,x0:span(L.u0,L.u1)[0],x1:span(L.u0,L.u1)[1],z0,z1,level,underside,corridor,
  bridge:{x0:bx0,x1:bx1,z0:liftZ1,z1:board.z1},stair:{foot:X(S.foot),top:X(S.top),z0:stairZ0,z1:stairZ1},
  lift:{x0:lx0,x1:lx1,z0:liftZ0,z1:liftZ1},exit:{top:X(E.top),bottom:X(E.bottom),z0:exitZ0,z1:exitZ1},boardwalk:board,
  concourseZ,nodes,edges,walkable};
}

/**
 * The walk from one stop to another through the gateway, as one continuous line of points (no jumps between stops).
 * Edges named in `closed` are treated as blocked, so a closed stair reroutes by the lift. Undefined when no way remains.
 */
export function gatewayRoute(p:GatewayPlan,from:GatewayNode,to:GatewayNode,closed:ReadonlySet<GatewayEdge['id']>=new Set()):Point3[]|undefined{
 if(from===to)return [p.nodes[from]];
 const prev=new Map<GatewayNode,{edge:GatewayEdge;from:GatewayNode}>(),queue:GatewayNode[]=[from],seen=new Set([from]);
 while(queue.length){const n=queue.shift()!;if(n===to)break;
  for(const e of p.edges){if(closed.has(e.id))continue;const next=e.a===n?e.b:e.b===n?e.a:undefined;if(!next||seen.has(next))continue;seen.add(next);prev.set(next,{edge:e,from:n});queue.push(next);}}
 if(!seen.has(to))return;
 const legs:Point3[][]=[];for(let n=to;n!==from;){const step=prev.get(n)!;legs.unshift(step.edge.a===step.from?step.edge.points:[...step.edge.points].reverse());n=step.from;}
 return legs.reduce<Point3[]>((all,leg)=>[...all,...(all.length?leg.slice(1):leg)],[]);
}

/** Height of a walkable volume's surface at (x, z), or the lift's whole range; undefined outside it. */
function surface(w:Walkable,x:number,z:number):[number,number]|undefined{
 if(x<w.x0-1e-6||x>w.x1+1e-6||z<w.z0-1e-6||z>w.z1+1e-6)return;
 if(w.kind==='lift')return [w.y0,w.y1];
 if(w.kind==='floor')return [w.y0,w.y0];
 const t=(x-w.x0)/(w.x1-w.x0),k=w.rises===-1?1-t:t,y=w.y0+(w.y1-w.y0)*k;return [y,y];
}
const stands=(volumes:Walkable[],x:number,y:number,z:number,tolerance:number)=>volumes.some(w=>{const s=surface(w,x,z);return !!s&&y>=s[0]-tolerance&&y<=s[1]+tolerance;});

/** Points every `step` along a route, each offset sideways by `lane` (walkers keep to one side of the way). */
export function sampleRoute(points:Point3[],step=.04,lane=0):Point3[]{
 const out:Point3[]=[];
 for(let i=1;i<points.length;i++){const [ax,ay,az]=points[i-1],[bx,by,bz]=points[i],len=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.ceil(Math.hypot(len,by-ay)/step));
  const ox=len>1e-9?-(bz-az)/len*lane:0,oz=len>1e-9?(bx-ax)/len*lane:0;
  for(let k=i===1?0:1;k<=n;k++){const t=k/n;out.push([ax+(bx-ax)*t+ox,ay+(by-ay)*t,az+(bz-az)*t+oz]);}}
 return out;
}

export interface RouteProblem {at:Point3;reason:'off-walkway'|'rail-corridor'}
/**
 * Checks a route through the gateway: every sampled point (offset by `lane`) must stand on a walkable surface at its
 * height, with `inset` to spare from the walls and railings, and no point may be inside the track corridor unless it is
 * on the footbridge, whose deck underside clears the train's envelope. Extra volumes (the harbour boardwalk and stair)
 * can be passed in for routes that carry on beyond the gateway.
 */
export function validateRoute(p:GatewayPlan,points:Point3[],{lane=0,inset=.04,extra=[] as Walkable[]}={}):RouteProblem[]{
 const out:RouteProblem[]=[],volumes=[...p.walkable,...extra];
 for(const at of sampleRoute(points,.04,lane)){
  const [x,y,z]=at;
  if(Math.abs(z-p.trackZ)<p.corridor&&y-GATEWAY.deck<TRAIN_ENVELOPE.top+GATEWAY.headroom-1e-6){out.push({at,reason:'rail-corridor'});continue;}
  // On a surface at this height, and still on one a little way off to every side: walls and railings are the edges of the
  // walkable volumes, while two volumes that meet (a stair and its landing) leave no edge between them.
  const ok=stands(volumes,x,y,z,.015)&&[[inset,0],[-inset,0],[0,inset],[0,-inset]].every(([dx,dz])=>stands(volumes,x+dx,y,z+dz,.04));
  if(!ok)out.push({at,reason:'off-walkway'});
 }
 return out;
}

/** Simple boxes for the gateway, in world positions (bottom-anchored), split by material. `signs` carry their text. */
export interface GatewayParts {solid:Inst[];glass:Inst[];lights:Inst[];plants:Inst[];signs:{text:string;p:Point3;w:number;h:number;r:number}[]}

/** Rotation about x that lays a box's local z along (dz, dy), and about z that lays its local x along (dx, dy). */
const tiltX=(dz:number,dy:number)=>Math.atan2(-dy,dz),tiltZ=(dx:number,dy:number)=>Math.atan2(dy,dx);

export function gatewayParts(p:GatewayPlan,terrace:number):GatewayParts{
 const solid:Inst[]=[],glass:Inst[]=[],lights:Inst[]=[],plants:Inst[]=[],signs:GatewayParts['signs']=[],C=GATEWAY.colors,T=terrace;
 const box=(x0:number,x1:number,y0:number,y1:number,z0:number,z1:number,c:string,to=solid)=>to.push({p:[(x0+x1)/2,T+y0,(z0+z1)/2],s:[x1-x0,y1-y0,z1-z0],c});
 const {x0,x1,z0,z1,level:Lv,dir}=p,eave=GATEWAY.wall+Lv,X=(u:number)=>p.crossingX+dir*u,top0=()=>Lv+GATEWAY.bridgeWall+GATEWAY.bridgeVault;
 // Lobby: stone plinth and floor, a steel frame, glass on all four sides (the track-side wall looks out over the rails).
 box(x0-.05,x1+.05,-.02,.04,z0-.05,z1+.03,C.floor);
 const posts=Math.max(2,Math.round((x1-x0)/.55));
 for(let i=0;i<=posts;i++){const x=x0+(x1-x0)*i/posts;for(const z of [z0,z1])box(x-.03,x+.03,.04,eave,z-.03,z+.03,C.frame);}
 for(const x of [x0,x1])box(x-.03,x+.03,.04,eave,(z0+z1)/2-.03,(z0+z1)/2+.03,C.frame);
 const [d0,d1]=[lo(X(-GATEWAY.door/2),X(GATEWAY.door/2)),hi(X(-GATEWAY.door/2),X(GATEWAY.door/2))],doorTop=.55;
 // City face: glass either side of the doorway, a transom above it and a gold door frame.
 box(x0,d0,.04,eave,z0-.015,z0+.015,C.glass,glass);box(d1,x1,.04,eave,z0-.015,z0+.015,C.glass,glass);box(d0,d1,doorTop,eave,z0-.015,z0+.015,C.glass,glass);
 for(const x of [d0,d1])box(x-.03,x+.03,.04,doorTop,z0-.04,z0+.04,C.accent);box(d0-.03,d1+.03,doorTop,doorTop+.04,z0-.04,z0+.04,C.accent);
 // The track-side wall opens where the footbridge leaves the lobby.
 {const B=p.bridge;box(x0,B.x0,.04,eave,z1-.015,z1+.015,C.glass,glass);box(B.x1,x1,.04,eave,z1-.015,z1+.015,C.glass,glass);box(B.x0,B.x1,.04,Lv-GATEWAY.deck,z1-.015,z1+.015,C.glass,glass);box(B.x0,B.x1,top0(),eave,z1-.015,z1+.015,C.glass,glass);}
 for(const x of [x0,x1])box(x-.015,x+.015,.04,eave,z0,z1,C.glass,glass);
 // A transom bar ties the glass together at door height on the long faces.
 for(const z of [z0,z1])box(x0,x1,doorTop,doorTop+.025,z-.025,z+.025,C.frame);
 box(x0-.04,x1+.04,eave-.06,eave,z0-.05,z0+.02,C.frame);box(x0-.04,x1+.04,eave-.06,eave,z1-.02,z1+.05,C.frame);
 // Curved roof along the shore, built from slats like the station shell, with gold end ribs and pale inner ribs.
 const vault=(ax:number,bx:number,cz:number,across:number,up:number,base:number,slats:number,ribs:number[],axis:'x'|'z')=>{
  const max=70*Math.PI/180,step=2*max/(slats-1);
  const at=(t:number):[number,number]=>[cz+across*Math.sin(t),base+up*Math.cos(t)-up*Math.cos(max)];
  for(let i=0;i<slats;i++){const t=-max+i*step,[c,y]=at(t),[c1,y1]=at(t+step/2),[c0,y0]=at(t-step/2),width=Math.hypot(c1-c0,y1-y0)+.02;
   solid.push(axis==='x'?{p:[(ax+bx)/2,T+y,c],s:[bx-ax,.04,width],rx:tiltX(c1-c0,y1-y0),c:C.shell}:{p:[c,T+y,(ax+bx)/2],s:[width,.04,bx-ax],rz:tiltZ(c1-c0,y1-y0),c:C.shell});
   for(const [k,r] of ribs.entries()){const end=k===0||k===ribs.length-1;solid.push(axis==='x'?{p:[r,T+y+.03,c],s:[.07,.05,width+.02],rx:tiltX(c1-c0,y1-y0),c:end?C.accent:C.rib}:{p:[c,T+y+.03,r],s:[width+.02,.05,.07],rz:tiltZ(c1-c0,y1-y0),c:end?C.accent:C.rib});}
  }
 };
 vault(x0-.08,x1+.08,(z0+z1)/2,(z1-z0)/2+.1,GATEWAY.lobbyVault,eave,9,[x0-.04,(x0+x1)/2,x1+.04],'x');
 // Warm light strips under the roof, and a pair of wall lamps beside the door.
 for(const z of [z0+.45,z1-.45])box(x0+.2,x1-.2,eave-.04,eave-.02,z-.03,z+.03,'#ffe2a6',lights);
 for(const x of [d0-.12,d1+.12])lights.push({p:[x,T+doorTop-.08,z0-.06],s:[.035,.035,.035]});
 // Stair up along the glass wall: twelve treads, each a solid block from the floor, and a handrail on the open side.
 const S=p.stair,run=Math.abs(S.top-S.foot),n=GATEWAY.stair.steps,tread=run/n;
 for(let i=0;i<n;i++){const top=Lv*(i+1)/n,x=S.foot+dir*(i+.5)*tread;box(x-tread/2-.006,x+tread/2+.006,.04,top,S.z0,S.z1,i%2?C.tread2:C.tread);
  box(x-.012,x+.012,top,top+.3,S.z0+.02,S.z0+.045,C.frame);box(x-tread/2-.01,x+tread/2+.01,top+.28,top+.31,S.z0+.015,S.z0+.05,C.steel);}
 // Landing at the top of the stair and the footbridge deck, one slab from the lift door to the harbour boardwalk.
 const B=p.bridge;box(B.x0,B.x1,Lv-GATEWAY.deck,Lv,B.z0,B.z1,'#cfc9ba');
 // Steel edge beams stand up from the deck rather than hang under it, so nothing dips into the headroom over the train.
 for(const x of [B.x0,B.x1])box(x-.02,x+.02,Lv-GATEWAY.deck,Lv+.04,z1,B.z1,C.frame);
 // Columns hold the landing inside the lobby; on the harbour side, short steel legs stand on the boardwalk past the track corridor.
 const legZ=p.trackZ+p.corridor+.08;
 for(const x of [B.x0+.03,B.x1-.03]){box(x-.03,x+.03,.04,Lv-GATEWAY.deck,B.z0+.03,B.z0+.09,C.frame);box(x-.03,x+.03,.04,Lv-GATEWAY.deck,z1-.12,z1-.06,C.frame);
  box(x-.035,x+.035,p.boardwalk.y,Lv-GATEWAY.deck,legZ,legZ+.07,C.frame);box(x-.035,x+.035,p.boardwalk.y,Lv-GATEWAY.deck,B.z1-.09,B.z1-.02,C.frame);}
 // Railing round the landing's open edges inside the lobby (the lift door and the stair head stay open).
 box(B.x0,lo(p.lift.x0,p.lift.x1)-.02,Lv,Lv+.3,B.z0,B.z0+.03,C.steel);
 // The enclosed bridge: glass sides on a steel frame from the lobby to the boardwalk, a curved roof, ceiling light and a soft floor guide line.
 const top=Lv+GATEWAY.bridgeWall;
 for(const x of [B.x0+.015,B.x1-.015])box(x-.015,x+.015,Lv,top,z1,B.z1,C.glass,glass);
 box(B.x0,B.x1,Lv,top,B.z1-.015,B.z1+.015,C.glass,glass);
 const mull=Math.max(2,Math.round((B.z1-z1)/.45));
 for(let i=0;i<=mull;i++){const z=z1+(B.z1-z1)*i/mull;for(const x of [B.x0,B.x1])box(x-.025,x+.025,Lv,top,z-.025,z+.025,C.frame);}
 for(const x of [B.x0,B.x1])box(x-.03,x+.03,top-.04,top,z1,B.z1,C.frame);
 vault(z1,B.z1,(B.x0+B.x1)/2,(B.x1-B.x0)/2+.05,GATEWAY.bridgeVault,top,7,[z1,(z1+B.z1)/2,B.z1],'z');
 box((B.x0+B.x1)/2-.03,(B.x0+B.x1)/2+.03,top-.03,top-.01,z1+.1,B.z1-.1,'#ffe2a6',lights);
 for(const x of [B.x0+.05,B.x1-.05])box(x-.012,x+.012,Lv+.002,Lv+.012,z1,B.z1-.05,'#ffd38a',lights);
 // Glass lift: a shaft from the concourse floor to above the landing, steel corner posts and the car waiting at the bottom.
 const F=p.lift;for(const x of [F.x0,F.x1])box(x-.012,x+.012,.04,top,F.z0,F.z1,C.glass,glass);box(F.x0,F.x1,.04,top,F.z0-.012,F.z0+.012,C.glass,glass);
 for(const x of [F.x0,F.x1])for(const z of [F.z0,F.z1])box(x-.025,x+.025,.04,top+.04,z-.025,z+.025,C.frame);
 box(F.x0+.04,F.x1-.04,.04,.42,F.z0+.05,F.z1-.06,'#cfd6d4');box(F.x0,F.x1,top,top+.05,F.z0,F.z1,C.frame);
 // Covered exit stair down to the boardwalk: eight treads, handrails both sides, a light canopy and a gold portal at the foot.
 const E=p.exit,erun=Math.abs(E.top-E.bottom),en=GATEWAY.exit.steps,et=erun/en,by=p.boardwalk.y,rise=Lv-by;
 for(let i=0;i<en;i++){const h=by+rise*(i+1)/en,x=E.bottom+dir*(i+.5)*et;box(x-et/2-.006,x+et/2+.006,by,h,E.z0,E.z1,i%2?C.tread2:C.tread);
  for(const z of [E.z0+.03,E.z1-.03]){box(x-.012,x+.012,h,h+.3,z-.012,z+.012,C.frame);box(x-et/2-.01,x+et/2+.01,h+.28,h+.31,z-.017,z+.017,C.steel);}}
 const [c0,c1]=[lo(E.bottom,E.top),hi(E.bottom,E.top)];
 box(c0-.05,c1,top-.03,top,E.z0-.06,E.z1+.06,C.shell);
 for(const z of [E.z0-.03,E.z1+.03])box(E.bottom-.03,E.bottom+.03,by,top-.03,z-.03,z+.03,C.accent);
 // Planters and a paved apron either side of the city entrance.
 box(lo(X(-.6),X(.6)),hi(X(-.6),X(.6)),-.02,.035,z0-.5,z0,'#e3dfd2');
 for(const u of [-.62,.62]){const x=X(u);box(x-.14,x+.14,0,.16,z0-.38,z0-.1,'#bdb59e');plants.push({p:[x,T+.2,z0-.24],s:[.13,.1,.13],c:'#6f9a5c'});}
 // Signs: the gateway's name over the city door, and the way to the boardwalk at the exit stair.
 signs.push({text:'TRANSIT GATEWAY',p:[X(.85),T+eave-.2,z0-.045],w:1.3,h:.16,r:Math.PI});
 signs.push({text:'BOARDWALK',p:[E.bottom-dir*.035,T+top-.17,(E.z0+E.z1)/2],w:.55,h:.12,r:dir>0?-Math.PI/2:Math.PI/2});
 signs.push({text:'TO BOARDWALK',p:[(B.x0+B.x1)/2,T+top-.14,z1+.03],w:.55,h:.09,r:0});
 return {solid,glass,lights,plants,signs};
}
