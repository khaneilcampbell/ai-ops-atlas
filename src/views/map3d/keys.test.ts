import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HeldKeys, INTERIOR_CONTROLS, isStill, KEY_RATES, keyStep, MAP_CONTROLS, navKeyOf, typingTarget, type KeySample, type NavKey } from "./keys";
import { orbitRig, panRig, type Rig } from "./trackpad";

function key(over: Partial<KeySample>): KeySample {
  return { key: "", code: "", shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...over };
}

describe("navKeyOf", () => {
  it("maps W A S D by position and R F to tilt, on the map and inside", () => {
    for (const ctx of ["map", "interior"] as const) {
      expect(navKeyOf(key({ key: "w", code: "KeyW" }), ctx)).toBe("forward");
      expect(navKeyOf(key({ key: "a", code: "KeyA" }), ctx)).toBe("left");
      expect(navKeyOf(key({ key: "s", code: "KeyS" }), ctx)).toBe("back");
      expect(navKeyOf(key({ key: "d", code: "KeyD" }), ctx)).toBe("right");
      expect(navKeyOf(key({ key: "r", code: "KeyR" }), ctx)).toBe("tiltDown");
      expect(navKeyOf(key({ key: "f", code: "KeyF" }), ctx)).toBe("tiltUp");
      // Caps lock or Shift still the same key.
      expect(navKeyOf(key({ key: "W", code: "KeyW", shiftKey: true }), ctx)).toBe("forward");
    }
  });

  it("leaves plain arrows, Q, E, plus and minus to the map view, which already steps with them", () => {
    expect(navKeyOf(key({ key: "ArrowUp", code: "ArrowUp" }), "map")).toBeNull();
    expect(navKeyOf(key({ key: "q", code: "KeyQ" }), "map")).toBeNull();
    expect(navKeyOf(key({ key: "e", code: "KeyE" }), "map")).toBeNull();
    expect(navKeyOf(key({ key: "+", code: "Equal" }), "map")).toBeNull();
    expect(navKeyOf(key({ key: "i", code: "KeyI" }), "map")).toBeNull();
  });

  it("moves the map with Shift and an arrow", () => {
    expect(navKeyOf(key({ key: "ArrowLeft", shiftKey: true }), "map")).toBe("left");
    expect(navKeyOf(key({ key: "ArrowDown", shiftKey: true }), "map")).toBe("back");
  });

  it("inside a building takes plain arrows, Q E to turn, and plus minus to zoom", () => {
    expect(navKeyOf(key({ key: "ArrowUp" }), "interior")).toBe("forward");
    expect(navKeyOf(key({ key: "q", code: "KeyQ" }), "interior")).toBe("turnLeft");
    expect(navKeyOf(key({ key: "e", code: "KeyE" }), "interior")).toBe("turnRight");
    expect(navKeyOf(key({ key: "=", code: "Equal" }), "interior")).toBe("zoomIn");
    expect(navKeyOf(key({ key: "-", code: "Minus" }), "interior")).toBe("zoomOut");
  });

  it("never takes Mac shortcuts", () => {
    expect(navKeyOf(key({ key: "w", code: "KeyW", metaKey: true }), "interior")).toBeNull();
    expect(navKeyOf(key({ key: "a", code: "KeyA", ctrlKey: true }), "map")).toBeNull();
    expect(navKeyOf(key({ key: "s", code: "KeyS", altKey: true }), "map")).toBeNull();
  });
});

