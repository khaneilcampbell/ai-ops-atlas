import * as THREE from "three";
import { clamp01, distanceGain, EventLimiter, flightSound, jetThrust, newFlightState, stereoPan, trafficLevel, zoneWeight, type CityEvent, type CityEventKind, type FlightSound, type FlightState } from "./citySound";
import { SOUND_TAG_KEY, soundScene, ZONE_TAG_KEY, type ZoneKind } from "./listener";
import { ZoneSounds } from "./zones";

/**
 * The city soundscape, made entirely in the browser with Web Audio: filtered noise for traffic,
 * wind and passing jets, and short sine and triangle tones for birds, crickets and automation
 * events. No recordings are shipped, so there are no third-party audio licences to track.
 *
 * Two layers under one master volume:
 *  - ambience: a soft traffic hum, occasional cars passing, birds by day and crickets
 *    by night, and a voice for every jet in flight, placed by where it is relative to the camera;
 *  - automation: one soft tone per real event (start, handoff, complete, needs attention), placed
 *    at the agent's building and limited so bursts stay calm.
 *
 * Zoomed in on a place, its own sound comes up (zones.ts) and the city traffic steps back: at the
 * airport you hear jets start their engines, roll, lift off, touch down and reverse thrust.
 *
 * Muting sets the master to silence at once and suspends the audio context.
 */

const TICK_MS = 200;
/** Master headroom: the loudest the whole mix gets at volume 100%. */
const MASTER = 0.9;
const AMBIENCE = 0.6;
const EVENTS = 1.1;
const NOISE_RMS = 0.3;

type Voice = {
  src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode;
  /** The jet's one-shots (start-up, takeoff, touchdown) go through here, so they follow it across the view. */
  fx: GainNode;
  whine: OscillatorNode; whineGain: GainNode;
  flight: FlightState;
  last: THREE.Vector3 | null; lastAt: number; speed: number; lastDist: number | null;
};
type Zone = { kind: ZoneKind; x: number; z: number; r: number };

type AudioCtor = typeof AudioContext;
function audioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext ?? null;
}

export function audioSupported(): boolean {
  return !!audioCtor();
}

const tmp = new THREE.Vector3();
const dir = new THREE.Vector3();

