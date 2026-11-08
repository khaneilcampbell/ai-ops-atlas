import { describe, expect, it } from "vitest";
import { initialGovernor, step, type GovernorState } from "./governor";

const run = (st: GovernorState, gap: number, from: number, frames: number) => {
  let t = from;
  for (let i = 0; i < frames; i++) {
    t += gap;
    st = step(st, gap, t);
  }
  return { st, t };
};

describe("quality governor", () => {
  it("stays at the chosen quality while frames are fast", () => {
    expect(run(initialGovernor(), 16, 0, 200).st.level).toBe(0);
  });

  it("steps down when frames are slower than 25 fps", () => {
    expect(run(initialGovernor(), 60, 0, 30).st.level).toBe(1);
  });

  it("waits between steps down, and stops at the lightest level", () => {
    const one = run(initialGovernor(), 60, 0, 30);
    expect(run(one.st, 60, one.t, 30).st.level).toBe(1); // 1.8 s later: still cooling down
    let s = one;
    for (let i = 0; i < 10; i++) s = run(s.st, 100, s.t, 30);
    expect(s.st.level).toBe(3);
  });

  it("steps back up only after 10 s of fast frames", () => {
    const slow = run(initialGovernor(), 60, 0, 30);
    expect(run(slow.st, 16, slow.t, 300).st.level).toBe(1); // ~5 s
    expect(run(slow.st, 16, slow.t, 800).st.level).toBe(0); // ~13 s
  });

  it("ignores pauses and paced idle frames", () => {
    expect(run(initialGovernor(), 1000, 0, 100).st.level).toBe(0);
  });

  it("doesn't flicker on in-between frame times", () => {
    const slow = run(initialGovernor(), 60, 0, 30);
    expect(run(slow.st, 30, slow.t, 1000).st.level).toBe(1);
  });
});
