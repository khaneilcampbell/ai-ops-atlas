import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { clampRig, evidence, groundAt, likelyMacTrackpad, orbitRig, panRig, twistStep, twistToAzimuth, WheelClassifier, wheelIntent, zoomRigAt, type Rig, type WheelSample } from "./trackpad";

const FOV = 40;
const W = 1200;
const H = 800;

function rig(): Rig {
  return { target: new THREE.Vector3(0, 0, 0), position: new THREE.Vector3(20, 25, 20) };
}

/** A camera looking from the rig, the way MapControls would set it. */
function cam(r: Rig) {
  const c = new THREE.PerspectiveCamera(FOV, W / H, 0.5, 800);
  c.position.copy(r.position);
  c.lookAt(r.target);
  c.updateMatrixWorld();
  return c;
}

/** Where a world point lands on screen, in pixels from the top left. */
function screen(r: Rig, p: THREE.Vector3) {
  const v = p.clone().project(cam(r));
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
}

function wheel(over: Partial<WheelSample> = {}): WheelSample {
  return { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, altKey: false, shiftKey: false, timeStamp: 0, ...over };
}

describe("telling a trackpad from a mouse wheel", () => {
  it("reads hard evidence from single events", () => {
    expect(evidence(wheel({ deltaY: 3, deltaMode: 1 }))).toBe("mouse");
    expect(evidence(wheel({ deltaX: 2, deltaY: 7 }))).toBe("trackpad");
    expect(evidence(wheel({ deltaY: 4.000244140625 * 3 }))).toBe("mouse");
    // Shift turns a mouse wheel sideways, so sideways with Shift proves nothing.
    expect(evidence(wheel({ deltaX: 40, shiftKey: true }))).toBeNull();
    expect(evidence(wheel({ deltaY: 6 }))).toBeNull();
  });

  it("keeps one kind for a whole flick, momentum included, and upgrades on sideways jitter", () => {
    const c = new WheelClassifier("mouse");
    expect(c.classify(wheel({ deltaY: 5, timeStamp: 0 })).kind).toBe("mouse");
    expect(c.classify(wheel({ deltaY: 6, deltaX: 1, timeStamp: 16 })).kind).toBe("trackpad");
    // Momentum: straight down and slowing, still the same gesture.
    for (let t = 32; t < 1000; t += 16) expect(c.classify(wheel({ deltaY: 2, timeStamp: t })).kind).toBe("trackpad");
    // A later gesture with no evidence of its own uses what was proven.
    expect(c.classify(wheel({ deltaY: 3, timeStamp: 2000 })).kind).toBe("trackpad");
  });

  it("reads a big single step as a wheel notch, and remembers a proven mouse", () => {
    const c = new WheelClassifier("trackpad");
    expect(c.classify(wheel({ deltaY: 120, timeStamp: 0 })).kind).toBe("mouse");
    expect(c.classify(wheel({ deltaY: 2, deltaMode: 1, timeStamp: 1000 })).kind).toBe("mouse");
    expect(c.classify(wheel({ deltaY: 4, timeStamp: 2000 })).kind).toBe("mouse");
  });

  it("drops the rest of a flick after an interruption, and starts fresh after a pause", () => {
    const c = new WheelClassifier("trackpad");
    expect(c.classify(wheel({ deltaY: 5, timeStamp: 0 })).stale).toBe(false);
    c.interrupt();
    expect(c.classify(wheel({ deltaY: 3, timeStamp: 16 })).stale).toBe(true);
    expect(c.classify(wheel({ deltaY: 3, timeStamp: 600 })).stale).toBe(false);
  });

  it("guesses a trackpad on a Mac but not on an iPad or a PC", () => {
    expect(likelyMacTrackpad({ platform: "MacIntel", maxTouchPoints: 0 })).toBe(true);
    expect(likelyMacTrackpad({ platform: "MacIntel", maxTouchPoints: 5 })).toBe(false);
    expect(likelyMacTrackpad({ platform: "Win32", maxTouchPoints: 0 })).toBe(false);
    expect(likelyMacTrackpad(undefined)).toBe(false);
  });
});

