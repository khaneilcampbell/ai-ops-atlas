import { expect, it } from "vitest";
import { OPACITY, RADIUS } from "./network";

// Agent network and Automation flow draw "weak" lines across the whole city. When these were 0.035
// wide at 0.22 opacity, switching views changed nothing you could see at the overview zoom.
// At 0.17 wide they read as thick pipes, so the lines are thin again and stay near solid instead.
it("draws view lines thin but solid enough to see with the whole city in frame", () => {
  expect(RADIUS).toBeGreaterThanOrEqual(0.03);
  expect(RADIUS).toBeLessThanOrEqual(0.05);
  expect(OPACITY.weak).toBeGreaterThanOrEqual(0.7);
  expect(OPACITY.strong).toBeGreaterThan(OPACITY.weak);
  expect(OPACITY.dim).toBeLessThan(0.1);
});
