import {it,expect} from "vitest";
import {elevatorAt} from "./circulation";
it("opens only at a landing and stays between floors during travel",()=>{
  for(let t=0;t<128;t+=0.1){const lift=elevatorAt(t);expect(lift.height).toBeGreaterThanOrEqual(0);expect(lift.height).toBeLessThanOrEqual(16);if(lift.landing!==null)expect(lift.height).toBe(lift.landing*4);else expect(lift.phase).toBeGreaterThanOrEqual(5);}
  expect(elevatorAt(0).landing).toBe(0);expect(elevatorAt(32).landing).toBe(4);expect(elevatorAt(64)).toEqual(elevatorAt(0));
});
