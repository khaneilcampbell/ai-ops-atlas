import {it,expect} from 'vitest';
import {bridgePoint,connectionSpans,clipConnectionRails} from './connectionGeometry';
import type {Inst} from './models';
it('unions duplicated and partially overlapping links while retaining disconnected spans',()=>{
 expect(connectionSpans([[[0,0],[4,0]],[[2,0],[6,0]],[[6,0],[0,0]],[[8,0],[10,0]],[[3,0],[3,2]]])).toEqual([{a:[0,0],b:[6,0]},{a:[8,0],b:[10,0]},{a:[3,0],b:[3,2]}]);
});
it('cuts a junction in a long railing without removing the protected remainder',()=>{
 const rail:Inst={p:[0,.2,5],s:[.025,.03,10]};
 const result=clipConnectionRails([rail],[[0,3]],.55);
 expect(result).toHaveLength(2);
 expect(result[0].p[2]-result[0].s[2]/2).toBeCloseTo(0);
 expect(result[1].p[2]+result[1].s[2]/2).toBeCloseTo(10);
 for(const r of result)expect(r.p[2]+r.s[2]/2<=2.45||r.p[2]-r.s[2]/2>=3.55).toBe(true);
});
it('removes posts within a junction and leaves remote railings untouched',()=>{
 const post:Inst={p:[0,.1,3],s:[.025,.2,.025]},far:Inst={p:[2,.2,5],s:[.025,.03,10]};
 expect(clipConnectionRails([post,far],[[0,3]],.55)).toEqual([far]);
});

it('keeps connector landings flush and wide enough for the shared two-lane street',async()=>{
 const {bridgeParts}=await import('./models');const {TERRACE_H}=await import('./scene');const {TRANSPORT}=await import('./transportScale');
 const p=bridgeParts({key:'test',ends:['a','b'],axis:'x',a:[0,0],b:[8,0],roads:[[],[]]},[],TRANSPORT.bridgeWidth,-1.2,false);
 for(const d of p.deck.filter(d=>d.s[2]>1&&d.c==='#ddd2b8')){
  expect(d.s[0]).toBe(TRANSPORT.bridgeWidth);expect(d.rx).toBeCloseTo(0);expect(d.p[1]+d.s[1]).toBeCloseTo(.059+TERRACE_H);
 }
 // The street's asphalt lies on the slab, a hair proud of it, so the road reads as one surface.
 for(const d of p.deck.filter(d=>d.s[2]>1&&d.c==='#424b50'))expect(d.p[1]+d.s[1]-(.059+TERRACE_H)).toBeLessThan(.004);
});

it('keeps bridge furniture on the deck in all four travel directions',()=>{
 for(const b of [[4,0],[-4,0],[0,4],[0,-4]] as [number,number][]){
  expect(bridgePoint([0,0],b,4)).toEqual(b);
  const point=bridgePoint([0,0],b,2,.24);
  expect(Math.hypot(point[0]-b[0]/2,point[1]-b[1]/2)).toBeCloseTo(.24);
  expect(bridgePoint([0,0],b,8)).toEqual(b);
 }
 expect(bridgePoint([2,3],[2,3],1)).toEqual([2,3]);
});
it('opens horizontal footbridge rails at a junction while retaining both protected ends',()=>{
 const rail:Inst={p:[5,.2,0],s:[10,.035,.035]};
 const clipped=clipConnectionRails([rail],[[3,0]],.55);
 expect(clipped).toHaveLength(2);
 for(const p of clipped){expect(p.r).toBeCloseTo(Math.PI/2);expect(p.p[0]+p.s[2]/2<=2.45+1e-6||p.p[0]-p.s[2]/2>=3.55-1e-6).toBe(true);}
 expect(clipped.reduce((sum,p)=>sum+p.s[2],0)).toBeCloseTo(8.9);
});
