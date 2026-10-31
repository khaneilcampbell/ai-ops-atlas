import {it,expect} from 'vitest';
import {catalog} from '../../catalog';import {layoutMap} from '../mapLayout';import {buildScene} from './scene';
import {planDealershipTraffic,vehicleVisible,vehicleAt,dealershipGarageOpen} from './vehicles';
const scene=buildScene(layoutMap(catalog));
it('runs departures every 60 seconds and service arrivals every 90 seconds',()=>{
 const [out,arrival]=planDealershipTraffic(scene);expect(out.period).toBe(60);expect(arrival.period).toBe(90);
 for(const v of [out,arrival]){expect(v.serviceWindow!.duration).toBeLessThan(v.period);expect(vehicleVisible(v,0)).toBe(false);for(const cycle of [1,2,3]){expect(vehicleVisible(v,v.period*cycle+.01)).toBe(true);expect(vehicleVisible(v,v.period*cycle+v.serviceWindow!.duration+.01)).toBe(false);}}
});
it('connects the city street to the dealership service door without teleporting during a visit',()=>{
 const [out,arrival]=planDealershipTraffic(scene),d=scene.dealership!;
 expect(arrival.legs[0].a).toEqual(d.service[0]);expect(out.legs[0].a).toEqual([d.x+8.86,d.z+2.1]);
 for(const v of [out,arrival])for(let i=1;i<v.legs.length;i++)expect(v.legs[i].a).toEqual(v.legs[i-1].b);
 for(const v of [out,arrival])for(let t=.1;t<v.serviceWindow!.duration;t+=.1){const a=vehicleAt(v,t),b=vehicleAt(v,t-.1);expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeLessThan(.1);}
});

it('opens the garage before each service crossing and closes after clearance',()=>{
 const plans=planDealershipTraffic(scene),arrival=plans[1],at=90+arrival.serviceWindow!.duration;
 expect(dealershipGarageOpen(plans,0)).toBe(0);
 expect(dealershipGarageOpen(plans,59)).toBe(1);
 expect(dealershipGarageOpen(plans,60)).toBe(1);
 expect(dealershipGarageOpen(plans,65)).toBe(0);
 expect(dealershipGarageOpen(plans,at-1)).toBe(1);
 expect(dealershipGarageOpen(plans,at+3)).toBe(0);
 expect(dealershipGarageOpen(plans,58.5)).toBeCloseTo(.5);
});

it('keeps the shutter fully open while a visible service car is at the threshold',()=>{
 const plans=planDealershipTraffic(scene),d=scene.dealership!;
 for(const v of plans)for(let t=v.period;t<v.period+v.serviceWindow!.duration;t+=.1){
  const p=vehicleAt(v,t);if(Math.hypot(p.x-(d.x+8.86),p.z-(d.z+2.1))<.55)expect(dealershipGarageOpen(plans,t)).toBe(1);
 }
});
