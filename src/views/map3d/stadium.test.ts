import {describe,it,expect} from "vitest";
import {planStadium} from "./Stadium";
describe("stadium placement",()=>{
  const profile={x:0,z:0,w:6,d:6};
  const paving=[{x:.2,z:2,w:.4,d:2,y:.6,h:.04}];
  it("sits beside Profile with a real paved access endpoint",()=>{
    const plan=planStadium([profile],paving,profile)!;
    expect(plan.x+plan.w).toBeLessThan(profile.x);
    expect(plan.accessX).toBeGreaterThanOrEqual(paving[0].x);
    expect(plan.accessZ).toBe(3);
  });
  it("clears existing airport land",()=>{
    const airport={x:-9.2,z:-.5,w:8,d:7};
    const plan=planStadium([profile,airport],paving,profile)!;
    expect(plan.x+plan.w+2+.3<=airport.x || plan.z+plan.d+2+.3<=airport.z || plan.z-2>=airport.z+airport.d+.3).toBe(true);
  });
  it("does not invent a district without Profile or access",()=>{
    expect(planStadium([profile],paving)).toBeUndefined();
    expect(planStadium([profile],[],profile)).toBeUndefined();
  });
});

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {catalog} from "../../catalog";
import {layoutMap,type GroupBy} from "../mapLayout";
import {buildScene,TERRACE_H} from "./scene";
import {towerTop} from "./models";
import {MALL} from "./mallPlan";
import {distanceToRoad} from "./highway";
import {lightingObstacles} from "./streetLighting";
import type {Pt} from "./roads";
import {STADIUM,STADIUM_SCALE,shellPoint,stadiumCentre,stadiumCrown,stadiumGate,stadiumGeometry,stadiumPieceCount,stadiumTriangles,sideGateFeet} from "./stadiumGeometry";
import {STADIUM_BOX,STADIUM_NAME} from "./stadiumPlan";

