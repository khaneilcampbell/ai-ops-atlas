import {expect,it} from "vitest";
import {dropReversals,planFreight,snapToStreets} from "./freight";
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
it("drops an out-and-back stub where a crossing corner and a street join land in the wrong order",()=>{
 // Down to the street, a stray corner east of the join, back west to the join, then east and south.
 const route=dropReversals([[-2.94,-.7],[-2.5,-4.6],[-2.94,-4.6],[-2.03,-4.6],[-2.03,-18]]);
 expect(route).toHaveLength(4);expect(route[0]).toEqual([-2.94,-.7]);expect(route.slice(-2)).toEqual([[-2.03,-4.6],[-2.03,-18]]);
 for(let i=1;i<route.length-1;i++){const [a,p,b]=[route[i-1],route[i],route[i+1]];expect((p[0]-a[0])*(b[0]-p[0])+(p[1]-a[1])*(b[1]-p[1])).toBeGreaterThanOrEqual(0);}
 // A route with no reversal is left alone.
 const plain:[number,number][]=[[0,0],[0,5],[5,5],[5,0]];
 expect(dropReversals(plain)).toEqual(plain);
});
it("leaves a collector past its bend with a square, rounded turn instead of a slanted step",()=>{
 // Collector runs north (z falling) on x=0 then bends west; the truck's own road runs north on x=2
 // and turns east, so its last hugging point only reaches the collector at the bend.
 const collector:[number,number][]=[[0,0],[0,-8],[-.2,-8.4],[-1,-8.6],[-1,-12]];
 const route:[number,number][]=[[2,0],[2,-4],[2,-7.9],[2.1,-8.3],[2.4,-8.7],[3,-9],[9,-9]];
 const {route:out}=snapToStreets(route,[collector],2.4,true);
 expect(out.some(p=>Math.abs(p[0])<1e-6&&p[1]<-8.5),"carries on north along the collector's heading").toBe(true);
 for(let i=1;i<out.length;i++){const dx=out[i][0]-out[i-1][0],dz=out[i][1]-out[i-1][1],len=Math.hypot(dx,dz);
  if(len>.6)expect(Math.min(Math.abs(dx),Math.abs(dz))/len,"no long slanted step").toBeLessThan(.05);}
 expect(out.at(-1)).toEqual([9,-9]);
});
