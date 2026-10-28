import { describe, expect, it } from "vitest";
import { resetsIn } from "./time";

describe("resetsIn", () => {
  const now = Date.parse("2026-10-28T07:00:00Z");
  const sec = (iso: string) => Date.parse(iso) / 1000;

  it("counts minutes up to the reset", () => {
    expect(resetsIn(sec("2026-10-28T07:12:10Z"), now)).toBe("Resets in 13 min");
  });
  it("switches to hours past an hour", () => {
    expect(resetsIn(sec("2026-10-28T09:00:00Z"), now)).toBe("Resets in 2 h");
  });
  it("says the next refresh once the reset time has passed", () => {
    expect(resetsIn(sec("2026-10-28T06:59:00Z"), now)).toBe("Resets at the next refresh");
  });
});
