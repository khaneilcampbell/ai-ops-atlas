import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {distanceToRoad} from './highway';
import {FREIGHT_STREET_TURN,roundJoins,snapToStreets} from './freight';

describe('roads around Financial Park',()=>{
 for(const grouping of ['none','district','status','tag'] as GroupBy[])it(`leave the district street cleanly in ${grouping} view`,()=>{
  const s=buildScene(layoutMap(catalog,[],grouping)),f=s.financial!,street=f.street,fr=s.freight!;
  const collector=fr.access.find(a=>a.id==='financial-district');
  if(collector){
   // The highway collector meets the street once, at a right angle: no lane doubled along it.
   const along=collector.collector.filter(p=>distanceToRoad(p,street)<.3);
   expect(along.length,'collector touches the street at most once').toBeLessThanOrEqual(1);
   if(along.length){const [a,b]=collector.collector;expect(Math.abs(a[0]-b[0]),'and leaves it at a right angle').toBeLessThan(1e-6);}
  }
  // Freight never runs beside the street as a second, overlapping road: off the street, it is
  // either clear of it or on the short turn at a join.
  const joins=fr.localJunctions.filter(p=>distanceToRoad(p,street)<1e-6);
  for(let i=1;i<fr.route.length;i++){const a=fr.route[i-1],b=fr.route[i],m:[number,number]=[(a[0]+b[0])/2,(a[1]+b[1])/2],d=distanceToRoad(m,street);
   const turning=joins.some(j=>Math.hypot(j[0]-m[0],j[1]-m[1])<FREIGHT_STREET_TURN*1.6);
   expect(d<1e-6||d>.95||turning,`freight segment ${i} hugs the street at ${d.toFixed(2)}`).toBe(true);}
 });
 it('snaps hugging points onto a street and keeps one entry and exit',()=>{
  const street:[number,number][]=[[0,0],[10,0]];
  const {route,joins}=snapToStreets([[2,5],[2,.4],[3,.3],[6,-.2],[7,-.5],[7,-6]],[street],1);
  expect(route).toEqual([[2,5],[2,0],[7,0],[7,-6]]);expect(joins).toEqual([[2,0],[7,0]]);
  const round=roundJoins(route,joins,1);expect(round.length).toBeGreaterThan(route.length);expect(round[0]).toEqual([2,5]);expect(round[round.length-1]).toEqual([7,-6]);
 });
});
