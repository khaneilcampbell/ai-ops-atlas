import {it,expect} from 'vitest';
import {catalog} from '../../catalog';import {layoutMap,type GroupBy} from '../mapLayout';import {buildScene} from './scene';
import {planStreetLights,lightingObstacles,STREET_LIGHT} from './streetLighting';
for(const group of ['none','district','status','tag'] as GroupBy[])it(`lights streets without blocking buildings in ${group}`,()=>{
 const s=buildScene(layoutMap(catalog,[],group)),lights=planStreetLights(s),boxes=lightingObstacles(s);
 expect(s.hills).toBeUndefined();
 expect(lights.length).toBeGreaterThan(40);expect(lights.length).toBeLessThanOrEqual(STREET_LIGHT.maxFixtures);expect(lights.some(p=>p.highway)).toBe(false);
 expect(lights.some(p=>p.x>s.financial!.x&&p.x<s.financial!.x+s.financial!.w&&p.z>s.financial!.z&&p.z<s.financial!.z+s.financial!.d),'Financial District has street lighting').toBe(true);
 for(const [i,p]of lights.entries()){expect(Number.isFinite(p.yaw)).toBe(true);expect(boxes.some(b=>Math.abs(p.x-b.x)<b.w/2+.12&&Math.abs(p.z-b.z)<b.d/2+.12)).toBe(false);for(const q of lights.slice(i+1))expect(Math.hypot(p.x-q.x,p.z-q.z)).toBeGreaterThanOrEqual(STREET_LIGHT.minSeparation);}
});