describe("Atlas Stadium",()=>{
  const S=STADIUM,box=8,depth=7;
  it("grows the district by one factor, about 1.3 times the Marketplace footprint and lower than it",()=>{
    expect(STADIUM_SCALE).toBeGreaterThanOrEqual(1.3);expect(STADIUM_SCALE).toBeLessThanOrEqual(1.5);
    expect(STADIUM_BOX.w).toBeCloseTo(box*STADIUM_SCALE);expect(STADIUM_BOX.d).toBeCloseTo(depth*STADIUM_SCALE);
    expect(stadiumCrown()).toBeLessThan(MALL.levels*MALL.floor);
  });
  it("has an odd number of shells, seven to eleven, in Atlas's own rhythm",()=>{
    expect(S.shells%2).toBe(1);expect(S.shells).toBeGreaterThanOrEqual(7);expect(S.shells).toBeLessThanOrEqual(11);
    expect(new Set(S.rhythm).size).toBeGreaterThan(1);
    expect(S.twist).toBeLessThanOrEqual(20*Math.PI/180);
  });
  it("keeps the shells inside the 8 x 7 design box and the concourse and gates inside its lot",()=>{
    for(let i=0;i<S.shells;i++)for(let u=-1;u<=1;u+=.1)for(let v=0;v<=1;v+=.05){
      const [x,,z]=shellPoint(i,u,v);expect(Math.abs(x)).toBeLessThan(box/2);expect(Math.abs(z)).toBeLessThan(depth/2);
    }
    expect(S.concourse.outer.rx).toBeLessThan(box/2);expect(S.concourse.outer.rz).toBeLessThan(depth/2);
    expect(S.gate.foot).toBeLessThan(box/2+2);
    for(const [x,z]of sideGateFeet()){expect(Math.abs(x)).toBeLessThan(box/2);expect(Math.abs(z)).toBeLessThan(depth/2);}
    // The shells stand on the concourse; the seating sits inside the shells.
    expect(S.base.rx).toBeGreaterThan(S.concourse.inner.rx);expect(S.base.rx).toBeLessThan(S.concourse.outer.rx);
    expect(S.seats.outer.rx).toBeLessThan(S.base.rx);
    // From above, the pitch shows through the roof opening.
    expect(S.pitch.w/2).toBeLessThan(S.open.rx);expect(S.pitch.d/2).toBeLessThan(S.open.rz);
  });
  for(const grouping of ["none","district","status","tag"] as GroupBy[])it(`stays below the Marketplace and every HQ, with every link at a gate: ${grouping}`,()=>{
    const s=buildScene(layoutMap(catalog,[],grouping)),a=s.stadium!,[cx,cz]=stadiumCentre(a),gate=stadiumGate(a);
    // The bigger district: the box and the gate grow by one factor; the lot keeps its 2-unit margin.
    expect(a.w).toBeCloseTo(STADIUM_BOX.w);expect(a.d).toBeCloseTo(STADIUM_BOX.d);
    expect(gate[0]-cx).toBeCloseTo(S.gate.foot*STADIUM_SCALE);expect(gate[0]).toBeLessThan(a.x+a.w+2);
    expect(stadiumCrown()).toBeCloseTo(Math.max(...S.rhythm)*STADIUM_SCALE);
    expect(stadiumCrown()).toBeLessThan(MALL.levels*MALL.floor);
    for(const t of s.towers)expect(TERRACE_H+stadiumCrown()).toBeLessThan(towerTop(t));
    // Roads and walks that serve the stadium end at the main gate, or on a road that does.
    const links=s.transportConnections.filter(l=>l.id.includes("stadium"));
    const atGate=(p:Pt)=>Math.hypot(p[0]-gate[0],p[1]-gate[1]);
    const direct=links.filter(l=>l.id==="profile-stadium"||l.id==="stadium-airport");
    expect(direct.length).toBeGreaterThan(0);
    for(const l of direct){expect(atGate(l.road[l.road.length-1])).toBeLessThan(.05);expect(atGate(l.walk[l.walk.length-1])).toBeLessThan(.05);}
    const served=direct.flatMap(l=>[l.road,l.walk]);
    for(const l of links.filter(l=>!direct.includes(l))){
      expect(Math.min(...served.map(r=>distanceToRoad(l.road[l.road.length-1],r)))).toBeLessThan(.1);
      expect(Math.min(...served.map(r=>distanceToRoad(l.walk[l.walk.length-1],r)))).toBeLessThan(.1);
    }
    const stop=s.communityRail?.loop?.stops.find(x=>x.id==="service:stadium-station");
    if(stop){const [x,,z]=stop.walk[0];expect(atGate([x,z])).toBeLessThan(.05);}
    // Nothing that moves crosses the shells or the concourse.
    const o={rx:S.concourse.outer.rx*STADIUM_SCALE,rz:S.concourse.outer.rz*STADIUM_SCALE},inside=([x,z]:Pt)=>((x-cx)/(o.rx+.05))**2+((z-cz)/(o.rz+.05))**2<1;
    const paths:Pt[][]=[...s.transportConnections.flatMap(l=>[l.road,l.walk])];
    if(s.freight)paths.push(s.freight.route,s.freight.highway,s.freight.cityAccess,...s.freight.access.flatMap(x=>[x.collector,...x.ramps]));
    if(s.communityRail?.loop)paths.push(s.communityRail.loop.route,...s.communityRail.loop.stops.map(st=>st.walk.map(([x,,z])=>[x,z] as Pt)));
    for(const path of paths)for(let i=1;i<path.length;i++)for(let t=0;t<=1;t+=.05){
      const p:Pt=[path[i-1][0]+(path[i][0]-path[i-1][0])*t,path[i-1][1]+(path[i][1]-path[i-1][1])*t];expect(inside(p)).toBe(false);
    }
    // Street lights keep off the concourse.
    expect(lightingObstacles(s).some(b=>b.x===cx&&b.z===cz&&b.w===o.rx*2&&b.d===o.rz*2)).toBe(true);
  });
  it("stays about as cheap as the bowl it replaced: nine draws, under 20,000 triangles, no lights",()=>{
    const pieces=stadiumPieceCount(),geo=stadiumGeometry();
    expect(pieces.draws).toBeLessThanOrEqual(10);
    expect(pieces.instances).toBeLessThan(60);
    expect(stadiumTriangles(geo)).toBeLessThan(20000);
    for(const v of Object.values(geo))v.dispose();
    const source=readFileSync(join(__dirname,"Stadium.tsx"),"utf8");
    expect(source).not.toMatch(/<(point|spot|directional|ambient|hemisphere|rectArea)Light/);
    expect(source).not.toMatch(/useFrame/);
    expect((source.match(/<mesh /g)??[]).length).toBe(pieces.meshes);
    expect((source.match(/<Instanced /g)??[]).length).toBe(pieces.instanced);
  });
  it("is named Atlas Stadium on the plaque, at the roof's crown",()=>{
    expect(STADIUM_NAME).toBe("Atlas Stadium");
    const map=readFileSync(join(__dirname,"Map3D.tsx"),"utf8");
    expect(map).toMatch(/plaque\(\{id:STADIUM_KEY,select:STADIUM_KEY,name:STADIUM_NAME,[^}]*roof:TERRACE_H\+stadiumCrown\(\)/);
    const panel=readFileSync(join(__dirname,"../../components/DetailPanel.tsx"),"utf8");
    expect(panel).toContain('title="Atlas Stadium"');
  });
});

describe("Atlas Stadium seating",()=>{
  it("stays under the shells at every height",()=>{
    const T=STADIUM.seats;
    for(let i=0;i<STADIUM.shells;i++)for(let u=-1;u<=1;u+=.1)for(let v=0;v<=1;v+=.02){
      const [x,y,z]=shellPoint(i,u,v,STADIUM.thickness);if(y>T.high)continue;
      expect((x/T.outer.rx)**2+(z/T.outer.rz)**2).toBeGreaterThan(1);
    }
  });
});
