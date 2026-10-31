import {expect,it} from 'vitest';
import {AIRPORT_BUILDINGS as buildings,airportAnimationEnabled} from './airportBuildings';
import {AIRPORT_LAYOUT as l} from './airport';
import {BUILDING_INTERIORS} from '../../catalog/buildings';
it('keeps all eight airport buildings on their parcel, clear of each other and the runway',()=>{
 expect(buildings).toHaveLength(8);
 for(const a of buildings){expect(a.x-a.w/2).toBeGreaterThanOrEqual(l.landX);expect(a.x+a.w/2).toBeLessThan(l.landX+l.landWidth);expect(a.z-a.d/2).toBeGreaterThan(l.landZ);expect(a.z+a.d/2).toBeLessThan(l.landZ+l.landDepth);
 const runwayClear=a.x+a.w/2<l.runwayX-l.runwayWidth/2||a.x-a.w/2>l.runwayX+l.runwayWidth/2||a.z+a.d/2<l.runwayZ-l.runwayLength/2||a.z-a.d/2>l.runwayZ+l.runwayLength/2;expect(runwayClear,a.id).toBe(true);
 for(const b of buildings.filter(b=>b.id!==a.id))expect(Math.abs(a.x-b.x)>(a.w+b.w)/2||Math.abs(a.z-b.z)>(a.d+b.d)/2,`${a.id}/${b.id}`).toBe(true);
 expect(BUILDING_INTERIORS[a.name].rooms).toEqual([...a.rooms]);expect(a.agent.length).toBeGreaterThan(0);
 }
});
it('pauses airport motion for saver, hidden maps, traffic off and reduced motion',()=>{expect(airportAnimationEnabled(true,false,true)).toBe(true);expect(airportAnimationEnabled(false,false,true)).toBe(false);expect(airportAnimationEnabled(true,true,true)).toBe(false);expect(airportAnimationEnabled(true,false,false)).toBe(false)});
it('keeps every front entrance approach outside neighboring buildings',()=>{
 for(const a of buildings){const z=a.z+a.d/2+.8;for(const b of buildings.filter(b=>b.id!==a.id))expect(Math.abs(a.x-b.x)>(.48+b.w)/2||Math.abs(z-b.z)>(1.6+b.d)/2,`${a.id} entrance/${b.id}`).toBe(true)}
});
