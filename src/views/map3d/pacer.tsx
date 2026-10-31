import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { isBusy, onWake, useWindowFocused, wake, type PowerProfile } from "../../lib/power";

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
  const { invalidate, gl } = useThree();
  const focused = useWindowFocused();

  useEffect(() => {
    gl.shadowMap.autoUpdate = profile.shadowHz === Infinity;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, profile.shadowHz]);
  const lastShadow = useRef(-Infinity);
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

  const idle = !running || (profile.pauseInBackground && !focused) ? 0 : profile.idleFps;
  useEffect(() => {
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
  }, [idle, invalidate]);
  return null;
}
