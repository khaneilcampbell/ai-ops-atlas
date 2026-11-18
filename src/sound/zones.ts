import type { ZoneKind } from "./listener";

/**
 * The sound of each place up close, made like the rest of the soundscape from filtered noise and
 * soft tones (no recordings). Each place has a quiet bed that rises as you zoom in on it, and now
 * and then a short sound of its own:
 *  - airport: turbines idling across the apron and a soft ground-crew reversing chirp (the jets'
 *    own start-ups, takeoffs and landings are in engine.ts, where each jet is followed);
 *  - station: a crowd murmur, the click of rails, and a gentle three-note platform chime;
 *  - marina: water lapping at the pier, gulls by day and a buoy bell;
 *  - stadium: a crowd, and every so often a cheer that swells and settles;
 *  - park: leaves in the wind, and more birds by day (crickets at night).
 * No voices or spoken announcements.
 */

type Bed = { gain: GainNode; level: number; mod?: (now: number) => number };

export interface ZoneHost {
  ctx: AudioContext;
  out: AudioNode;
  noise: AudioBuffer;
  night: boolean;
  /** The engine's birds and crickets, played again here a little closer for the park. */
  birds: (level: number) => void;
  crickets: (level: number) => void;
}

/** Seconds between a place's one-shot sounds, when fully zoomed in on it (longer when further away). */
const EVERY: Record<ZoneKind, [number, number]> = {
  // Spaced out so the city has room to breathe between sounds (Khaneil, 2026-11-18: "overstimulating").
  airport: [26, 42],
  station: [24, 40],
  marina: [16, 28],
  stadium: [36, 60],
  park: [12, 22],
};

export class ZoneSounds {
  private beds = new Map<ZoneKind, Bed>();
  private next = new Map<ZoneKind, number>();

  constructor(private host: ZoneHost) {}

  /** Sets every place's bed for its weight (0 to 1) and plays a place's one-shot when it is due. */
  update(weights: ReadonlyMap<ZoneKind, number>, now: number) {
    for (const kind of Object.keys(EVERY) as ZoneKind[]) {
      const w = weights.get(kind) ?? 0;
      const bed = w > 0.01 ? this.bed(kind) : this.beds.get(kind);
      if (bed) {
        const mod = bed.mod ? bed.mod(now) : 1;
        bed.gain.gain.setTargetAtTime(w * bed.level * mod, now, 0.5);
      }
      const due = this.next.get(kind);
      if (due === undefined || w < 0.25) {
        // Out of view: the first sound comes a little after you zoom in, never the moment you arrive.
        if (due === undefined || now > due) this.next.set(kind, now + 3 + Math.random() * 4);
        continue;
      }
      if (now < due) continue;
      this.oneShot(kind, w);
      const [a, b] = EVERY[kind];
      this.next.set(kind, now + (a + Math.random() * (b - a)) / Math.max(0.4, w));
    }
  }

  /** Lets the beds fade with the master and forgets the timers; called when the sound stops. */
  reset() {
    this.next.clear();
    const now = this.host.ctx.currentTime;
    for (const b of this.beds.values()) b.gain.gain.setValueAtTime(0, now);
  }

