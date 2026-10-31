import { describe, expect, it } from "vitest";
import { mergeSegments } from "./mergeSegments";

describe("mergeSegments", () => {
  it("joins a straight run into one segment", () => {
    const segs = [0, 1, 2, 3].map((i) => ({ a: [i, 0] as [number, number], b: [i + 1, 0] as [number, number] }));
    expect(mergeSegments(segs)).toEqual([{ a: [0, 0], b: [4, 0] }]);
  });

  it("keeps bends apart", () => {
    const segs = [
      { a: [0, 0] as [number, number], b: [1, 0] as [number, number] },
      { a: [1, 0] as [number, number], b: [2, 1] as [number, number] },
    ];
    expect(mergeSegments(segs)).toHaveLength(2);
  });

  it("keeps gaps apart, so junction openings stay open", () => {
    const segs = [
      { a: [0, 0] as [number, number], b: [1, 0] as [number, number] },
      { a: [1.5, 0] as [number, number], b: [2, 0] as [number, number] },
    ];
    expect(mergeSegments(segs)).toHaveLength(2);
  });

  it("doesn't change the input", () => {
    const segs = [
      { a: [0, 0] as [number, number], b: [1, 0] as [number, number] },
      { a: [1, 0] as [number, number], b: [2, 0] as [number, number] },
    ];
    mergeSegments(segs);
    expect(segs[0].b).toEqual([1, 0]);
  });
});