export class CityAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambience!: GainNode;
  private events!: GainNode;
  private noise!: AudioBuffer;
  private traffic: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private aircraft = new Map<THREE.Object3D, Voice>();
  private tagged: THREE.Object3D[] = [];
  private zones: Zone[] = [];
  private zoneRoots: THREE.Object3D[] = [];
  private zoneSounds: ZoneSounds | null = null;
  private weights = new Map<ZoneKind, number>();
  private lastScan = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextCar = 0;
  private nextCritter = 0;
  private limiter = new EventLimiter();
  private volume = 0.6;
  private running = false;
  private night = false;
  private trafficOn = true;
  private unlock: (() => void) | null = null;
  /** Called when an event sound plays, for the button's ripple. */
  onEvent: ((kind: CityEventKind) => void) | null = null;

  /** Creates the audio graph on first use. Call from a click so the browser lets it play. */
  start() {
    const Ctor = audioCtor();
    if (!Ctor) return;
    if (!this.ctx) this.build(new Ctor());
    if (this.running && this.timer) {
      void this.ctx!.resume().catch(() => {});
      return;
    }
    this.running = true;
    const ctx = this.ctx!;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setValueAtTime(0, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(this.volume * MASTER, ctx.currentTime + 0.8);
    void ctx.resume().catch(() => {});
    // Restored as "on" after a reload: the browser waits for a first touch or key before playing.
    if (ctx.state !== "running" && !this.unlock) {
      const go = () => {
        if (this.running) void this.ctx?.resume().catch(() => {});
        this.dropUnlock();
      };
      this.unlock = go;
      window.addEventListener("pointerdown", go, { once: true });
      window.addEventListener("keydown", go, { once: true });
    }
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.tick();
    }
  }

  /** Silences everything at once and stops all work until start() again. */
  stop() {
    this.running = false;
    this.dropUnlock();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.limiter.reset();
    this.zoneSounds?.reset();
    const ctx = this.ctx;
    if (!ctx) return;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.value = 0;
    void ctx.suspend().catch(() => {});
  }

  get playing() {
    return this.running;
  }

  /** What the engine hears right now: places and their weights, and each jet's flight state. */
  debug() {
    return {
      zones: this.zones.map((z) => ({ ...z, weight: this.weights.get(z.kind) ?? 0 })),
      jets: [...this.aircraft.values()].map((v) => ({ ground: v.flight.ground, speed: +v.speed.toFixed(2), rolling: v.flight.rolling, last: v.flight.last })),
    };
  }

  setVolume(v: number) {
    this.volume = clamp01(v);
    if (this.ctx && this.running) this.master.gain.setTargetAtTime(this.volume * MASTER, this.ctx.currentTime, 0.05);
  }

  setNight(night: boolean) {
    this.night = night;
    nightNow = night;
  }

  setTraffic(on: boolean) {
    this.trafficOn = on;
  }

  /** One automation event, at its agent's building when the map knows where that is. */
  play(e: CityEvent) {
    const ctx = this.ctx;
    if (!ctx || !this.running || ctx.state !== "running") return;
    const soften = this.limiter.admit(e.kind, performance.now());
    if (!soften) return;
    const place = this.place(e);
    const out = ctx.createGain();
    out.gain.value = soften * (0.35 + 0.65 * place.gain);
    const pan = ctx.createStereoPanner();
    pan.pan.value = place.pan;
    // A gentle low-pass keeps every tone soft, even on laptop speakers.
    const soft = ctx.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 3200;
    out.connect(soft).connect(pan).connect(this.events);
    const t = ctx.currentTime + 0.02;
    // Notes from one pentatonic scale (A major), so overlapping events stay in tune.
    if (e.kind === "start") {
      this.tone(out, 659.25, t, 0.32, "triangle", 0.5);
      this.tone(out, 880, t + 0.11, 0.42, "triangle", 0.45);
    } else if (e.kind === "handoff") {
      this.tone(out, 554.37, t, 0.34, "sine", 0.55);
      this.tone(out, 659.25, t + 0.1, 0.34, "sine", 0.5);
      this.tone(out, 880, t + 0.2, 0.5, "sine", 0.45);
    } else if (e.kind === "complete") {
      this.tone(out, 880, t, 1.3, "sine", 0.5);
      this.tone(out, 1318.5, t + 0.015, 1.1, "sine", 0.22);
      this.tone(out, 1109, t + 0.14, 1.0, "sine", 0.25);
    } else {
      // Needs attention: two low, rounded notes falling. Never a siren or a buzz.
      this.tone(out, 329.63, t, 0.5, "sine", 0.6);
      this.tone(out, 277.18, t + 0.22, 0.7, "sine", 0.55);
    }
    setTimeout(() => out.disconnect(), 2200);
    this.onEvent?.(e.kind);
  }

  private place(e: CityEvent): { gain: number; pan: number } {
    const s = soundScene();
    const at = s && (s.anchor(`agent:${e.agentId}`) ?? (e.projectId ? s.anchor(`project:${e.projectId}`) : null));
    if (!s || !at) return { gain: 0.6, pan: 0 };
    return this.spatial(s.camera, tmp.set(at.x, at.y, at.z));
  }

  /** Gain and pan for a world point, seen from the camera. */
  private spatial(camera: THREE.Camera, p: THREE.Vector3): { gain: number; pan: number; dist: number } {
    const cam = camera.position;
    const dist = cam.distanceTo(p);
    const local = p.clone().applyMatrix4(camera.matrixWorldInverse);
    return { gain: distanceGain(dist, viewDistance(camera)), pan: stereoPan(local.x, local.z), dist };
  }

  private tone(out: AudioNode, freq: number, at: number, len: number, type: OscillatorType, peak: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, at + len);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + len + 0.05);
  }

  private build(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.ambience = ctx.createGain();
    this.ambience.gain.value = AMBIENCE;
    this.ambience.connect(this.master);
    this.events = ctx.createGain();
    this.events.gain.value = EVENTS;
    this.events.connect(this.master);
    this.noise = pinkNoise(ctx, 4);

    // Traffic: a low, distant hum of streets a few blocks away, kept soft so it never reads as wind.
    const tf = ctx.createBiquadFilter();
    tf.type = "lowpass";
    tf.frequency.value = 260;
    tf.Q.value = 0.4;
    const tg = ctx.createGain();
    tg.gain.value = 0;
    this.loop().connect(tf).connect(tg).connect(this.ambience);
    this.traffic = { gain: tg, filter: tf };

    // No separate wind layer: with the traffic bed under it, it read as a strong wind (Khaneil, 2026-11-18).

    this.zoneSounds = new ZoneSounds({
      ctx,
      out: this.ambience,
      noise: this.noise,
      get night() {
        return engineNight();
      },
      birds: (l) => this.birds(l),
      crickets: (l) => this.crickets(l),
    });
  }

  private loop(offset = 0): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, offset % this.noise.duration);
    return src;
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx || !this.running || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const s = soundScene();
    const view = s ? viewDistance(s.camera) : 80;
    if (s) this.scan(s.scene);

    // The place you are zoomed in on: its own sound comes up, and the city traffic steps back a little.
    this.weights.clear();
    let focused = 0;
    if (s) {
      const f = groundFocus(s.camera, view);
      for (const z of this.zones) {
        if (z.r === 0) continue;
        const w = zoneWeight(f, view, z);
        if (w > (this.weights.get(z.kind) ?? 0)) this.weights.set(z.kind, w);
        focused = Math.max(focused, w);
      }
    }
    this.zoneSounds?.update(this.weights, now);

    // Traffic bed: louder near the streets, quieter from high up, softer still with traffic hidden.
    if (this.traffic) {
      const swell = 0.85 + 0.15 * Math.sin(now * 0.21) * Math.sin(now * 0.077 + 1);
      const level = trafficLevel(view) * (this.trafficOn ? 1 : 0.3) * (this.night ? 0.6 : 1) * (1 - 0.55 * focused);
      this.traffic.gain.gain.setTargetAtTime(0.13 * level * swell, now, 0.6);
      this.traffic.filter.frequency.setTargetAtTime(200 + 140 * level, now, 0.8);
    }

    // Now and then a car passes close by.
    if (this.trafficOn && now >= this.nextCar) {
      if (this.nextCar) this.carPass(trafficLevel(view) * (1 - 0.6 * focused));
      this.nextCar = now + 7 + Math.random() * 10;
    }
    // Birds by day, crickets by night, every so often.
    if (now >= this.nextCritter) {
      if (this.nextCritter) {
        if (this.night) this.crickets();
        else this.birds();
      }
      this.nextCritter = now + 9 + Math.random() * 14;
    }
    if (s) this.updateAircraft(s.camera, s.scene);
  }

  private updateAircraft(camera: THREE.Camera, scene: THREE.Object3D) {
    void scene;
    const ctx = this.ctx!;
    const t = performance.now();
    const now = ctx.currentTime;
    // Zoomed in on the airport, the jets on the ground come forward: taxiing, start-ups and the roll.
    const apron = this.weights.get("airport") ?? 0;
    for (const o of this.tagged) {
      let v = this.aircraft.get(o);
      if (!v) {
        v = this.voice();
        this.aircraft.set(o, v);
      }
      o.getWorldPosition(tmp);
      // Speed between position changes: the map draws at its own pace, so a tick can see no move.
      if (!v.last) v.last = tmp.clone();
      else {
        const moved = tmp.distanceTo(v.last), dt = (t - v.lastAt) / 1000;
        if (moved > 1e-4 || dt > 1.5) {
          v.speed = dt > 0 ? moved / dt : 0;
          v.last.copy(tmp);
          v.lastAt = t;
        }
      }
      const speed = v.speed;
      const { gain, pan, dist } = this.spatial(camera, tmp);
      const ground = typeof o.userData.ground === "boolean" ? o.userData.ground : tmp.y < 0.3;
      // The jet's own speed on the flight clock when it reports one, so a slow frame rate can't hide a takeoff.
      // Timed on that clock too, so a rest at the stand is told from a hold at the runway however fast it runs.
      const own = typeof o.userData.speed === "number" && Number.isFinite(o.userData.at);
      const cue = o.visible ? flightSound(v.flight, own ? { ground, speed: o.userData.speed, now: o.userData.at } : { ground, speed, now: t / 1000 }) : null;
      const thrust = jetThrust(v.flight);
      // A parked or holding jet is silent, a taxiing one a murmur, one in the air a passing roar, and the
      // takeoff roll the loudest of all.
      const moving = smooth(0.2, 3, speed);
      const airborne = smooth(0.2, 2.5, tmp.y);
      const onGround = (0.35 + 0.65 * airborne) * (ground ? 0.5 + 0.5 * apron : 1);
      // Jets circling overhead stay a soft, low pass-by: several at once at full level sounded like wind.
      const loud = o.visible ? 0.55 * gain * moving * onGround * (v.flight.rolling ? 1.6 : ground ? 1 : 0.4 * gain) : 0;
      v.fx.gain.setTargetAtTime(o.visible ? gain * (0.45 + 0.55 * apron) : 0, now, 0.25);
      v.whineGain.gain.setTargetAtTime(o.visible ? 0.03 * gain * thrust * (0.35 + 0.65 * apron) : 0, now, 0.4);
      v.whine.frequency.setTargetAtTime(700 + 1100 * thrust, now, 0.8);
      if (cue) this.jetCue(v, cue);
      // Approaching jets sound a little brighter, departing ones duller, like a soft Doppler shift.
      const closing = v.lastDist == null ? 0 : (v.lastDist - dist) / (TICK_MS / 1000);
      v.lastDist = dist;
      const bright = Math.max(0.6, Math.min(1.5, 1 + closing / 40));
      v.gain.gain.setTargetAtTime(loud, now, 0.35);
      v.pan.pan.setTargetAtTime(pan, now, 0.3);
      v.filter.frequency.setTargetAtTime((260 + 700 * gain * airborne) * bright, now, 0.3);
    }
  }

  private voice(): Voice {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const src = this.loop(Math.random() * 4);
    src.connect(filter).connect(gain).connect(pan).connect(this.ambience);
    const fx = ctx.createGain();
    fx.gain.value = 0;
    fx.connect(pan);
    // The turbine's whine, a soft tone that climbs with thrust.
    const whine = ctx.createOscillator();
    whine.type = "triangle";
    whine.frequency.value = 700;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain).connect(pan);
    whine.start();
    return { src, filter, gain, pan, fx, whine, whineGain, flight: newFlightState(), last: null, lastAt: performance.now(), speed: 0, lastDist: null };
  }

  /** Finds the jets and the places with their own sound. A few times a minute: the city rarely changes. */
  private scan(scene: THREE.Object3D) {
    const t = performance.now();
    if (t - this.lastScan < 4000) return;
    this.lastScan = t;
    const found: THREE.Object3D[] = [];
    const roots: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o.userData?.[SOUND_TAG_KEY] === "aircraft") found.push(o);
      if (o.userData?.[ZONE_TAG_KEY]) roots.push(o);
    });
    this.tagged = found;
    for (const [o, v] of this.aircraft) if (!found.includes(o)) this.dropVoice(o, v);
    if (roots.length !== this.zoneRoots.length || roots.some((r, i) => r !== this.zoneRoots[i]) || this.zones.some((z) => z.r === 0)) {
      this.zoneRoots = roots;
      this.zones = roots.map((r) => zoneOf(r));
    }
  }

  /** A jet's start-up, takeoff roll or touchdown, through its own voice so it moves with it. */
  private jetCue(v: Voice, cue: FlightSound) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    if (cue === "spoolup") {
      // Engines starting: a low whirr that winds up into a steady whine, with a hiss of air under it.
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(950, t + 5);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 1.5);
      g.gain.linearRampToValueAtTime(0.07, t + 4.5);
      g.gain.linearRampToValueAtTime(0, t + 7.5);
      o.connect(lp).connect(g).connect(v.fx);
      o.start(t);
      o.stop(t + 7.6);
      this.noiseBurst(v.fx, "bandpass", [1200, 2600], 1.2, t, [0, 0.12, 0.12, 0], [0, 2.5, 5, 7.5]);
    } else if (cue === "takeoff") {
      // Full power down the runway: a deep roar that opens up and brightens, then carries off with the jet.
      this.noiseBurst(v.fx, "lowpass", [280, 2400], 0.7, t, [0, 0.55, 0.6, 0], [0, 2.5, 7, 13]);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 52;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 2.5);
      g.gain.linearRampToValueAtTime(0, t + 10);
      o.connect(g).connect(v.fx);
      o.start(t);
      o.stop(t + 10.1);
    } else {
      // Touchdown: two short tyre chirps, then the reverse-thrust rush as it slows on the runway.
      for (const d of [0, 0.16]) this.noiseBurst(v.fx, "highpass", [1800, 1800], 0.8, t + d, [0, 0.22, 0], [0, 0.01, 0.09]);
      this.noiseBurst(v.fx, "lowpass", [500, 1300], 0.7, t + 0.5, [0, 0.4, 0.35, 0], [0, 0.7, 2.6, 5]);
    }
  }

  /** Filtered noise with a gain envelope (levels at times, in seconds from `at`) and a filter sweep. */
  private noiseBurst(out: AudioNode, type: BiquadFilterType, [f0, f1]: [number, number], q: number, at: number, levels: number[], times: number[]) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    const end = times[times.length - 1];
    f.frequency.setValueAtTime(f0, at);
    f.frequency.linearRampToValueAtTime(f1, at + end * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(levels[0], at);
    for (let i = 1; i < levels.length; i++) g.gain.linearRampToValueAtTime(levels[i], at + times[i]);
    src.connect(f).connect(g).connect(out);
    src.start(at, Math.random() * 2);
    src.stop(at + end + 0.05);
  }

  private dropVoice(o: THREE.Object3D, v: Voice) {
    v.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.3);
    v.fx.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.3);
    v.whineGain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.3);
    setTimeout(() => {
      v.src.stop();
      v.whine.stop();
      v.pan.disconnect();
    }, 1500);
    this.aircraft.delete(o);
  }

  private carPass(level: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(380, t);
    f.frequency.linearRampToValueAtTime(700, t + 1.1);
    f.frequency.linearRampToValueAtTime(320, t + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * level, t + 1.1);
    g.gain.linearRampToValueAtTime(0, t + 2.4);
    const p = ctx.createStereoPanner();
    const side = Math.random() < 0.5 ? -1 : 1;
    p.pan.setValueAtTime(-0.7 * side, t);
    p.pan.linearRampToValueAtTime(0.7 * side, t + 2.4);
    src.connect(f).connect(g).connect(p).connect(this.ambience);
    src.start(t, Math.random() * 3);
    src.stop(t + 2.5);
  }

  private birds(level = 1) {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.4 - 0.7;
    p.connect(this.ambience);
    const base = 2600 + Math.random() * 900;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (0.13 + Math.random() * 0.06);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035 * level, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + 0.1);
    }
    setTimeout(() => p.disconnect(), 1500);
  }

  private crickets(level = 1) {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.2 - 0.6;
    p.connect(this.ambience);
    for (let i = 0; i < 6; i++) {
      const t = ctx.currentTime + i * 0.09 + (i >= 3 ? 0.35 : 0);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 4300;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.012 * level, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0003, t + 0.05);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + 0.06);
    }
    setTimeout(() => p.disconnect(), 1800);
  }

  private dropUnlock() {
    if (!this.unlock) return;
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
    this.unlock = null;
  }
}

