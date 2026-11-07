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
import {cityEnvelope} from "./citySpacing";
import {STADIUM,STADIUM_SCALE,mainRoofAt,practiceRoofAt,stadiumPlaza,stadiumCentre,stadiumCrown,stadiumGate,stadiumGeometry,stadiumPieceCount,stadiumTriangles,sideGateFeet,stairLine,treeColumns,trussXs} from "./stadiumGeometry";
import {STADIUM_BOX,STADIUM_NAME} from "./stadiumPlan";

describe("Atlas Stadium",()=>{
  const S=STADIUM,box=8,depth=7;
  it("grows the district by one factor, about 1.3 times the Marketplace footprint and lower than it",()=>{
    expect(STADIUM_SCALE).toBeGreaterThanOrEqual(1.3);expect(STADIUM_SCALE).toBeLessThanOrEqual(1.5);
    expect(STADIUM_BOX.w).toBeCloseTo(box*STADIUM_SCALE);expect(STADIUM_BOX.d).toBeCloseTo(depth*STADIUM_SCALE);
    expect(stadiumCrown()).toBeLessThan(MALL.levels*MALL.floor);
  });
  it("is a sloping steel-and-glass hall: low at the entrance, high at the far end, mirrored across its long axis (KC, 2026-11-07)",()=>{
    const H=S.hall,R=S.roof;
    expect(mainRoofAt(H.x0,0)).toBeGreaterThan(mainRoofAt(H.x1,0)+.5);
    expect(mainRoofAt(H.x1+R.over,0)).toBeGreaterThanOrEqual(R.low);expect(mainRoofAt(H.x1+R.over,0)).toBeLessThan(R.low+R.curl);
    for(let x=H.x0-R.over;x<=H.x1+R.over;x+=.25)for(let z=0;z<=H.z+R.over;z+=.25)expect(mainRoofAt(x,z)).toBeCloseTo(mainRoofAt(x,-z),9);
    // Upswept eaves: each long edge sits above the roof's centre line, and the corners highest of all.
    expect(mainRoofAt(0,H.z+R.over)).toBeGreaterThan(mainRoofAt(0,0));
    expect(mainRoofAt(H.x0-R.over,H.z+R.over)).toBeGreaterThan(mainRoofAt(H.x0-R.over,0));
    expect(stadiumCrown()).toBeCloseTo(mainRoofAt(H.x0-R.over,H.z+R.over)*STADIUM_SCALE,6);
    // The practice hall is lower, with the same slope, and sits under the main roof where they overlap.
    const P=S.practice;expect(practiceRoofAt(P.x0,P.z0)).toBeGreaterThan(practiceRoofAt(P.x1,P.z0));
    for(let x=P.x0-P.over;x<=P.x1+P.over;x+=.1)expect(practiceRoofAt(x,-H.z-R.over)).toBeLessThan(mainRoofAt(x,-H.z-R.over)-R.thick-.1);
  });
  it("carries the roof on twelve trusses and six tree columns, with a diagonal grand stair to the main gate",()=>{
    expect(S.trusses.main).toBe(12);expect(trussXs().length).toBe(12);expect(trussXs(S.trusses.practice).length).toBe(5);
    const xs=trussXs();for(let k=1;k<xs.length;k++)expect(xs[k]).toBeGreaterThan(xs[k-1]);
    const trees=treeColumns();expect(trees.length).toBe(6);
    for(const [x,z] of trees)expect(trees.some(([x2,z2])=>Math.abs(x2-x)<1e-9&&Math.abs(z2+z)<1e-9)).toBe(true);
    const st=stairLine();expect(S.stair.angle).toBe(35);
    expect(Math.atan2(st.foot[1]-st.top[1],st.foot[0]-st.top[0])*180/Math.PI).toBeCloseTo(35,6);
    expect(st.foot[0]).toBe(S.gate.foot);expect(st.foot[1]).toBe(0);expect(st.top[0]).toBeCloseTo(S.podium.x1,6);
    expect(Math.abs(st.top[1])).toBeLessThan(S.podium.z-S.gate.width/2);
  });
  it("keeps both halls inside the 8 x 7 design box and the pools' ring, with the gates on its lot",()=>{
    const H=S.hall,P=S.practice,Pd=S.podium,R=S.ring;
    for(const x of [Pd.x0,Pd.x1,P.podium.x0,P.podium.x1])expect(Math.abs(x)).toBeLessThan(box/2);
    for(const z of [Pd.z,P.podium.z0])expect(Math.abs(z)).toBeLessThan(depth/2);
    const corners=[[Pd.x0,Pd.z],[Pd.x1,Pd.z],[P.podium.x0,P.podium.z0],[P.podium.x1,P.podium.z0],[H.x0-S.roof.over,H.z+S.roof.over]];
    for(const [x,z] of corners)expect((x/R.rx)**2+(z/R.rz)**2).toBeLessThan(1);
    expect(S.gate.foot).toBeLessThan(box/2+2);
    for(const [x,z]of sideGateFeet()){expect(Math.abs(x)).toBeLessThan(box/2);expect(Math.abs(z)).toBeLessThan(depth/2);}
  });
  for(const grouping of ["none","district","status","tag"] as GroupBy[])it(`stays below the Marketplace and every HQ, with every link at a gate: ${grouping}`,()=>{
    const s=buildScene(layoutMap(catalog,[],grouping)),a=s.stadium!,[cx,cz]=stadiumCentre(a),gate=stadiumGate(a);
    // The bigger district: the box and the gate grow by one factor; the lot keeps its 2-unit margin.
    expect(a.w).toBeCloseTo(STADIUM_BOX.w);expect(a.d).toBeCloseTo(STADIUM_BOX.d);
    expect(gate[0]-cx).toBeCloseTo(S.gate.foot*STADIUM_SCALE);expect(gate[0]).toBeLessThan(a.x+a.w+2);
    expect(stadiumCrown()).toBeCloseTo((S.roof.high+2.5*S.roof.curl)*STADIUM_SCALE);
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
    // Nothing that moves crosses the halls, the podium or the ring round them.
    const o={rx:S.ring.rx*STADIUM_SCALE,rz:S.ring.rz*STADIUM_SCALE},inside=([x,z]:Pt)=>((x-cx)/(o.rx+.05))**2+((z-cz)/(o.rz+.05))**2<1;
    const paths:Pt[][]=[...s.transportConnections.flatMap(l=>[l.road,l.walk])];
    if(s.freight)paths.push(s.freight.route,s.freight.highway,s.freight.cityAccess,...s.freight.access.flatMap(x=>[x.collector,...x.ramps]));
    if(s.communityRail?.loop)paths.push(s.communityRail.loop.route,...s.communityRail.loop.stops.map(st=>st.walk.map(([x,,z])=>[x,z] as Pt)));
    for(const path of paths)for(let i=1;i<path.length;i++)for(let t=0;t<=1;t+=.05){
      const p:Pt=[path[i-1][0]+(path[i][0]-path[i-1][0])*t,path[i-1][1]+(path[i][1]-path[i-1][1])*t];expect(inside(p)).toBe(false);
    }
    // Street lights keep off the ring.
    expect(lightingObstacles(s).some(b=>b.x===cx&&b.z===cz&&b.w===o.rx*2&&b.d===o.rz*2)).toBe(true);
  });
  it("stays cheap: seven draws, under 20,000 triangles, no lights",()=>{
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

describe("Atlas Stadium grounds",()=>{
  for(const grouping of ["none","district","status","tag"] as GroupBy[])it(`plants the plaza on the lot, off the halls, gates and walks: ${grouping}`,()=>{
    const s=buildScene(layoutMap(catalog,[],grouping)),a=s.stadium!,[cx,cz]=stadiumCentre(a),plaza=stadiumPlaza(a),K=STADIUM_SCALE,o=STADIUM.ring;
    expect(plaza.trees.length).toBeGreaterThanOrEqual(12);expect(plaza.bollards.length).toBeGreaterThan(10);
    for(const p of [...plaza.trees,...plaza.beds,...plaza.bollards]){
      expect(p[0]).toBeGreaterThan(a.x-2);expect(p[0]).toBeLessThan(a.x+a.w+2);expect(p[1]).toBeGreaterThan(a.z-2);expect(p[1]).toBeLessThan(a.z+a.d+2);
      expect(((p[0]-cx)/(o.rx*K))**2+((p[1]-cz)/(o.rz*K))**2).toBeGreaterThan(1);
    }
    // Nothing planted stands in the main gate's approach.
    for(const t of [...plaza.trees,...plaza.beds])expect(t[0]>cx&&Math.abs(t[1]-cz)<STADIUM.gate.width*K/2).toBe(false);
    // Plaza trees that survived the road and walk clean-up are in the scene; none sits on a station walk.
    const walks=(s.communityRail?.loop?.stops??[]).map(st=>st.walk.map(([x,,z]):Pt=>[x,z]));
    for(const t of s.trees)for(const w of walks)expect(distanceToRoad([t.x,t.z],w)).toBeGreaterThanOrEqual(.45);
  });
  for(const grouping of ["none","district","status","tag"] as GroupBy[])it(`sits in the middle of open lawn grounds, ringed by pools: ${grouping}`,()=>{
    const s=buildScene(layoutMap(catalog,[],grouping)),a=s.stadium!,g=s.stadiumSite!,lot={x:a.x-2,z:a.z-2,w:a.w+4,d:a.d+4},r=g.site,env=cityEnvelope(s.land)!;
    // KC, 2026-11-07: use the whole space, with the stadium centred in it and the rest left as lawn.
    const e=1e-6;expect(r.x).toBeLessThanOrEqual(lot.x+e);expect(r.z).toBeLessThanOrEqual(lot.z+e);expect(r.x+r.w).toBeGreaterThanOrEqual(lot.x+lot.w-e);expect(r.z+r.d).toBeGreaterThanOrEqual(lot.z+lot.d-e);
    expect(r.x).toBeGreaterThanOrEqual(env.x);expect(r.z).toBeGreaterThanOrEqual(env.z);expect(r.x+r.w).toBeLessThanOrEqual(env.x+env.w);expect(r.z+r.d).toBeLessThanOrEqual(env.z+env.d);
    expect(Math.abs((r.x+r.w/2)-(lot.x+lot.w/2))).toBeLessThan(1.5);
    expect(g.boxes.every(b=>b.c==='#5aaac0'||b.c==='#d9d2c4')).toBe(true);
    for(const t of s.trees)if(t.x>r.x&&t.x<r.x+r.w&&t.z>r.z&&t.z<r.z+r.d)expect(t.x>=lot.x&&t.x<=lot.x+lot.w&&t.z>=lot.z&&t.z<=lot.z+lot.d).toBe(true);
    // Palms ring the plaza (KC, 2026-11-07), only on the stadium's lot, drawn by the stadium.
    expect(g.palms!.length).toBeGreaterThanOrEqual(12);
    for(const t of s.trees.filter(t=>t.kind==='palm'))expect(t.x>=lot.x&&t.x<=lot.x+lot.w&&t.z>=lot.z&&t.z<=lot.z+lot.d).toBe(true);
    expect(readFileSync(join(__dirname,"models.tsx"),"utf8")).toMatch(/t\.kind === "palm"\) return/);
    // The pools ring the halls but leave the main gate open.
    const [cx,cz]=stadiumCentre(a),water=g.boxes.filter(b=>b.c==='#5aaac0');
    expect(water.length).toBeGreaterThan(20);
    for(const w of water)expect(w.x>cx&&Math.abs(w.z-cz)<STADIUM.gate.width*STADIUM_SCALE/2).toBe(false);
  });
});