describe("what a wheel event does", () => {
  it("pans for a trackpad scroll and passes a mouse wheel to the controls", () => {
    expect(wheelIntent(wheel({ deltaX: 3, deltaY: 10 }), new WheelClassifier("trackpad"), "auto", 1, false)).toEqual({ kind: "pan", dx: 3, dy: 10 });
    expect(wheelIntent(wheel({ deltaY: 120 }), new WheelClassifier("trackpad"), "auto", 1, false)).toEqual({ kind: "pass" });
  });

  it("follows the setting over the guess", () => {
    expect(wheelIntent(wheel({ deltaY: 120 }), new WheelClassifier("mouse"), "pan", 1, false).kind).toBe("pan");
    expect(wheelIntent(wheel({ deltaX: 3, deltaY: 10 }), new WheelClassifier("trackpad"), "zoom", 1, false).kind).toBe("pass");
  });

  it("zooms for a pinch, in proportion to the fingers, and never in big jumps", () => {
    const c = new WheelClassifier("trackpad");
    const i = wheelIntent(wheel({ ctrlKey: true, deltaY: -10 }), c, "auto", 1, false);
    expect(i.kind).toBe("zoom");
    expect(i.kind === "zoom" && i.factor).toBeCloseTo(Math.exp(0.1));
    const big = wheelIntent(wheel({ ctrlKey: true, deltaY: 500, timeStamp: 1000 }), c, "zoom", 1, false);
    expect(big.kind === "zoom" && big.factor).toBeCloseTo(0.5);
    // A WebKit pinch is already zooming through gesture events.
    expect(wheelIntent(wheel({ ctrlKey: true, deltaY: -10 }), c, "auto", 1, true)).toEqual({ kind: "drop" });
  });

  it("turns and tilts with Option, and scales with the speed setting", () => {
    const i = wheelIntent(wheel({ altKey: true, deltaX: 10, deltaY: -20 }), new WheelClassifier("mouse"), "zoom", 2, false);
    expect(i.kind).toBe("orbit");
    if (i.kind !== "orbit") return;
    expect(i.azimuth).toBeCloseTo(0.1);
    expect(i.polar).toBeCloseTo(-0.16);
  });

  it("converts line deltas to pixels", () => {
    expect(wheelIntent(wheel({ deltaY: 3, deltaMode: 1 }), new WheelClassifier("mouse"), "pan", 1, false)).toEqual({ kind: "pan", dx: 0, dy: 48 });
  });

  it("drops the momentum tail after an interruption, but not a pinch", () => {
    const c = new WheelClassifier("trackpad");
    wheelIntent(wheel({ deltaY: 8 }), c, "auto", 1, false);
    c.interrupt();
    expect(wheelIntent(wheel({ deltaY: 4, timeStamp: 16 }), c, "auto", 1, false)).toEqual({ kind: "drop" });
    expect(wheelIntent(wheel({ ctrlKey: true, deltaY: -4, timeStamp: 32 }), c, "auto", 1, false).kind).toBe("zoom");
  });
});

describe("twist dead zone", () => {
  it("ignores small twists, then turns smoothly from zero", () => {
    expect(twistStep(0, 5)).toBe(0);
    expect(twistStep(5, 10)).toBeCloseTo(2);
    expect(twistStep(10, 20)).toBeCloseTo(10);
    expect(twistStep(0, -12)).toBeCloseTo(-4);
    // Summed over a gesture, it is the total less the dead zone.
    let sum = 0;
    let prev = 0;
    for (const r of [3, 7, 11, 15, 30]) {
      sum += twistStep(prev, r);
      prev = r;
    }
    expect(sum).toBeCloseTo(22);
  });
});

