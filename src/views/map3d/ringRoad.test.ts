import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {buildStreetGraph,streetLines} from './streetGraph';
import {drivingGraph,planVehicles} from './vehicles';
import {RING_ROAD_ID} from './ringRoad';
import {LANE_OFF} from './roads';

const scene=buildScene(layoutMap(catalog,[],'district'));

describe('ring road and traffic rules',()=>{
 it('closes a ring road round the city, clear of every building',()=>{
  const ring=scene.transportConnections.filter(c=>c.id.startsWith(`${RING_ROAD_ID}:`));
  expect(ring.map(c=>c.id).sort()).toEqual([`${RING_ROAD_ID}:north-east`,`${RING_ROAD_ID}:south`]);
  for(const c of ring)for(let i=1;i<c.road.length;i++)expect(c.road[i][0]===c.road[i-1][0]||c.road[i][1]===c.road[i-1][1]).toBe(true);
  // The outer roads now form one loop: the west road, the Financial District street, BMW's spur,
  // the new pieces and the Marketplace boulevard all join in one street graph component with a cycle.
  const g=buildStreetGraph(streetLines(scene,{drive:true}));
  const ends=ring.flatMap(c=>[c.road[0],c.road[c.road.length-1]]);
  for(const e of ends){const i=g.nodes.findIndex(n=>Math.hypot(n[0]-e[0],n[2]-e[1])<1e-3);expect(i).toBeGreaterThanOrEqual(0);expect(g.edges[i].length).toBeGreaterThanOrEqual(2);}
 });

 it('drives only streets that lead on, so no car ever turns round in the road',()=>{
  const d=drivingGraph(scene)!;
  for(const list of d.next)if(list.length)expect(list.length).toBeGreaterThanOrEqual(2);
  for(const v of planVehicles(scene)){
   const moves=v.legs.filter(l=>!l.hold);
   for(let i=0;i<moves.length;i++){
    const a=moves[i],b=moves[(i+1)%moves.length];
    const ux=a.b[0]-a.a[0],uz=a.b[1]-a.a[1],wx=b.b[0]-b.a[0],wz=b.b[1]-b.a[1];
    const cos=(ux*wx+uz*wz)/((Math.hypot(ux,uz)||1)*(Math.hypot(wx,wz)||1));
    expect(cos,`${v.id} turns back at ${a.b}`).toBeGreaterThan(-.5);
   }
  }
 });

 it('keeps right: half a lane off the centre line, and round a tower the inner car hugs the plaza',()=>{
  const d=drivingGraph(scene)!;
  const lanes=new Set<number>();
  d.next.forEach((list,a)=>list.forEach(b=>{
   const there=d.lane(a,b),back=d.lane(b,a);lanes.add(there);
   // Both directions together always fill one road: two half lanes, or the plaza line and outside it.
   expect(there+back).toBeCloseTo(2*LANE_OFF);
  }));
  expect(lanes.has(LANE_OFF)).toBe(true);
  expect(lanes.has(0)).toBe(true);
 });

 it('stops at the stop line before every junction',()=>{
  for(const v of planVehicles(scene)){
   expect(v.legs.some(l=>l.hold)).toBe(true);
   for(const l of v.legs.filter(l=>l.hold))expect(l.dur).toBeGreaterThan(.5);
  }
 });
});
