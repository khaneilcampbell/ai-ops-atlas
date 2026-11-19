import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene,TERRACE_H} from './scene';
import {marinaSite} from './marinaPlan';
import {yachtBerth,yachtFootprint} from './yachtPlan';
import {planHarbourPlatform,harbourAccess,harbourWalkable} from './harbourPlatform';
import {COMMUNITY as C,TRAIN_ENVELOPE,type Point3} from './hillsCommunityPlan';
import {loopPoint} from './perimeterRailPlan';
import {railCrossings} from './railCrossing';
import {travelPlan} from './travelLoops';
import {GATEWAY,GATEWAY_NODES,gatewayRoute,gatewayParts,sampleRoute,validateRoute} from './transitGateway';
import {BULLET_BODY,TRAIN_DOOR,TRAIN_NOSE,TRAIN_ROOF} from './HillsCommunity';

describe('Transit Gateway takes people over the track between Events Arena Station and the boardwalk',()=>{
 const s=buildScene(layoutMap(catalog,[],'district')),loop=s.communityRail!.loop!,m=marinaSite(s,TERRACE_H);
 const h=planHarbourPlatform(loop,m)!,p=h.gateway,extra=harbourWalkable(h,m),LANES=[-.12,0,.12];

 it('sizes the train envelope from the real carriage parts', ()=>{
  // Boxes are bottom-anchored (top = p.y + s.y); balls are centred with radius s.
  const floor=C.railRise+.1;
  const tops=[...BULLET_BODY('#c9a35a').map(b=>b.p[1]+b.s[1]),TRAIN_ROOF.p[1]+TRAIN_ROOF.s[1],...TRAIN_NOSE(1).map(b=>b.p[1]+b.s[1]),TRAIN_DOOR.y+TRAIN_DOOR.leaf.p[1]+TRAIN_DOOR.leaf.s[1]];
  expect(floor+Math.max(...tops)).toBeCloseTo(TRAIN_ENVELOPE.top,6);
  // Widest: a door leaf swung a quarter turn out from its hinge.
  const widths=[...BULLET_BODY('#c9a35a').map(b=>b.s[0]/2),TRAIN_ROOF.s[0],...TRAIN_NOSE(1).map(b=>b.s[0]),TRAIN_DOOR.x+TRAIN_DOOR.leaf.p[2]+TRAIN_DOOR.leaf.s[2]/2+TRAIN_DOOR.leaf.s[0]/2];
  expect(Math.max(...widths)).toBeLessThanOrEqual(TRAIN_ENVELOPE.halfWidth);
 });

 it('stands the lobby beside the track and lifts the footbridge clear of the train', ()=>{
  expect(p).toBeDefined();
  expect(p.corridor).toBe(Math.max(C.bedWidth/2,TRAIN_ENVELOPE.halfWidth));
  expect(p.z1).toBeLessThanOrEqual(p.trackZ-C.bedWidth/2-GATEWAY.lobby.gap+1e-9);
  expect(p.underside).toBeGreaterThanOrEqual(TRAIN_ENVELOPE.top+GATEWAY.headroom-1e-9);
  // The bridge spans the whole corridor and lands on the harbour boardwalk.
  expect(p.bridge.z0).toBeLessThan(p.trackZ-p.corridor);expect(p.bridge.z1).toBe(h.z1);
  // Nothing of the gateway stands in the train's corridor below the deck's underside.
  const parts=gatewayParts(p,TERRACE_H);
  for(const b of [...parts.solid,...parts.glass,...parts.lights,...parts.plants]){
   const half=Math.abs(b.rz??0)>1e-6||Math.abs(b.rx??0)>1e-6?Math.max(...b.s)/2:b.s[2]/2;
   if(Math.abs(b.p[2]-p.trackZ)<p.corridor+half)expect(b.p[1]-TERRACE_H).toBeGreaterThanOrEqual(p.underside-1e-6);
  }
 });

 it('fits on open land beside the forecourt walk, clear of streets, planting and the yacht', ()=>{
  const inside=(x:number,z:number,pad=.1)=>x>p.x0-pad&&x<p.x1+pad&&z>p.z0-pad&&z<p.z1+pad;
  expect(s.land.some(r=>p.x0>=r.x&&p.x1<=r.x+r.w&&p.z0>=r.z&&p.z1<=r.z+r.d)).toBe(true);
  for(const items of [s.trees,s.bushes,s.rocks,s.bollards])expect(items.filter(t=>inside(t.x,t.z))).toEqual([]);
  for(const c of s.transportConnections??[])for(const q of c.road)expect(inside(q[0],q[1],1)).toBe(false);
  const y=yachtFootprint(yachtBerth(m)),b=p.bridge;
  expect(b.x1<=y.x||b.x0>=y.x+y.w||b.z1<=y.z||b.z0>=y.z+y.d).toBe(true);
  // The forecourt walk ends at the gateway door, so no walk crosses the track at rail level any more.
  const walks=s.walks.map(w=>[[w.x0,w.z0],[w.x1,w.z1]] as [[number,number],[number,number]]);
  expect(railCrossings(loop.route,walks).filter(c=>c.kind==='walk')).toEqual([]);
  expect(walks.some(([a,b])=>Math.abs(a[0]-m.x)<1e-6&&Math.abs(b[0]-m.x)<1e-6&&Math.abs(Math.max(a[1],b[1])-p.z0)<1e-6)).toBe(true);
 });

 it('walks plaza → entrance → concourse → crossing → exit → boardwalk on the walkways, by stair or lift, in every lane', ()=>{
  const stair=gatewayRoute(p,'station_plaza','waterfront_boardwalk')!,lift=gatewayRoute(p,'station_plaza','waterfront_boardwalk',new Set(['stair']))!;
  for(const route of [stair,lift]){
   let at=0;for(const n of GATEWAY_NODES){const i=route.findIndex((q,k)=>k>=at&&q.every((v,j)=>v===p.nodes[n][j]));expect(i,n).toBeGreaterThanOrEqual(at);at=i;}
   for(const lane of LANES)expect(validateRoute(p,route,{lane,extra})).toEqual([]);
   // The way back is the same line reversed.
   expect(gatewayRoute(p,'waterfront_boardwalk','station_plaza',route===lift?new Set(['stair']):undefined)).toEqual([...route].reverse());
  }
  // The lift route really rides the lift: one vertical stretch from the concourse floor to the bridge level.
  expect(lift.some((q,i)=>i>0&&q[0]===lift[i-1][0]&&q[2]===lift[i-1][2]&&q[1]===p.level&&lift[i-1][1]===0)).toBe(true);
  expect(stair.some((q,i)=>i>0&&q[0]===stair[i-1][0]&&q[2]===stair[i-1][2]&&q[1]!==stair[i-1][1])).toBe(false);
  // With both ways up closed there is no route, rather than a shortcut.
  expect(gatewayRoute(p,'station_plaza','waterfront_boardwalk',new Set(['stair','lift']))).toBeUndefined();
  // Every pair of stops is connected.
  for(const a of GATEWAY_NODES)for(const b of GATEWAY_NODES)expect(gatewayRoute(p,a,b),`${a}->${b}`).toBeDefined();
 });

 it('validates the whole dock walk, and catches routes that cut across the rails or through a wall', ()=>{
  for(const closed of [undefined,new Set(['stair'] as const)])for(const lane of LANES)expect(validateRoute(p,harbourAccess(h,m,closed),{lane,extra})).toEqual([]);
  // The old at-grade line straight over the track is refused.
  const level:Point3[]=[p.nodes.station_plaza,[m.x,0,p.trackZ],[m.x,h.y,(h.z0+h.z1)/2]];
  expect(validateRoute(p,level,{extra}).some(q=>q.reason==='rail-corridor')).toBe(true);
  // So is walking out through the lobby's side glass.
  const wall:Point3[]=[p.nodes.gateway_concourse,[p.x0-.3,0,p.nodes.gateway_concourse[2]]];
  expect(validateRoute(p,wall,{extra}).some(q=>q.reason==='off-walkway')).toBe(true);
 });

 it('never puts a walker inside the moving train anywhere on its loop', ()=>{
  // Every place the train can stand on the loop (a superset of where it is at any moment), against every walker point.
  const points=[...LANES.flatMap(lane=>sampleRoute(harbourAccess(h,m),.05,lane)),...LANES.flatMap(lane=>sampleRoute(harbourAccess(h,m,new Set(['stair'])),.05,lane))].filter(q=>Math.abs(q[2]-p.trackZ)<3&&Math.abs(q[0]-m.x)<6);
  const person=.32,halfLength=.51+.8;let checked=0,closest=Infinity;
  for(let d=0;d<loop.length;d+=.1)for(const k of [-1,0,1]){
   const q=loopPoint(loop,d+k*C.carriageSpacing);if(Math.hypot(q.x-m.x,q.z-p.trackZ)>8)continue;
   const sin=Math.sin(q.yaw),cos=Math.cos(q.yaw);
   for(const [x,y,z] of points){const dx=x-q.x,dz=z-q.z,along=dx*sin+dz*cos,across=dx*cos-dz*sin;checked++;
    if(Math.abs(along)<=halfLength&&Math.abs(across)<=TRAIN_ENVELOPE.halfWidth){closest=Math.min(closest,y-TRAIN_ENVELOPE.top);expect(y+person<C.railRise||y>TRAIN_ENVELOPE.top).toBe(true);}}
  }
  expect(checked).toBeGreaterThan(10000);
  // Walkers do pass over the train, on the bridge, with the full headroom and deck between.
  expect(closest).toBeCloseTo(GATEWAY.headroom+GATEWAY.deck,6);
 });

 it('sends yacht guests from the train hub through the gateway', ()=>{
  const travel=travelPlan(s)!,walkers=travel.travellers.filter(t=>t.segs.some(seg=>seg.route.points.some(q=>q[0]===p.nodes.protected_crossing[0]&&q[2]===p.nodes.protected_crossing[2])));
  expect(walkers.length).toBeGreaterThan(0);
  for(const t of travel.travellers)for(const seg of t.segs)expect(seg.route.points.some(q=>Math.abs(q[0]-m.x)<.31&&Math.abs(q[2]-p.trackZ)<p.corridor&&q[1]<p.level-1e-6),t.journey).toBe(false);
 });
});
