import {it,expect} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {pathClear,type Pt} from './roads';
import {DEALERSHIP as d,planDealership} from './dealershipPlan';
for(const group of ['none','district','status','tag'] as GroupBy[])it(`places and connects the dealership safely in ${group} grouping`,()=>{
 const s=buildScene(layoutMap(catalog,[],group)),a=s.dealership!;
 expect(a).toBeDefined();
 for(const r of s.land)if(r.x!==a.x||r.z!==a.z)expect(a.x<r.x+r.w&&a.x+a.w>r.x&&a.z<r.z+r.d&&a.z+a.d>r.z).toBe(false);
 const roads=s.carBridges.flatMap(b=>b.roads).flat();expect(roads).toContainEqual(a.road[0]);
 const start=a.walk[0];expect(s.paving.some(p=>start[0]>=p.x&&start[0]<=p.x+p.w&&start[1]>=p.z&&start[1]<=p.z+p.d)).toBe(true);
 const boxes=[...s.towers,...s.kiosks,...s.retail].map(b=>({x:b.x,z:b.z,w:b.size,d:b.size}));
 expect(pathClear(a.road,boxes,.3)).toBe(true);expect(pathClear(a.walk,boxes,.3)).toBe(true);
 expect(a.cars.filter(v=>v.kind==='coupe')).toHaveLength(2);expect(a.cars.filter(v=>v.kind==='suv')).toHaveLength(2);
 for(const car of a.cars){expect(Math.abs(car.x-a.x-d.walkX)).toBeGreaterThan(d.walkWidth/2+.35);expect(car.z-.7).toBeGreaterThan(a.z+3.7);expect(car.z+.7).toBeLessThan(a.z+d.aisleZ-.7);}
 for(let i=0;i<a.cars.length;i++)for(const b of a.cars.slice(i+1))expect(Math.abs(a.cars[i].x-b.x)).toBeGreaterThan(1.2);
 expect(a.road[a.road.length-1],'vehicle bridge joins the parking aisle').toEqual(a.drive[0]);
 expect(a.walk[a.walk.length-1],'footbridge joins the promenade').toEqual(a.promenade[0]);
 expect(a.promenade[a.promenade.length-1]).toEqual([a.x+5,a.z+3.7]);
 const freight=s.freight!;expect(freight).toBeDefined();
 for(let i=1;i<freight.route.length;i++){
  const b=freight.route[i],q=freight.route[i-1],n=Math.max(1,Math.ceil(Math.hypot(b[0]-q[0],b[1]-q[1])/.15));
  for(let j=0;j<=n;j++){const p:Pt=[q[0]+(b[0]-q[0])*j/n,q[1]+(b[1]-q[1])*j/n];expect(p[0]>a.x-.7&&p[0]<a.x+a.w+.7&&p[1]>a.z-.7&&p[1]<a.z+a.d+.7,'freight stays outside display lot').toBe(false);}
 }
});
it('does not create disconnected dealership land without existing streets',()=>{expect(planDealership({land:[],paving:[],carBridges:[],towers:[],kiosks:[],retail:[]})).toBeUndefined();});
it('fits three evenly spaced upper galleries below the four-story roof',async()=>{
 const {dealershipUpperFloors}=await import('./dealershipPlan');
 const floors=dealershipUpperFloors();expect(d.floorCount).toBe(4);expect(floors).toHaveLength(3);
 for(let i=0;i<floors.length;i++){expect(floors[i]-(floors[i-1]??0)).toBeCloseTo(d.mezzanineY);expect(floors[i]+.9).toBeLessThan(d.height-.1);}
 expect(d.height).toBeCloseTo(3.05+2*d.mezzanineY);
});
