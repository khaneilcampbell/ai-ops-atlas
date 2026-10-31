import {it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {planHighwayTraffic,HIGHWAY_TRAFFIC_COUNT} from './vehicles';
import {distanceToRoad} from './highway';
import {pathClear} from './roads';
for(const group of ['none','district','status','tag'] as GroupBy[])it(`connects district ramps to the perimeter without building collisions: ${group}`,()=>{
 const scene=buildScene(layoutMap(catalog,[],group)),f=scene.freight!;
 expect(f.access.map(a=>a.id)).toEqual(['skyline-airport','profile-stadium','financial-district']);
 const boxes=[...scene.towers,...scene.kiosks,...scene.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
 for(const a of f.access){expect(a.collector[0]).toEqual(a.junction);
  for(const ramp of a.ramps){expect(ramp[0]).toEqual(a.collector.at(-1));expect(distanceToRoad(ramp.at(-1)!,f.highway)).toBeLessThan(.001);expect(pathClear(ramp,boxes,.7)).toBe(true);}
  expect(pathClear(a.collector,boxes,.7)).toBe(true);
 }
});
it('uses opposing highway lanes and continuous closed traffic routes',()=>{
 const s=buildScene(layoutMap(catalog)),plans=planHighwayTraffic(s);
 expect(plans).toHaveLength(HIGHWAY_TRAFFIC_COUNT);
 for(const v of plans){expect(v.legs.at(-1)!.b).toEqual(v.legs[0].a);
  for(const l of v.legs){expect(l.dur).toBeGreaterThan(0);expect(distanceToRoad(l.a,s.freight!.highway)).toBeLessThan(.5);}
 }
 expect(plans[0].legs[0].b[0]-plans[0].legs[0].a[0]).not.toBe(plans[1].legs[0].b[0]-plans[1].legs[0].a[0]);
});