describe("camera moves", () => {
  it("pan keeps the ground under the fingers and the viewing angle", () => {
    const r = rig();
    const ground = new THREE.Vector3(0, 0, 0);
    const before = screen(r, ground);
    const dir = r.position.clone().sub(r.target).normalize();
    // Fingers left (natural scrolling): the ground moves left with them, pixel for pixel.
    panRig(r, FOV, H, 10, 0);
    const after = screen(r, ground);
    expect(before.x - after.x).toBeCloseTo(10, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    // Fingers up: the ground moves up with them.
    panRig(r, FOV, H, 0, 10);
    const up = screen(r, ground);
    expect(after.y - up.y).toBeCloseTo(10, 0);
    expect(up.x).toBeCloseTo(after.x, 0);
    expect(r.position.clone().sub(r.target).normalize().distanceTo(dir)).toBeLessThan(1e-9);
    expect(r.target.y).toBe(0);
  });

  it("zoom keeps the point under the cursor in place and stays within limits", () => {
    const r = rig();
    const c = cam(r);
    const anchor = groundAt(c, r.target, 0.4, -0.3)!;
    expect(anchor).not.toBeNull();
    const before = screen(r, anchor);
    zoomRigAt(r, anchor, 1.5, 4, 100);
    const after = screen(r, anchor);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
    expect(r.position.distanceTo(r.target)).toBeCloseTo(Math.hypot(20, 25, 20) / 1.5);
    zoomRigAt(r, anchor, 1000, 4, 100);
    expect(r.position.distanceTo(r.target)).toBeCloseTo(4);
    zoomRigAt(r, null, 0.0001, 4, 100);
    expect(r.position.distanceTo(r.target)).toBeCloseTo(100);
  });

  it("finds no ground in the sky", () => {
    // A low view, so the top of the screen is above the horizon.
    const r: Rig = { target: new THREE.Vector3(0, 0, 0), position: new THREE.Vector3(30, 4, 30) };
    expect(groundAt(cam(r), r.target, 0, 0.99)).toBeNull();
    expect(groundAt(cam(r), r.target, 0, -0.5)).not.toBeNull();
  });

  it("Option-scroll sideways moves the ground in front with the fingers, and tilt stays in limits", () => {
    const r = rig();
    const front = r.target.clone().add(r.position.clone().sub(r.target).setY(0).normalize().multiplyScalar(6));
    const before = screen(r, front);
    orbitRig(r, 0.2, 0, 0.2, 1.25);
    const after = screen(r, front);
    // Fingers moving left (positive deltaX): the near ground moves left.
    expect(after.x).toBeLessThan(before.x - 5);
    const d = r.position.distanceTo(r.target);
    orbitRig(r, 0, 10, 0.2, 1.25);
    expect(new THREE.Spherical().setFromVector3(r.position.clone().sub(r.target)).phi).toBeCloseTo(1.25);
    orbitRig(r, 0, -10, 0.2, 1.25);
    expect(new THREE.Spherical().setFromVector3(r.position.clone().sub(r.target)).phi).toBeCloseTo(0.2);
    expect(r.position.distanceTo(r.target)).toBeCloseTo(d);
  });

  it("a clockwise twist turns the map clockwise on screen", () => {
    const r = rig();
    // A ground point to the right of the point looked at.
    const c = cam(r);
    const right = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0).setY(0).normalize().multiplyScalar(6);
    const before = screen(r, right);
    const mid = screen(r, r.target);
    expect(before.x).toBeGreaterThan(mid.x + 5);
    orbitRig(r, twistToAzimuth(15), 0, 0.2, 1.25);
    // Clockwise on screen (y grows downward): a point at three o'clock moves down.
    expect(screen(r, right).y).toBeGreaterThan(before.y + 5);
  });

  it("keeps the view over the island when a flick goes too far", () => {
    const r = rig();
    panRig(r, FOV, H, 100000, 0);
    const offset = r.position.clone().sub(r.target);
    clampRig(r, { x0: -50, x1: 50, z0: -50, z1: 50 }, 10);
    expect(Math.abs(r.target.x)).toBeLessThanOrEqual(60);
    expect(Math.abs(r.target.z)).toBeLessThanOrEqual(60);
    expect(r.position.clone().sub(r.target).distanceTo(offset)).toBeLessThan(1e-9);
  });
});
