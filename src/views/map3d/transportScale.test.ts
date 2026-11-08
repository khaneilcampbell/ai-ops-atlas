import {it,expect} from 'vitest';
import {vehicleBounds} from './vehicleModels';
import {TRANSPORT as T} from './transportScale';
import {collectorProfile} from './highwayAccess';
import type {VehicleKind} from './vehicles';
it('fits opposing vehicles on city streets, bridges and highway lanes with clearance',()=>{
 for(const kind of ['bmw','gwagon','pickup','bus','semi','taxi'] as VehicleKind[]){
  const b=vehicleBounds(kind);
  expect(T.cityLaneOffset+b.halfWidth+.02).toBeLessThan(T.cityWidth/2);
  expect(T.cityLaneOffset+b.halfWidth+.02).toBeLessThan(T.bridgeWidth/2);
  expect(T.highwayLaneOffset+b.halfWidth+.06).toBeLessThan(T.highwayWidth/2);
 }
 expect(T.highwayWidth/T.cityWidth).toBeLessThan(2);
});
it('fits parked cars inside display bays using fleet geometry',()=>{
 for(const kind of ['bmw','gwagon'] as const){const b=vehicleBounds(kind);expect(b.front-b.rear+.1).toBeLessThan(T.displayBayLength);expect(b.halfWidth*2+.1).toBeLessThan(T.displayBayWidth);}
});
it('tapers local collectors from city width to highway width continuously',()=>{
 const p=collectorProfile([[0,0],[0,8]]);expect(p.widths[0]).toBe(T.cityWidth);expect(p.widths.at(-1)).toBe(T.highwayWidth);
 for(let i=1;i<p.widths.length;i++)expect(Math.abs(p.widths[i]-p.widths[i-1])).toBeLessThan(.08);
});
