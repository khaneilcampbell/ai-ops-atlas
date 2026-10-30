import { describe, expect, it } from "vitest";
import { isBusy, profileFor, wake } from "./power";

describe("power profiles", () => {
  it("keeps full quality unless Battery saver is chosen or Automatic is on battery", () => {
    expect(profileFor("full", true).idleFps).toBe(Infinity);
    expect(profileFor("balanced", true)).toMatchObject({ idleFps: 30, maxDpr: 2, shadowMap: 4096, pauseInBackground: false });
    expect(profileFor("auto", false)).toEqual(profileFor("balanced", false));
    expect(profileFor("auto", null)).toEqual(profileFor("balanced", null));
    expect(profileFor("auto", true)).toEqual(profileFor("saver", true));
    expect(profileFor("saver", false).pauseInBackground).toBe(true);
  });

  it("stays busy for the time asked, and never shortens a longer spell", () => {
    const now = performance.now();
    wake(1000);
    wake(10);
    expect(isBusy(now + 900)).toBe(true);
    expect(isBusy(now + 1100)).toBe(false);
  });
});
