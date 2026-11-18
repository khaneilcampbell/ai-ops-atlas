import { beforeEach, describe, expect, it, vi } from "vitest";

const data = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, v),
  removeItem: (k: string) => void data.delete(k),
  clear: () => data.clear(),
});

const { DEFAULT_PREFS, distanceGain, EventLimiter, eventsForRuntimes, HANDOFF_MS, LIMITS, loadSoundPrefs, saveSoundPrefs, stereoPan, trafficLevel } = await import("./citySound");

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
