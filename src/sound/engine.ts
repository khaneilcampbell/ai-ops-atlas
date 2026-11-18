import * as THREE from "three";
import { clamp01, distanceGain, EventLimiter, stereoPan, trafficLevel, type CityEvent, type CityEventKind } from "./citySound";
import { SOUND_TAG_KEY, soundScene } from "./listener";

/**
 * The city soundscape, made entirely in the browser with Web Audio: filtered noise for traffic,
 * wind and passing jets, and short sine and triangle tones for birds, crickets and automation
 * events. No recordings are shipped, so there are no third-party audio licences to track.
 *
 * Two layers under one master volume:
 *  - ambience: a traffic bed, a little wind, occasional cars passing, birds by day and crickets
 *    by night, and a voice for every jet in flight, placed by where it is relative to the camera;
 *  - automation: one soft tone per real event (start, handoff, complete, needs attention), placed
 *    at the agent's building and limited so bursts stay calm.
 *
 * Muting sets the master to silence at once and suspends the audio context.
 */

const TICK_MS = 200;
/** Master headroom: the loudest the whole mix gets at volume 100%. */
const MASTER = 0.9;
const AMBIENCE = 0.6;
const EVENTS = 1.1;
const NOISE_RMS = 0.3;

type Voice = { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode; last: THREE.Vector3 | null; lastAt: number; speed: number; lastDist: number | null };

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
  private wind: GainNode | null = null;
  private aircraft = new Map<THREE.Object3D, Voice>();
  private tagged: THREE.Object3D[] = [];
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
    const ctx = this.ctx;
    if (!ctx) return;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.value = 0;
    void ctx.suspend().catch(() => {});
  }

  get playing() {
    return this.running;
  }

  setVolume(v: number) {
    this.volume = clamp01(v);
    if (this.ctx && this.running) this.master.gain.setTargetAtTime(this.volume * MASTER, this.ctx.currentTime, 0.05);
  }

  setNight(night: boolean) {
    this.night = night;
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

    // Traffic: a low, rounded rush that rises and falls a little, like streets a block away.
    const tf = ctx.createBiquadFilter();
    tf.type = "lowpass";
    tf.frequency.value = 420;
    tf.Q.value = 0.4;
    const tg = ctx.createGain();
    tg.gain.value = 0;
    this.loop().connect(tf).connect(tg).connect(this.ambience);
    this.traffic = { gain: tg, filter: tf };

    // Wind: barely there, so the quiet between events never feels empty.
    const wf = ctx.createBiquadFilter();
    wf.type = "bandpass";
    wf.frequency.value = 260;
    wf.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    this.loop(1.3).connect(wf).connect(wg).connect(this.ambience);
    this.wind = wg;
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

    // Traffic bed: louder near the streets, quieter from high up, softer still with traffic hidden.
    if (this.traffic) {
      const swell = 0.85 + 0.15 * Math.sin(now * 0.21) * Math.sin(now * 0.077 + 1);
      const level = trafficLevel(view) * (this.trafficOn ? 1 : 0.3) * (this.night ? 0.6 : 1);
      this.traffic.gain.gain.setTargetAtTime(0.32 * level * swell, now, 0.6);
      this.traffic.filter.frequency.setTargetAtTime(300 + 260 * level, now, 0.8);
    }
    if (this.wind) this.wind.gain.setTargetAtTime(0.035 + 0.02 * Math.sin(now * 0.13), now, 1);

    // Now and then a car passes close by.
    if (this.trafficOn && now >= this.nextCar) {
      if (this.nextCar) this.carPass(trafficLevel(view));
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
    const ctx = this.ctx!;
    const t = performance.now();
    if (t - this.lastScan > 4000) {
      this.lastScan = t;
      const found: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.userData?.[SOUND_TAG_KEY] === "aircraft") found.push(o);
      });
      this.tagged = found;
      for (const [o, v] of this.aircraft) if (!found.includes(o)) this.dropVoice(o, v);
    }
    const now = ctx.currentTime;
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
      // A parked or holding jet is silent, a taxiing one a murmur, one in the air a passing roar.
      const moving = smooth(0.2, 3, speed);
      const airborne = smooth(0.2, 2.5, tmp.y);
      const loud = o.visible ? 0.55 * gain * moving * (0.35 + 0.65 * airborne) : 0;
      // Approaching jets sound a little brighter, departing ones duller, like a soft Doppler shift.
      const closing = v.lastDist == null ? 0 : (v.lastDist - dist) / (TICK_MS / 1000);
      v.lastDist = dist;
      const bright = Math.max(0.6, Math.min(1.5, 1 + closing / 40));
      v.gain.gain.setTargetAtTime(loud, now, 0.35);
      v.pan.pan.setTargetAtTime(pan, now, 0.3);
      v.filter.frequency.setTargetAtTime((320 + 1300 * gain * airborne) * bright, now, 0.3);
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
    return { src, filter, gain, pan, last: null, lastAt: performance.now(), speed: 0, lastDist: null };
  }

  private dropVoice(o: THREE.Object3D, v: Voice) {
    v.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.3);
    setTimeout(() => {
      v.src.stop();
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

  private birds() {
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
      g.gain.linearRampToValueAtTime(0.035, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + 0.1);
    }
    setTimeout(() => p.disconnect(), 1500);
  }

  private crickets() {
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
      g.gain.linearRampToValueAtTime(0.012, t + 0.01);
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

/** Seconds of pink noise (Paul Kellet's filter), the raw material for traffic, wind and jets. */
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
  return (engine ??= new CityAudio());
}
