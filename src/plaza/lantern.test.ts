import { describe, expect, it } from "vitest";
import { LANTERN, lanternState } from "./lantern";

describe("lantern night colour", () => {
  it("follows the status, attention first, and never guesses without live data", () => {
    expect(lanternState({ connection: "unavailable", running: 3, attention: 2 })).toBe("unavailable");
    expect(lanternState({ connection: "live", running: 3, attention: 1 })).toBe("attention");
    expect(lanternState({ connection: "live", running: 2, attention: 0 })).toBe("running");
    expect(lanternState({ connection: "live", running: 0, attention: 0 })).toBe("idle");
  });
  it("flashes green only for a live completion, and gives the sample preview its own colour", () => {
    expect(lanternState({ connection: "live", running: 1, attention: 1 }, true)).toBe("completed");
    expect(lanternState({ connection: "unavailable", running: 0, attention: 0 }, true)).toBe("unavailable");
    expect(lanternState({ connection: "live", preview: true, running: 2, attention: 1 }, true)).toBe("preview");
  });
  it("gives every state its own colour", () => {
    expect(new Set(Object.values(LANTERN)).size).toBe(Object.keys(LANTERN).length);
  });
});
