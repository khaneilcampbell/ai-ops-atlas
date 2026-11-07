import {it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {planHighwayTraffic,planVehicles,vehicleAt,MAX_VEHICLES} from './vehicles';
import {pathClear} from './roads';
for(const group of ['none','district','status','tag'] as GroupBy[])it(`removes ramps and preserves connected local traffic: ${group}`,()=>{
 const scene=buildScene(layoutMap(catalog,[],group)),f=scene.freight!;
 expect(f.highway).toEqual([]);expect(f.access).toEqual([]);expect(f.exits).toEqual([]);expect(planHighwayTraffic(scene)).toEqual([]);
 const boxes=[...scene.towers,...scene.kiosks,...scene.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
 expect(pathClear(f.route,boxes,.4)).toBe(true);expect(f.cityAccess.length).toBeGreaterThan(1);
 const plans=planVehicles(scene);expect(plans).toHaveLength(MAX_VEHICLES);
 for(const v of plans){expect(v.legs[v.legs.length-1].b).toEqual(v.legs[0].a);for(const l of v.legs)expect(l.dur).toBeGreaterThan(0);expect(Number.isFinite(vehicleAt(v,30).x)).toBe(true);}
});
