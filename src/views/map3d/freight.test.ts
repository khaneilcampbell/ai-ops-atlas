import {expect,it} from "vitest";
import {planFreight} from "./freight";
import type {Scene3D} from "./scene";
it("connects a lot left of Canva to the airport with a returning truck",()=>{
 const scene={airport:{x:-12,z:0,w:8,d:12,accessX:0,accessZ:6,west:true},towers:[],retail:[],kiosks:[{name:"Canva",x:2,z:4,size:1}]} as unknown as Scene3D;
 const p=planFreight(scene)!;
 expect(p).toBeDefined();expect(p.lot.x).toBeLessThan(1.5);
 expect(p.route[p.route.length-1]).toEqual([-9,18]);
 expect(p.truck.legs.filter(l=>l.hold)).toHaveLength(2);
 expect(p.truck.legs[p.truck.legs.length-1].b).toEqual([p.lot.x,p.lot.z]);
 for(const point of p.route)expect(Math.abs(point[0]-2)>=.95||Math.abs(point[1]-4)>=.95).toBe(true);
});
it("does not invent a shipment without both endpoints",()=>{expect(planFreight({towers:[],kiosks:[],retail:[]})).toBeUndefined();});

it("wraps all district land and separates outbound and return lanes",()=>{
 const land=[{x:-12,z:-10,w:12,d:24},{x:0,z:0,w:15,d:15}];
 const scene={land,airport:{x:-12,z:0,w:8,d:12,accessX:0,accessZ:6,west:true},towers:[],retail:[],kiosks:[{name:"Canva",x:2,z:4,size:1}]} as unknown as Scene3D;
 const p=planFreight(scene)!;expect(p.highway[0]).toEqual(p.highway[p.highway.length-1]);
 expect(Math.min(...p.highway.map(v=>v[0]))).toBeLessThan(-12);expect(Math.max(...p.highway.map(v=>v[0]))).toBeGreaterThan(15);
 expect(Math.min(...p.highway.map(v=>v[1]))).toBeLessThan(-10);expect(Math.max(...p.highway.map(v=>v[1]))).toBeGreaterThan(15);
 const outbound=p.truck.legs.find(l=>!l.hold&&Math.abs(l.a[1]+16)<.5&&Math.abs(l.b[1]+16)<.5&&Math.hypot(l.b[0]-l.a[0],l.b[1]-l.a[1])>.1)!;
 expect(outbound).toBeDefined();expect(Math.abs(outbound.a[1]+16)).toBeGreaterThan(.1);
});
