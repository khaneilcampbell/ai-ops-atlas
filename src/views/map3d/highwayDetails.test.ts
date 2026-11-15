import {expect,it} from 'vitest';
import {HIGHWAY} from './highway';
import {TRANSPORT} from './transportScale';
import {collectorProfile} from './highwayAccess';
import {highwayLightPositions,profileWidthAt,interchangeArrows} from './highwayDetails';
import {buildScene} from './scene';
import {layoutMap,type GroupBy} from '../mapLayout';
import {catalog} from '../../catalog';
for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`keeps lamps outside junctions and arrows opposed in ${grouping} grouping`,()=>{
 // No highway, ramps or freight road are built (Khaneil, 2026-11-07): no highway lamps or arrows either.
 expect(buildScene(layoutMap(catalog,[],grouping)).freight).toBeUndefined();
 expect(highwayLightPositions([],[])).toEqual([]);expect(interchangeArrows([])).toEqual([]);
});
it('sizes collector structures to the rendered taper rather than full highway width',()=>{
 const profile=collectorProfile([[0,0],[0,12]]);
 expect(profileWidthAt(profile,[0,0])).toBeCloseTo(TRANSPORT.cityWidth);
 expect(profileWidthAt(profile,[0,1.5])).toBeCloseTo((TRANSPORT.cityWidth+HIGHWAY.width)/2);
 expect(profileWidthAt(profile,[0,12])).toBeCloseTo(HIGHWAY.width);
});
