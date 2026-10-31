import {describe,it,expect} from "vitest";
import {beginPedestrianFrame,reportPedestrian,entranceOccupied,doorOpenness,pedestrianAllowed} from "./doorTraffic";
describe("pedestrian entrance doors",()=>{
  it("opens only the nearby entrance and clears stale visitors",()=>{beginPedestrianFrame();reportPedestrian(2,3);expect(entranceOccupied(2.2,3)).toBe(true);expect(entranceOccupied(4,3)).toBe(false);beginPedestrianFrame();expect(entranceOccupied(2,3)).toBe(false);});
  it("opens and closes smoothly without overshooting after a stalled frame",()=>{const opened=doorOpenness(0,true,1);expect(opened).toBeGreaterThan(0);expect(opened).toBeLessThan(1);const closed=doorOpenness(opened,false,1);expect(closed).toBeGreaterThanOrEqual(0);expect(closed).toBeLessThan(opened);expect(doorOpenness(0,true,0)).toBe(0);});
});

it("blocks every outdoor crowd at an interior boundary, including its safety margin",()=>{const room={x:-2,z:-3,w:4,d:6};expect(pedestrianAllowed(room,0,0)).toBe(false);expect(pedestrianAllowed(room,2.1,0)).toBe(false);expect(pedestrianAllowed(room,2.3,0)).toBe(true);expect(pedestrianAllowed(undefined,0,0)).toBe(true);});
