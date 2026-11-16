import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene,TERRACE_H} from './scene';
import {marinaSite,marinaFootprint} from './marinaPlan';
import {planHarbourPlatform,harbourAccess,harbourAlight,harbourParts,HARBOUR} from './harbourPlatform';
import {COMMUNITY as C} from './hillsCommunityPlan';
import {travelPlan} from './travelLoops';

describe('Events Arena harbour platform joins the station and the yacht dock',()=>{
 const s=buildScene(layoutMap(catalog,[],'district')),loop=s.communityRail!.loop!,m=marinaSite(s,TERRACE_H);
 const h=planHarbourPlatform(loop,m)!,stop=loop.stops.find(x=>x.id===HARBOUR.stationId)!;

 it('puts a seaward platform face beside the train, across the track from the landward one',()=>{
  expect(h).toBeDefined();
  expect(h.platform[1]-h.platform[0]).toBeCloseTo(C.platformLength,5);
  expect((h.platform[0]+h.platform[1])/2).toBeCloseTo(stop.point[0],5);
  // Mirror of the landward platform: same distance from the track centre, same height, on the sea side.
  expect(h.z0-h.trackZ).toBeCloseTo(C.platformOffset-C.platformWidth/2,5);
  expect(h.y).toBe(C.platformRise);
  expect(h.z1).toBeGreaterThan(m.shoreZ);
 });

 it('runs the boardwalk on to the gateway footbridge and lands the stair on the unchanged pier',()=>{
  expect(h.deck[0]).toBeLessThanOrEqual(h.platform[0]);
  expect(h.deck[1]).toBeGreaterThan(m.x+.31);
  // The stair hangs off the boardwalk's sea edge, parallel to the shore, never over the track bed.
  expect(h.stair.zs0).toBeGreaterThan(h.z1);
  expect(Math.abs(h.stair.top-h.stair.bottom)).toBe(HARBOUR.stairRun);
  const slope=Math.atan2(h.y-h.dockY,HARBOUR.stairRun)*180/Math.PI;expect(slope).toBeLessThan(45);
  expect(h.landing.z1).toBeGreaterThan(m.pierZ);expect(h.landing.x0).toBeLessThan(m.x);expect(h.landing.x1).toBeGreaterThan(m.x);
  expect(m.pierZ-m.shoreZ).toBeCloseTo(1.8,5);
 });

 it('keeps every part off the ballast bed and inside the harbour, with twelve treads',()=>{
  const {deck,rails}=harbourParts(h);
  for(const b of [...deck,...rails]){
   const z0=b.p[2]-b.s[2]/2;
   // The track bed is .98 wide; with the level crossing gone nothing of the harbour platform reaches back over it.
   expect(z0).toBeGreaterThanOrEqual(h.trackZ+.3);
  }
  const treads=deck.filter(b=>Math.abs(b.p[2]-(h.stair.zs0+h.stair.zs1)/2)<1e-6&&Math.abs(b.s[2]-HARBOUR.stairWidth)<1e-6&&b.p[0]>Math.min(h.stair.top,h.stair.bottom)&&b.p[0]<Math.max(h.stair.top,h.stair.bottom));
  expect(treads).toHaveLength(HARBOUR.steps);
  const f=marinaFootprint(m);expect(f).toEqual({x:m.x-2.5,z:m.pierZ-2.6,w:5,d:4.2});
 });

 it('walks people from the city and off the train down to the pier root',()=>{
  const a=harbourAccess(h,m),t=harbourAlight(h,m,stop),end=a[a.length-1];
  expect(end).toEqual([m.x,h.dockY,m.pierZ]);expect(t[t.length-1]).toEqual(end);
  // From the forecourt walk through the Transit Gateway (transitGateway.test.ts covers the gateway itself).
  expect(a[0]).toEqual(h.gateway.nodes.station_plaza);expect(a).toContainEqual(h.gateway.nodes.protected_crossing);
  // Off the seaward doors: start beside the train at platform height on the sea side of the track.
  expect(t[0][1]).toBe(h.y);expect(t[0][2]).toBeGreaterThan(h.trackZ);expect(t[1][2]).toBeGreaterThan(h.z0);
  // Yacht guests from the train take the boardwalk, not the forecourt and level crossing.
  const travel=travelPlan(s)!,guest=travel.travellers.find(x=>x.journey==='train-yacht')!;
  const pts=guest.segs.flatMap(seg=>seg.route.points);
  expect(pts.some(p=>Math.abs(p[2]-(h.z0+h.z1)/2)<.01&&p[1]===h.y)).toBe(true);
  expect(pts.some(p=>p[0]===m.x&&p[2]===h.trackZ)).toBe(false);
 });
});