  private bed(kind: ZoneKind): Bed {
    let bed = this.beds.get(kind);
    if (bed) return bed;
    const { ctx } = this.host;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.host.out);
    if (kind === "airport") {
      // Distant turbines at idle: a low rumble and two faint whines that drift a little. No high hiss band:
      // steady bright noise reads as wind.
      this.noiseThrough(gain, "bandpass", 150, 0.9, 1);
      for (const [f, a] of [[1460, 0.012], [2190, 0.007]] as const) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07 + Math.random() * 0.05;
        const depth = ctx.createGain();
        depth.gain.value = f * 0.006;
        lfo.connect(depth).connect(o.frequency);
        const g = ctx.createGain();
        g.gain.value = a;
        o.connect(g).connect(gain);
        o.start();
        lfo.start();
      }
      bed = { gain, level: 0.16 };
    } else if (kind === "station") {
      this.noiseThrough(gain, "bandpass", 650, 0.7, 1);
      bed = { gain, level: 0.06, mod: (t) => 0.8 + 0.2 * Math.sin(t * 0.31) * Math.sin(t * 0.11 + 2) };
    } else if (kind === "marina") {
      // Water against the pier: low, soft, rising and falling like small waves.
      this.noiseThrough(gain, "lowpass", 380, 0.5, 1);
      bed = { gain, level: 0.11, mod: (t) => 0.55 + 0.45 * Math.max(0, Math.sin(t * 1.25)) * (0.7 + 0.3 * Math.sin(t * 0.37)) };
    } else if (kind === "stadium") {
      this.noiseThrough(gain, "bandpass", 950, 0.5, 1);
      bed = { gain, level: 0.06, mod: (t) => 0.85 + 0.15 * Math.sin(t * 0.17) };
    } else {
      // Leaves: a faint, airy rustle that comes and goes. Kept very quiet so it never sounds like wind.
      this.noiseThrough(gain, "highpass", 2600, 0.6, 1);
      bed = { gain, level: 0.015, mod: (t) => 0.4 + 0.6 * Math.max(0, Math.sin(t * 0.23) * Math.sin(t * 0.61 + 1)) };
    }
    this.beds.set(kind, bed);
    return bed;
  }

  private noiseThrough(out: AudioNode, type: BiquadFilterType, freq: number, q: number, level: number) {
    const { ctx, noise } = this.host;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(f).connect(g).connect(out);
    src.start(0, Math.random() * noise.duration);
  }

  private oneShot(kind: ZoneKind, w: number) {
    const { night } = this.host;
    if (kind === "airport") this.tugChirp(w);
    else if (kind === "station") {
      if (Math.random() < 0.45) this.chime(w);
      else this.railClicks(w);
    } else if (kind === "marina") {
      if (!night && Math.random() < 0.7) this.gull(w);
      else this.buoyBell(w);
    } else if (kind === "stadium") this.cheer(w);
    else if (night) this.host.crickets(0.8 + 0.6 * w);
    else this.host.birds(0.8 + 0.8 * w);
  }

  private panned(pan: number, level: number): GainNode {
    const { ctx } = this.host;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const g = ctx.createGain();
    g.gain.value = level;
    g.connect(p).connect(this.host.out);
    setTimeout(() => p.disconnect(), 6000);
    return g;
  }

  private tone(out: AudioNode, freq: number, at: number, len: number, peak: number, type: OscillatorType = "sine") {
    const { ctx } = this.host;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + len + 0.05);
    return o;
  }

  /** A baggage tug backing up, far off: two soft, rounded chirps, never a hard beep. */
  private tugChirp(w: number) {
    const out = this.panned(Math.random() * 1.2 - 0.6, 0.05 * w);
    const t = this.host.ctx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) this.tone(out, 1180, t + i * 0.55, 0.22, 0.8);
  }

  /** The platform chime before a train: three notes from the automation sounds' A major scale. */
  private chime(w: number) {
    const out = this.panned(Math.random() * 0.6 - 0.3, 0.09 * w);
    const t = this.host.ctx.currentTime + 0.05;
    [880, 739.99, 554.37].forEach((f, i) => this.tone(out, f, t + i * 0.32, 1.1, 0.7));
  }

  /** A train over the rail joints: pairs of soft, low clicks that speed up and fade. */
  private railClicks(w: number) {
    const { ctx, noise } = this.host;
    const out = this.panned(Math.random() < 0.5 ? -0.5 : 0.5, 0.18 * w);
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < 8; i++) {
      for (const dt of [0, 0.11]) {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 900;
        f.Q.value = 2;
        const g = ctx.createGain();
        const at = t + dt, peak = 0.6 * (1 - i / 10);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(peak, at + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0005, at + 0.06);
        src.connect(f).connect(g).connect(out);
        src.start(at, Math.random() * 3);
        src.stop(at + 0.08);
      }
      t += 0.42 - i * 0.02;
    }
  }

  /** A gull's call: a bright glide up and down with a little wobble, once or twice. */
  private gull(w: number) {
    const { ctx } = this.host;
    const out = this.panned(Math.random() * 1.4 - 0.7, 0.05 * w);
    const calls = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < calls; i++) {
      const t = ctx.currentTime + 0.05 + i * 0.45;
      const o = this.tone(out, 1500, t, 0.38, 0.8, "triangle");
      o.frequency.setValueAtTime(1500, t);
      o.frequency.linearRampToValueAtTime(2250, t + 0.08);
      o.frequency.exponentialRampToValueAtTime(1150, t + 0.36);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 22;
      const depth = ctx.createGain();
      depth.gain.value = 60;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + 0.4);
    }
  }

  /** A buoy bell, rung by a slow swell: one round strike with a long, quiet ring. */
  private buoyBell(w: number) {
    const out = this.panned(Math.random() * 1.2 - 0.6, 0.05 * w);
    const t = this.host.ctx.currentTime + 0.05;
    this.tone(out, 659.25, t, 3.2, 0.7);
    this.tone(out, 659.25 * 2.76, t, 1.4, 0.18);
  }

  /** The crowd lifting for a moment, then settling back into the murmur. */
  private cheer(w: number) {
    const { ctx, noise } = this.host;
    const out = this.panned(0, 0.22 * w);
    const t = ctx.currentTime + 0.05;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 0.6;
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(1500, t + 1.2);
    f.frequency.linearRampToValueAtTime(1000, t + 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.8, t + 1.2);
    g.gain.linearRampToValueAtTime(0, t + 4.2);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 2);
    src.stop(t + 4.3);
  }
}
