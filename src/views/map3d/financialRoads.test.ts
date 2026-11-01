import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {distanceToRoad,roadIntersections} from './highway';
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
  // either clear of it, on the short turn at a join, or crossing it at a junction.
  const joins=fr.localJunctions.filter(p=>distanceToRoad(p,street)<1e-6),crossings=roadIntersections(fr.route,street);
  for(let i=1;i<fr.route.length;i++){const a=fr.route[i-1],b=fr.route[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.1));
   for(let k=0;k<=n;k++){const m:[number,number]=[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n],d=distanceToRoad(m,street);
    const turning=joins.some(j=>Math.hypot(j[0]-m[0],j[1]-m[1])<FREIGHT_STREET_TURN*1.6),crossing=crossings.some(c=>Math.hypot(c[0]-m[0],c[1]-m[1])<1);
    if(!(d<1e-6||d>.95||turning||crossing))expect.fail(`freight segment ${i} hugs the street at ${d.toFixed(2)}`);}}
  // Where it crosses the street, the crossing is a junction, so curbs and lines open for it.
  for(const c of crossings)expect(fr.localJunctions.some(j=>Math.hypot(j[0]-c[0],j[1]-c[1])<1e-6),'crossing is a junction').toBe(true);
 });
 it('snaps hugging points onto a street and keeps one entry and exit',()=>{
  const street:[number,number][]=[[0,0],[10,0]];
  const {route,joins}=snapToStreets([[2,5],[2,.4],[3,.3],[6,-.2],[7,-.5],[7,-6]],[street],1);
  expect(route).toEqual([[2,5],[2,0],[7,0],[7,-6]]);expect(joins).toEqual([[2,0],[7,0]]);
  const round=roundJoins(route,joins,1);expect(round.length).toBeGreaterThan(route.length);expect(round[0]).toEqual([2,5]);expect(round[round.length-1]).toEqual([7,-6]);
 });
});
