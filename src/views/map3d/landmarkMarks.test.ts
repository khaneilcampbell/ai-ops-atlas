import { describe, expect, it } from "vitest";
import { landmarkMark } from "./landmarkMarks";

describe("landmark status dot", () => {
  it("is green only for healthy telemetry, amber for partial, red for failing", () => {
    expect(landmarkMark("good", "Live")).toEqual({ kind: "passing", label: "Live" });
    expect(landmarkMark("warn", "Partly live")).toEqual({ kind: "running", label: "Partly live" });
    expect(landmarkMark("bad", "CI failing")).toEqual({ kind: "failing", label: "CI failing" });
  });

  it("leaves a building with nothing connected or verified on the planned dot", () => {
    expect(landmarkMark("unknown", "Not verified")).toBeUndefined();
  });
});
