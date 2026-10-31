import {expect,it} from 'vitest';
import {HIGHWAY} from './highway';
import {TRANSPORT} from './transportScale';
import {collectorProfile} from './highwayAccess';
import {highwayLightPositions,profileWidthAt,interchangeArrows} from './highwayDetails';
import {buildScene} from './scene';
import {layoutMap,type GroupBy} from '../mapLayout';
import {catalog} from '../../catalog';
for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`keeps lamps outside junctions and arrows opposed in ${grouping} grouping`,()=>{
 const f=buildScene(layoutMap(catalog,[],grouping)).freight!;
 const poles=highwayLightPositions(f.highway,f.exits);expect(poles.length).toBeGreaterThan(0);
 for(const p of poles)for(const q of f.exits)expect(Math.hypot(p[0]-q[0],p[1]-q[1])).toBeGreaterThanOrEqual(HIGHWAY.junctionRadius+.05);
 for(const access of f.access){
  const arrows=interchangeArrows([access]);expect(arrows).toHaveLength(2);
  arrows.forEach((arrow,i)=>{const ramp=access.ramps[i],mouth=ramp.at(-1)!,start=ramp[0],dot=(arrow.b[0]-arrow.a[0])*(mouth[0]-start[0])+(arrow.b[1]-arrow.a[1])*(mouth[1]-start[1]);expect(i===0?dot<0:dot>0).toBe(true);});
 }
});
it('sizes collector structures to the rendered taper rather than full highway width',()=>{
 const profile=collectorProfile([[0,0],[0,12]]);
 expect(profileWidthAt(profile,[0,0])).toBeCloseTo(TRANSPORT.cityWidth);
 expect(profileWidthAt(profile,[0,1.5])).toBeCloseTo((TRANSPORT.cityWidth+HIGHWAY.width)/2);
 expect(profileWidthAt(profile,[0,12])).toBeCloseTo(HIGHWAY.width);
});