let nightNow = false;
const engineNight = () => nightNow;

const focusDir = new THREE.Vector3();
/** The spot on the ground in the middle of the view. */
export function groundFocus(camera: THREE.Camera, view: number): { x: number; z: number } {
  camera.getWorldDirection(focusDir);
  return { x: camera.position.x + focusDir.x * view, z: camera.position.z + focusDir.z * view };
}

const zoneBox = new THREE.Box3();
const partBox = new THREE.Box3();
/**
 * A place's footprint on the ground, from what it draws. Jets are skipped, so one flying over the
 * city doesn't stretch the airport across it. Before the place has drawn, its radius is 0 and the
 * next scan measures it again.
 */
function zoneOf(root: THREE.Object3D): Zone {
  zoneBox.makeEmpty();
  root.updateWorldMatrix(true, true);
  const walk = (o: THREE.Object3D) => {
    if (o.userData?.[SOUND_TAG_KEY] === "aircraft") return;
    const mesh = o as THREE.Mesh & Partial<THREE.InstancedMesh>;
    if (mesh.isInstancedMesh) {
      const im = o as THREE.InstancedMesh;
      if (im.count > 0) {
        if (!im.boundingBox) im.computeBoundingBox();
        if (im.boundingBox) zoneBox.union(partBox.copy(im.boundingBox).applyMatrix4(im.matrixWorld));
      }
    } else if (mesh.isMesh && mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) zoneBox.union(partBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  const kind = root.userData[ZONE_TAG_KEY] as ZoneKind;
  if (zoneBox.isEmpty()) return { kind, x: 0, z: 0, r: 0 };
  const c = zoneBox.getCenter(new THREE.Vector3());
  return { kind, x: c.x, z: c.z, r: Math.max(zoneBox.max.x - zoneBox.min.x, zoneBox.max.z - zoneBox.min.z) / 2 };
}

/** How far the camera is from the ground it looks at: the "zoom" of the map in world units. */
export function viewDistance(camera: THREE.Camera): number {
  camera.getWorldDirection(dir);
  const y = camera.position.y;
  if (dir.y > -0.05) return Math.max(10, y * 3);
  return Math.max(5, y / -dir.y);
}

const smooth = (a: number, b: number, v: number) => {
  const x = clamp01((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};

/** Seconds of pink noise (Paul Kellet's filter), the raw material for traffic and jets. */
function pinkNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const fade = Math.floor(ctx.sampleRate * 0.05);
  const raw = new Float32Array(len + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  // The first samples cross-fade from the ones that follow the end, so the loop has no click.
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = i < fade ? raw[i] * (i / fade) + raw[len + i] * (1 - i / fade) : raw[i];
  // A known loudness, so the layer gains above mean the same on every load.
  const rms = Math.sqrt(d.reduce((n, v) => n + v * v, 0) / len) || 1;
  for (let i = 0; i < len; i++) d[i] *= NOISE_RMS / rms;
  return buf;
}

/** The one engine the app uses; created lazily so nothing touches Web Audio until asked. */
let engine: CityAudio | null = null;
export function cityAudio(): CityAudio {
  engine ??= new CityAudio();
  // For checking the mix by hand in development (window.__citySound.debug()); never in a release build.
  if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __citySound?: CityAudio }).__citySound = engine;
  return engine;
}
