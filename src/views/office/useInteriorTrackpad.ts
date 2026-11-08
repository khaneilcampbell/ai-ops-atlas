import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { getNavigationPrefs, speedFactor } from "../../lib/navigation";
import { clampToRoom, groundAt, interiorIntent, likelyMacTrackpad, orbitRig, panRig, twistStep, twistToAzimuth, WheelClassifier, zoomRigAt } from "../map3d/trackpad";

/** The parts of an OrbitControls (three's or drei's) the gestures move. */
export interface InteriorControls {
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  update: () => unknown;
}

/**
 * Mac trackpad gestures inside a building, for every interior (see interiorIntent in trackpad.ts):
 * two-finger scroll looks around the room through a full circle and tilts, pinch zooms toward
 * the fingers, twist turns, and Option with a scroll walks the view across the floor. A mouse
 * wheel is left to the controls, and the Map navigation setting applies here too.
 *
 * Listens in the capture phase on the canvas's own wrapper, so a scroll over a room label still
 * turns the room and the controls don't also zoom. Draws only while gestures arrive: the canvas
 * stays on demand.
 *
 * `controls` returns the scene's controls once they exist. `reach` is the room's half-size, which
 * the point looked at can't leave. `onMove` runs on every gesture step, for a camera that glides
 * and should stop gliding when the person takes over.
 */
export function useInteriorTrackpad(controls: () => InteriorControls | null | undefined, reach: { x: number; z: number }, onMove?: () => void) {
  const { camera, gl, invalidate } = useThree();
  const wheels = useMemo(() => new WheelClassifier(likelyMacTrackpad(typeof navigator === "undefined" ? undefined : navigator) ? "trackpad" : "mouse"), []);
  const latest = useRef({ controls, reach, onMove });
  latest.current = { controls, reach, onMove };
  useEffect(() => {
    const el = gl.domElement.parentElement ?? gl.domElement;
    const cam = camera as THREE.PerspectiveCamera;
    const rigOf = () => {
      const c = latest.current.controls();
      return c ? { c, rig: { target: c.target, position: camera.position } } : null;
    };
    const moved = (c: InteriorControls, rig: { target: THREE.Vector3; position: THREE.Vector3 }) => {
      clampToRoom(rig, latest.current.reach);
      latest.current.onMove?.();
      c.update();
      invalidate();
    };
    const zoomAt = (c: InteriorControls, rig: { target: THREE.Vector3; position: THREE.Vector3 }, factor: number, x: number, y: number) => {
      const r = gl.domElement.getBoundingClientRect();
      const anchor = groundAt(camera, c.target, ((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      zoomRigAt(rig, anchor, factor, c.minDistance, c.maxDistance);
    };
    const look = (c: InteriorControls, rig: { target: THREE.Vector3; position: THREE.Vector3 }, azimuth: number, polar: number) =>
      orbitRig(rig, azimuth, polar, c.minPolarAngle, c.maxPolarAngle);

    let lastGesture = -Infinity;
    const gesturing = () => performance.now() - lastGesture < 200;
    const onWheel = (e: WheelEvent) => {
      if (!e.isTrusted) return;
      const p = getNavigationPrefs();
      const intent = interiorIntent(e, wheels, p.scroll, speedFactor(p.speed), gesturing(), el.clientHeight);
      if (intent.kind === "pass") return;
      e.preventDefault();
      e.stopPropagation();
      const at = rigOf();
      if (intent.kind === "drop" || !at) return;
      const { c, rig } = at;
      if (intent.kind === "look") look(c, rig, intent.azimuth, intent.polar);
      else if (intent.kind === "move") panRig(rig, cam.fov, gl.domElement.clientHeight, intent.dx, intent.dy);
      else zoomAt(c, rig, intent.factor, e.clientX, e.clientY);
      moved(c, rig);
    };
    // Safari and the Mac app send pinch and twist as gesture events. Touch screens send them too,
    // and their controls already pinch, so only a pointer-only Mac listens.
    const pointerOnly = typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) === 0;
    type Gesture = Event & { scale: number; rotation: number; clientX: number; clientY: number };
    let scale = 1;
    let twist = 0;
    const onGestureStart = (ev: Event) => {
      ev.preventDefault();
      lastGesture = performance.now();
      scale = 1;
      twist = 0;
      wheels.sawPinch();
    };
    const onGestureChange = (ev: Event) => {
      const e = ev as Gesture;
      e.preventDefault();
      lastGesture = performance.now();
      const at = rigOf();
      if (!at) return;
      const { c, rig } = at;
      const speed = speedFactor(getNavigationPrefs().speed);
      const ratio = e.scale / scale;
      scale = e.scale;
      if (ratio > 0 && Math.abs(ratio - 1) > 1e-4) zoomAt(c, rig, Math.pow(ratio, speed), e.clientX, e.clientY);
      const step = twistStep(twist, e.rotation);
      twist = e.rotation;
      if (step) look(c, rig, twistToAzimuth(step), 0);
      moved(c, rig);
    };
    const onGestureEnd = (ev: Event) => {
      ev.preventDefault();
      lastGesture = performance.now();
    };
    const onPointerDown = () => wheels.interrupt();
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    el.addEventListener("pointerdown", onPointerDown, { capture: true });
    if (pointerOnly) {
      el.addEventListener("gesturestart", onGestureStart);
      el.addEventListener("gesturechange", onGestureChange);
      el.addEventListener("gestureend", onGestureEnd);
    }
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, [camera, gl, invalidate, wheels]);
}

/** The "how to move" line under an interior: the trackpad gestures on a Mac, drag and scroll elsewhere. */
export function lookHint(): string {
  const mac = likelyMacTrackpad(typeof navigator === "undefined" ? undefined : navigator);
  return mac && getNavigationPrefs().scroll !== "zoom" ? "Two fingers to look around · Pinch to zoom" : "Drag to orbit · Scroll to zoom";
}
