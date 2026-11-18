import { beforeEach, describe, expect, it, vi } from "vitest";

const data = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, v),
  removeItem: (k: string) => void data.delete(k),
  clear: () => data.clear(),
});

const { capScale, DEFAULT_PREFS, distanceGain, EventLimiter, eventsForRuntimes, flightSound, HANDOFF_MS, jetThrust, LIMITS, loadSoundPrefs, newFlightState, saveSoundPrefs, stereoPan, trafficLevel, zoneWeight } = await import("./citySound");
const { executiveJetPose, fleetPose, FLIGHT_SCHEDULE } = await import("../views/map3d/flightSchedule");

beforeEach(() => data.clear());

describe("saved city sound preference", () => {
  it("starts muted for a first-time visitor", () => {
    expect(loadSoundPrefs()).toEqual({ on: false, volume: DEFAULT_PREFS.volume });
    expect(DEFAULT_PREFS.on).toBe(false);
  });
  it("remembers sound on and the volume", () => {
    saveSoundPrefs({ on: true, volume: 0.35 });
    expect(loadSoundPrefs()).toEqual({ on: true, volume: 0.35 });
  });
  it("keeps odd saved values in range", () => {
    data.set("atlas:citySound", JSON.stringify({ on: "yes", volume: 7 }));
    expect(loadSoundPrefs()).toEqual({ on: false, volume: 1 });
    data.set("atlas:citySound", "null");
    expect(loadSoundPrefs()).toEqual(DEFAULT_PREFS);
  });
});

describe("sound follows the view", () => {
  it("is full near the focus of the view and quieter far beyond it", () => {
    expect(distanceGain(40, 60)).toBe(1);
    expect(distanceGain(120, 60)).toBeLessThan(0.5);
    expect(distanceGain(300, 60)).toBeLessThan(distanceGain(120, 60));
  });
  it("places sounds left and right of the camera, never fully in one ear", () => {
    expect(stereoPan(0, -10)).toBe(0);
    expect(stereoPan(-10, -10)).toBeLessThan(0);
    expect(stereoPan(10, -10)).toBeGreaterThan(0);
    expect(Math.abs(stereoPan(1000, -1))).toBeLessThanOrEqual(0.85);
  });
  it("makes traffic fuller close to the streets", () => {
    expect(trafficLevel(15)).toBe(1);
    expect(trafficLevel(250)).toBe(0.45);
    expect(trafficLevel(60)).toBeGreaterThan(trafficLevel(150));
  });
});

const rt = (state: string, result?: string) => ({ state, basis: result ? { result } : null });
const projects: Record<string, string> = { scout: "atlas", writer: "atlas", other: "shop" };
const projectOf = (id: string) => projects[id];

describe("automation sounds come from real runtime changes", () => {
  it("makes no sound for the first reading after load", () => {
    expect(eventsForRuntimes(null, new Map([["scout", rt("working")]]), projectOf, new Map(), 0)).toEqual([]);
  });
  it("sounds a start, a completion and a failure, and stays quiet when nothing changed", () => {
    const prev = new Map([["scout", rt("idle")], ["writer", rt("working")], ["other", rt("working")]]);
    const next = new Map([["scout", rt("working")], ["writer", rt("idle", "success")], ["other", rt("failed", "failure")]]);
    const events = eventsForRuntimes(prev, next, projectOf, new Map(), 1000);
    expect(events.map((e) => [e.kind, e.agentId])).toEqual([["start", "scout"], ["attention", "other"], ["complete", "writer"]]);
    expect(eventsForRuntimes(next, next, projectOf, new Map(), 2000)).toEqual([]);
  });
  it("calls a start a handoff when another agent in the project just finished", () => {
    const finished = new Map<string, { agentId: string; at: number }>();
    eventsForRuntimes(new Map([["scout", rt("working")]]), new Map([["scout", rt("idle", "success")]]), projectOf, finished, 10_000);
    const soon = eventsForRuntimes(new Map([["writer", rt("idle")]]), new Map([["writer", rt("working")]]), projectOf, finished, 20_000);
    expect(soon[0].kind).toBe("handoff");
    const late = eventsForRuntimes(new Map([["writer", rt("idle")]]), new Map([["writer", rt("working")]]), projectOf, finished, 10_000 + HANDOFF_MS + 1);
    expect(late[0].kind).toBe("start");
  });
  it("does not count a finished run without a successful result as complete", () => {
    expect(eventsForRuntimes(new Map([["scout", rt("working")]]), new Map([["scout", rt("idle", "cancelled")]]), projectOf, new Map(), 0)).toEqual([]);
  });
});

