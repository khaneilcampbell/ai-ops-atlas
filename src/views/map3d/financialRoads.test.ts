import {describe,expect,it} from 'vitest';
import {roundJoins,snapToStreets} from './freight';

describe('roads around Financial Park',()=>{
 it('snaps hugging points onto a street and keeps one entry and exit',()=>{
  const street:[number,number][]=[[0,0],[10,0]];
  const {route,joins}=snapToStreets([[2,5],[2,.4],[3,.3],[6,-.2],[7,-.5],[7,-6]],[street],1);
  expect(route).toEqual([[2,5],[2,0],[7,0],[7,-6]]);expect(joins).toEqual([[2,0],[7,0]]);
  const round=roundJoins(route,joins,1);expect(round.length).toBeGreaterThan(route.length);expect(round[0]).toEqual([2,5]);expect(round[round.length-1]).toEqual([7,-6]);
 });
});
