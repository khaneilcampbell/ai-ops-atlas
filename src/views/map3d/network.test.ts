import { expect, it } from "vitest";
import { OPACITY, RADIUS } from "./network";

// Agent network and Automation flow draw "weak" lines across the whole city. When these were 0.035
// wide at 0.22 opacity, switching views changed nothing you could see at the overview zoom.
it("draws view lines thick and solid enough to see with the whole city in frame", () => {
  expect(RADIUS).toBeGreaterThanOrEqual(0.15);
  expect(OPACITY.weak).toBeGreaterThanOrEqual(0.7);
  expect(OPACITY.strong).toBeGreaterThan(OPACITY.weak);
  expect(OPACITY.dim).toBeLessThan(0.1);
});
