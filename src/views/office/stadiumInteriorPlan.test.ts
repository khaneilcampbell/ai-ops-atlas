import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {STADIUM,STADIUM_SCALE,sideGateFeet} from "../map3d/stadiumGeometry";
import {STADIUM_NAME,STADIUM_OFFICE_ID} from "../map3d/stadiumPlan";
import {CONCOURSE_SPACES,GATE_ANGLES,IU,STADIUM_INTERIOR as I,STADIUM_STATUS,STADIUM_VIEWS,aisleAngles,ellipseValue,hospitalityBoxes,seatRows,spacePoint} from "./stadiumInteriorPlan";

describe("Atlas Stadium interior plan",()=>{
  it("draws the map stadium at the cutaway scale, so the city outside lines up",()=>{
    expect(IU).toBeCloseTo(4*STADIUM_SCALE);
    expect(I.glass.rx).toBeCloseTo(STADIUM.lobby.rx*IU);expect(I.pitch.w).toBeCloseTo(STADIUM.pitch.w*IU);
  });
  it("keeps the pitch inside the first row and every row inside the lobby glass, rising row by row",()=>{
    expect(ellipseValue(I.seatsInner,I.pitch.w/2,I.pitch.d/2)).toBeLessThan(1);
    const rows=seatRows();expect(rows.length).toBe(I.tiers*I.rowsPerTier);
    for(let k=1;k<rows.length;k++){expect(rows[k].y).toBeGreaterThan(rows[k-1].y);expect(rows[k].ring.rx).toBeGreaterThan(rows[k-1].ring.rx);}
    for(const r of rows){expect(r.ring.rx).toBeLessThan(I.glass.rx);expect(r.ring.rz).toBeLessThan(I.glass.rz);}
    expect(new Set(rows.map(r=>r.tier)).size).toBe(3);expect(aisleAngles().length).toBeGreaterThanOrEqual(8);
  });
  it("rings the hospitality boxes between the middle and upper tiers",()=>{
    const rows=seatRows(),mid=rows.filter(r=>r.tier===1),up=rows.filter(r=>r.tier===2);
    for(const b of hospitalityBoxes()){expect(b.y).toBeGreaterThan(mid[mid.length-1].y-.01);expect(b.y).toBeLessThan(up[0].y);expect(ellipseValue(b.ring,b.x,b.z)).toBeCloseTo(1);}
  });
  it("puts every concourse space on the concourse, inside the bowl, with the exterior's three gates",()=>{
    for(const s of CONCOURSE_SPACES){const [x,z]=spacePoint(s);expect(ellipseValue(I.glass,x,z)).toBeLessThan(1);expect(ellipseValue(I.concourseInner,x,z)).toBeGreaterThan(1);}
    const gates=CONCOURSE_SPACES.filter(s=>s.kind==="gate");expect(gates.map(g=>g.angle)).toEqual(GATE_ANGLES);
    expect(GATE_ANGLES[0]).toBe(0);
    for(const [i,[x,z]] of sideGateFeet().entries()){expect(Math.sign(GATE_ANGLES[i+1])).toBe(Math.sign(z));expect(x).toBeGreaterThan(0);}
    for(const k of ["stairs","escalator","food","shop","first-aid"] as const)expect(CONCOURSE_SPACES.some(s=>s.kind===k)).toBe(true);
  });
  it("labels spaces honestly: no live events, attendance, scores, schedules or brands",()=>{
    expect(STADIUM_STATUS).toBe("Planned · No live events");expect(STADIUM_VIEWS).toEqual(["Concourse","Seating bowl"]);
    const text=CONCOURSE_SPACES.map(s=>`${s.name} ${s.what}`).join(" ");
    expect(text).not.toMatch(/\d|tonight|live|sold|ticket|score/i);
    const source=readFileSync(join(__dirname,"StadiumInterior.tsx"),"utf8");
    expect((source.match(/<pointLight/g)??[]).length).toBe(1);
    expect(source).toContain("No tickets, attendance, scores or schedules");
  });
  it("is reached from the stadium panel and routed to its own lazy interior",()=>{
    expect(STADIUM_OFFICE_ID).toBe(`skyline-business:${STADIUM_NAME}`);
    const panel=readFileSync(join(__dirname,"../../components/DetailPanel.tsx"),"utf8");expect(panel).toContain("<EnterBuildingButton id={STADIUM_OFFICE_ID}/>");
    const map=readFileSync(join(__dirname,"../Map.tsx"),"utf8");
    expect(map).toContain('lazy(() => import("./office/StadiumInterior"))');expect(map).toMatch(/office\.projectId === STADIUM_OFFICE_ID \? <StadiumInterior/);
    // The route comes before the generic Skyline business interior, which would otherwise take it.
    expect(map.indexOf("STADIUM_OFFICE_ID ?")).toBeLessThan(map.indexOf('startsWith("skyline-business:")) ?'));
  });
});