describe("overlapping automations stay calm", () => {
  it("limits how many event sounds ring at once", () => {
    const l = new EventLimiter();
    const kinds = ["start", "complete", "handoff", "attention"] as const;
    const admitted = kinds.map((k) => l.admit(k, 0));
    expect(admitted.filter((g) => g > 0)).toHaveLength(LIMITS.voices);
    expect(l.admit("start", LIMITS.ring + 1)).toBeGreaterThan(0);
  });
  it("softens repeats of the same event and then drops them", () => {
    const l = new EventLimiter();
    const gains = [0, 2000, 4000, 5500].map((t) => l.admit("complete", t));
    expect(gains[0]).toBe(1);
    expect(gains[1]).toBeLessThan(gains[0]);
    expect(gains[2]).toBeLessThan(gains[1]);
    expect(gains[3]).toBe(0);
  });
  it("caps the number of event sounds in a burst", () => {
    const l = new EventLimiter();
    const kinds = ["start", "complete", "handoff", "attention", "start", "complete", "handoff", "attention"] as const;
    const played = kinds.map((k, i) => l.admit(k, i * 2000)).filter((g) => g > 0);
    expect(played.length).toBeLessThanOrEqual(LIMITS.burst);
    l.reset();
    expect(l.admit("start", 0)).toBe(1);
  });
});

describe("area sound", () => {
  const airport = { x: 0, z: 0, r: 20 };
  it("is full when zoomed in on the place and silent from high above or far away", () => {
    expect(zoneWeight({ x: 0, z: 0 }, 20, airport)).toBe(1);
    expect(zoneWeight({ x: 0, z: 0 }, 120, airport)).toBe(0);
    expect(zoneWeight({ x: 80, z: 0 }, 20, airport)).toBe(0);
  });
  it("fades in as you zoom and as the view moves onto the place", () => {
    const steps = [90, 70, 50, 30].map((v) => zoneWeight({ x: 0, z: 0 }, v, airport));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    const edge = zoneWeight({ x: 26, z: 0 }, 20, airport);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });
});

describe("flight sounds", () => {
  const run = (pose: (t: number) => { x: number; y: number; z: number }, until: number) => {
    const s = newFlightState(), heard: { t: number; cue: string }[] = [];
    let prev = pose(0);
    for (let t = 0.2; t < until; t += 0.2) {
      const p = pose(t), speed = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) / 0.2;
      prev = p;
      const cue = flightSound(s, { ground: p.y <= 0.02, speed, now: t });
      if (cue) heard.push({ t: +t.toFixed(1), cue });
    }
    return heard;
  };

  it("hears each airliner start up, take off and land once per loop, in that order", () => {
    const heard = run((t) => fleetPose(t, 0), FLIGHT_SCHEDULE.cycle * 2 + 30);
    const loop = heard.filter((h) => h.t > FLIGHT_SCHEDULE.cycle - 120 && h.t <= FLIGHT_SCHEDULE.cycle * 2 - 120).map((h) => h.cue);
    expect(loop.sort()).toEqual(["spoolup", "takeoff", "touchdown"]);
    const one = heard.filter((h) => h.t > 0 && h.t < FLIGHT_SCHEDULE.cycle + 10);
    const at = (c: string) => one.find((h) => h.cue === c)?.t ?? NaN;
    // Lands, rests at the stand, starts up, then takes off.
    expect(at("touchdown")).toBeLessThan(at("spoolup"));
    expect(at("spoolup")).toBeLessThan(at("takeoff"));
  });

  it("hears the executive jet start from its long rest and take off", () => {
    const cues = run((t) => executiveJetPose(t), FLIGHT_SCHEDULE.cycle * 2).map((h) => h.cue);
    expect(cues).toContain("touchdown");
    expect(cues).toContain("spoolup");
    expect(cues).toContain("takeoff");
  });

  it("stays quiet on the first reading, mid-takeoff", () => {
    expect(flightSound(newFlightState(), { ground: true, speed: 2.5, now: 0 })).toBeNull();
  });

  it("does not mistake a landing rollout for a takeoff", () => {
    const s = newFlightState();
    flightSound(s, { ground: false, speed: 4, now: 0 });
    expect(flightSound(s, { ground: true, speed: 2.6, now: 0.2 })).toBe("touchdown");
    for (let i = 0; i < 20; i++) expect(flightSound(s, { ground: true, speed: 2.6 - i * 0.05 + (i % 2) * 0.06, now: 0.4 + i * 0.2 })).toBeNull();
  });

  it("puts the turbine at full power on the takeoff roll", () => {
    const s = newFlightState();
    s.ground = true;
    s.rolling = true;
    expect(jetThrust(s)).toBe(1);
    expect(jetThrust(newFlightState())).toBe(0);
  });
});

describe("jet noise cap", () => {
  it("leaves a quiet sky alone and scales a busy one down to the cap", () => {
    expect(capScale([0.1, 0.1], 0.35)).toBe(1);
    const levels = [0.4, 0.4, 0.3];
    const scale = capScale(levels, 0.35);
    expect(levels.reduce((n, l) => n + l * scale, 0)).toBeCloseTo(0.35);
  });
});
