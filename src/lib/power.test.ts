import { describe, expect, it } from "vitest";
import { isBusy, pacingPolicy, profileFor, wake } from "./power";

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

describe("frame scheduling policy", () => {
  it("suspends hidden and covered canvases even in Best mode", () => {
    const p = profileFor("full", false);
    expect(pacingPolicy(p, true, true, false, "demand").active).toBe(false);
    expect(pacingPolicy(p, false, true, true, "never").active).toBe(false);
  });
  it("keeps static scenes interactive without idle frames", () => {
    expect(pacingPolicy(profileFor("balanced", false), false, true, true, "demand")).toEqual({active: true, idle: 0});
  });
  it("retains background saver and normal foreground animation rates", () => {
    expect(pacingPolicy(profileFor("saver", false), true, false, true, "demand").idle).toBe(0);
    expect(pacingPolicy(profileFor("balanced", false), true, true, true, "demand").idle).toBe(30);
  });
});
