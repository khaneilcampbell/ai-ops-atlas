import {expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {planHighwayTraffic,vehicleAt,HIGHWAY_TRAFFIC_COUNT,HIGHWAY_TRAFFIC_SPEED} from './vehicles';
it('adds sixteen highway vehicles, cruising in both directions with clear following gaps',()=>{
 const plans=planHighwayTraffic(buildScene(layoutMap(catalog,[],'district')));
 expect(plans).toHaveLength(HIGHWAY_TRAFFIC_COUNT);expect(new Set(plans.map(p=>p.id)).size).toBe(plans.length);
 expect(new Set(plans.map(p=>p.kind)).size).toBeGreaterThanOrEqual(7);
 for(const p of plans)for(const l of p.legs)expect(Math.hypot(l.b[0]-l.a[0],l.b[1]-l.a[1])/l.dur).toBeCloseTo(HIGHWAY_TRAFFIC_SPEED);
 for(let t=0;t<120;t+=2)for(const direction of [0,1]){
  const poses=plans.filter((_,i)=>i%2===direction).map(p=>vehicleAt(p,t));
  for(let i=0;i<poses.length;i++)for(const b of poses.slice(i+1))expect(Math.hypot(poses[i].x-b.x,poses[i].z-b.z)).toBeGreaterThan(4);
 }
});
it('does not invent highway traffic without a highway',()=>expect(planHighwayTraffic({freight:undefined})).toEqual([]));