describe("keyStep", () => {
  const held = (...k: NavKey[]) => new Set<NavKey>(k);

  it("moves at a rate per second, whatever the frame rate", () => {
    const one = keyStep(held("right"), 16);
    const many = [0, 1, 2, 3].reduce((sum) => sum + keyStep(held("right"), 4).dx, 0);
    expect(one.dx).toBeCloseTo(many, 6);
    expect(keyStep(held("right"), 1000 / 60).dx * 60).toBeCloseTo(KEY_RATES.pan, 0);
  });

  it("caps a long frame so a hidden tab doesn't fling the view", () => {
    expect(keyStep(held("forward"), 5000).dy).toBeCloseTo(keyStep(held("forward"), KEY_RATES.maxFrameMs).dy);
  });

  it("cancels opposite keys and keeps diagonals at straight speed", () => {
    expect(isStill(keyStep(held("left", "right", "forward", "back"), 16))).toBe(true);
    const d = keyStep(held("forward", "right"), 16);
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(keyStep(held("right"), 16).dx);
  });

  it("follows the speed setting", () => {
    expect(keyStep(held("turnLeft"), 16, 1.6).azimuth).toBeCloseTo(keyStep(held("turnLeft"), 16).azimuth * 1.6);
  });

  it("zooms in and out by the same factor", () => {
    const zin = keyStep(held("zoomIn"), 32).zoom;
    const zout = keyStep(held("zoomOut"), 32).zoom;
    expect(zin).toBeGreaterThan(1);
    expect(zin * zout).toBeCloseTo(1);
  });

  it("moves the camera the way the keys say, with the trackpad camera functions", () => {
    const r: Rig = { target: new THREE.Vector3(0, 0, 0), position: new THREE.Vector3(0, 20, 20) };
    // The camera looks toward -z. W moves forward: toward -z.
    const w = keyStep(held("forward"), 32);
    panRig(r, 40, 800, w.dx, w.dy);
    expect(r.target.z).toBeLessThan(0);
    expect(r.target.x).toBeCloseTo(0);
    // D moves right: toward +x when looking toward -z.
    const d = keyStep(held("right"), 32);
    panRig(r, 40, 800, d.dx, d.dy);
    expect(r.target.x).toBeGreaterThan(0);
    // F tilts toward the horizon: the camera comes down.
    const y0 = r.position.y;
    const f = keyStep(held("tiltUp"), 32);
    orbitRig(r, f.azimuth, f.polar, 0.2, 1.3);
    expect(r.position.y).toBeLessThan(y0);
    // Q turns the same way as the map's Q (rotate +45): the view direction turns counterclockwise from above.
    const before = r.position.clone().sub(r.target);
    const q = keyStep(held("turnLeft"), 32);
    orbitRig(r, q.azimuth, q.polar, 0.2, 1.3);
    const after = r.position.clone().sub(r.target);
    const expected = before.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), q.azimuth);
    expect(after.x).toBeCloseTo(expected.x);
    expect(after.z).toBeCloseTo(expected.z);
    expect(q.azimuth).toBeGreaterThan(0);
  });
});

describe("HeldKeys", () => {
  function harness() {
    const calls: { keys: NavKey[]; dt: number }[] = [];
    let queued: ((t: number) => void) | null = null;
    const h = new HeldKeys(
      (k, dt) => calls.push({ keys: [...k], dt }),
      (cb) => {
        queued = cb;
        return 1;
      },
      () => (queued = null),
    );
    const frame = (t: number) => {
      const cb = queued;
      queued = null;
      cb?.(t);
    };
    return { h, calls, frame, pending: () => queued !== null };
  }

  it("nudges on press, then moves every frame until released", () => {
    const { h, calls, frame, pending } = harness();
    h.press("forward", 0);
    expect(calls).toEqual([{ keys: ["forward"], dt: 16 }]);
    frame(16);
    frame(33);
    expect(calls.map((c) => c.dt)).toEqual([16, 16, 17]);
    h.release("forward");
    expect(pending()).toBe(false);
  });

  it("ignores key repeat and keeps one frame loop for several keys", () => {
    const { h, calls } = harness();
    h.press("forward", 0);
    h.press("forward", 5);
    h.press("left", 6);
    expect(calls.length).toBe(1);
    expect(h.size).toBe(2);
  });

  it("lets everything go at once, for a window that lost focus", () => {
    const { h, pending } = harness();
    h.press("forward", 0);
    h.press("turnLeft", 0);
    h.releaseAll();
    expect(h.size).toBe(0);
    expect(pending()).toBe(false);
  });
});

describe("typingTarget", () => {
  it("is false for nothing and for objects with no closest", () => {
    expect(typingTarget(null)).toBe(false);
    expect(typingTarget({} as EventTarget)).toBe(false);
  });
  it("asks the element whether it sits in a field", () => {
    const at = (match: boolean) => ({ closest: () => (match ? {} : null) }) as unknown as EventTarget;
    expect(typingTarget(at(true))).toBe(true);
    expect(typingTarget(at(false))).toBe(false);
  });
});

describe("controls help", () => {
  it("gives every action a MacBook and an iMac way", () => {
    for (const r of [...MAP_CONTROLS, ...INTERIOR_CONTROLS]) {
      expect(r.trackpad.length).toBeGreaterThan(0);
      expect(r.mouse.length).toBeGreaterThan(0);
    }
    // Every trackpad-only gesture has a mouse or keyboard way.
    const mouse = [...MAP_CONTROLS, ...INTERIOR_CONTROLS].map((r) => r.mouse).join(" ");
    for (const way of ["Drag", "Command with a scroll", "Q and E", "R and F", "W A S D"]) expect(mouse).toContain(way);
  });
});
