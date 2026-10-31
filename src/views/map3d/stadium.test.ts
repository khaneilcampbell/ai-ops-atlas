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
