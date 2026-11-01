import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { isBusy, onWake, pacingPolicy, usePageVisible, useWindowFocused, wake, type PowerProfile } from "../../lib/power";
import { feed } from "../../lib/governor";

/**
 * Paces an on-demand canvas (frameloop "demand") to the power profile: every display frame
 * while something is being moved (see wake()), and the profile's idle rate while only the
 * background life moves. Between idle frames it sleeps on a timer rather than waking for every
 * display refresh. Also redraws the shadow map at the profile's rate instead of every frame:
 * the sun never moves, so camera moves alone never change it.
 *
 * `running` false: no idle frames at all; the canvas still redraws on changes and while busy.
 */
export function FramePacer({ profile, running }: { profile: PowerProfile; running: boolean }) {
  const { invalidate, gl, frameloop } = useThree();
  const visible = usePageVisible();
  const focused = useWindowFocused();

  useEffect(() => {
    gl.shadowMap.autoUpdate = profile.shadowHz === Infinity;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, profile.shadowHz]);
  const lastShadow = useRef(-Infinity);
  // Frames drawn back to back (while busy, or every frame on Best) tell the quality governor how
  // long a frame really takes; paced idle frames don't.
  const lastFrame = useRef<{ t: number; busy: boolean }>({ t: -Infinity, busy: false });
  useFrame(() => {
    const now = performance.now();
    const busy = isBusy(now) || profile.idleFps === Infinity;
    if (busy && lastFrame.current.busy) feed(now - lastFrame.current.t, now);
    lastFrame.current = { t: now, busy };
  });
  useFrame(() => {
    if (gl.shadowMap.autoUpdate) return;
    const now = performance.now();
    if (now - lastShadow.current < 1000 / profile.shadowHz - 4) return;
    lastShadow.current = now;
    gl.shadowMap.needsUpdate = true;
  });

  // Moving the camera with the pointer or the wheel draws at full rate; the controls' own
  // easing after a release keeps it busy through their change events.
  useEffect(() => {
    const el = gl.domElement;
    const drag = (e: PointerEvent) => e.buttons && wake(600);
    const touch = () => wake(600);
    el.addEventListener("pointerdown", touch);
    el.addEventListener("pointermove", drag);
    el.addEventListener("pointerup", touch);
    el.addEventListener("wheel", touch, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", touch);
      el.removeEventListener("pointermove", drag);
      el.removeEventListener("pointerup", touch);
      el.removeEventListener("wheel", touch);
    };
  }, [gl]);

  const { active, idle } = pacingPolicy(profile, running, focused, visible, frameloop);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = -Infinity;
    const frame = (t: number) => {
      raf = 0;
      invalidate();
      last = t;
      schedule();
    };
    const schedule = () => {
      if (raf || timer) return;
      if (idle === Infinity || isBusy()) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (!idle) return;
      const wait = Math.max(0, last + 1000 / idle - performance.now() - 4);
      timer = setTimeout(() => {
        timer = undefined;
        raf = requestAnimationFrame(frame);
      }, wait);
    };
    const kick = () => {
      clearTimeout(timer);
      timer = undefined;
      schedule();
    };
    const off = onWake(kick);
    invalidate();
    schedule();
    return () => {
      off();
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [active, idle, invalidate]);
  return null;
}
