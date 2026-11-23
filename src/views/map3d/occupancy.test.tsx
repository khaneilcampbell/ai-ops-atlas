import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { OpRun } from "../../routine/operations";
import type { Routine, Segment } from "../../routine/routine";
import { busiestFloor, insideNow, isInside, markerAnchor, markerWidth, MARKER_GAP, occupancySignature, occupancyText, officeBuildingOf, stackOf } from "./occupancy";
import { occupancyMarker, type MarkerFace } from "./OccupancyMarker";
import { buildingPlaque, PLAQUE } from "./plaques";

const MIN = 60_000;
const T = Date.parse("2026-11-23T15:00:00Z");
const run = (status: OpRun["status"]): OpRun => ({ key: "n8n:1", workflowKey: "wf", workflowName: "Data Inventory", agentId: "a", source: "n8n", status, startedAt: T - MIN, stoppedAt: null, seenAt: T - MIN, statusSeenAt: T - MIN }) as OpRun;
const inside = (t0: number, t1: number, phase: Extract<Segment, { kind: "inside" }>["phase"] = "working", runs: OpRun[] = [run("running")]): Segment => ({
  kind: "inside",
  t0,
  t1,
  at: "office:x",
  activity: "at_desk",
  phase,
  note: "Data Inventory",
  work: { label: "Data Inventory", runs, scheduledAt: t0, alreadyStarted: false, outcome: null },
});
const stay = (t0: number, t1: number, at = "park"): Segment => ({ kind: "stay", t0, t1, at, activity: "relaxing", phase: null, note: "In the park" });
const walk = (t0: number, t1: number): Segment => ({ kind: "walk", t0, t1, from: { spot: "park" }, to: "office:x", activity: "walking", phase: "heading", note: "To work" });
const routine = (personaId: string, segments: Segment[]): Routine => ({ personaId, segments, validUntil: T + 60 * MIN, episodes: [], held: false });

const HQ = "project:ai-ops-atlas", SOC = "project:soc-lab";
const offices: Record<string, string> = { priya: HQ, omar: HQ, leila: SOC, sam: HQ, noor: HQ };
const officeOf = (id: string) => offices[id] ?? null;

describe("agents inside: who counts", () => {
  it("counts an agent only while its routine has it inside its workplace", () => {
    const routines = new Map([
      ["priya", routine("priya", [stay(T - 30 * MIN, T - 10 * MIN), inside(T - 10 * MIN, T + 10 * MIN)])],
      // Assigned to Atlas HQ but in the park now: not inside.
      ["omar", routine("omar", [stay(T - 30 * MIN, T + 30 * MIN), inside(T + 30 * MIN, T + 50 * MIN)])],
      // Walking to the office, not through the door yet: not inside.
      ["sam", routine("sam", [walk(T - 2 * MIN, T + 2 * MIN), inside(T + 2 * MIN, T + 20 * MIN, "entering")])],
    ]);
    const o = insideNow(routines, T, officeOf);
    expect([...o.keys()]).toEqual([HQ]);
    expect(o.get(HQ)).toEqual([{ personaId: "priya", status: "Working" }]);
    // Two minutes on Sam has stepped inside.
    expect(insideNow(routines, T + 2 * MIN, officeOf).get(HQ)?.map((a) => a.personaId)).toEqual(["priya", "sam"]);
  });

  it("shows no marker for an empty building, and none at all without run data", () => {
    expect(insideNow(new Map(), T, officeOf).size).toBe(0);
    const routines = new Map([["omar", routine("omar", [stay(T - 30 * MIN, T + 30 * MIN)])]]);
    expect(insideNow(routines, T, officeOf).size).toBe(0);
  });

  it("does not stretch the last inside segment past its end", () => {
    // segmentAt falls back to the last segment before now; that is history, not presence.
    const routines = new Map([["priya", routine("priya", [inside(T - 20 * MIN, T - 5 * MIN, "leaving")])]]);
    expect(insideNow(routines, T, officeOf).size).toBe(0);
  });

  it("covers the whole visit, door to door, in the routine's own words", () => {
    const at = (phase: Extract<Segment, { kind: "inside" }>["phase"], runs?: OpRun[]) => insideNow(new Map([["priya", routine("priya", [inside(T - MIN, T + MIN, phase, runs)])]]), T, officeOf).get(HQ)?.[0].status;
    expect(at("entering")).toBe("Entering building");
    expect(at("to_desk")).toBe("Going to desk");
    expect(at("working")).toBe("Working");
    expect(at("working", [run("waiting_approval")])).toBe("At desk, waiting for approval");
    expect(at("leaving")).toBe("Leaving office");
  });

  it("groups agents by building in team order and skips workplaces with no building on the map", () => {
    const now = (id: string) => routine(id, [inside(T - MIN, T + MIN)]);
    const routines = new Map(["noor", "leila", "priya", "ghost"].map((id) => [id, now(id)]));
    const o = insideNow(routines, T, officeOf, ["priya", "leila", "noor", "ghost"]);
    expect(o.get(HQ)?.map((a) => a.personaId)).toEqual(["priya", "noor"]);
    expect(o.get(SOC)?.map((a) => a.personaId)).toEqual(["leila"]);
    expect(o.size).toBe(2);
  });

  it("uses the review shots' stand-in routine in place of an agent's own", () => {
    const routines = new Map([["omar", routine("omar", [stay(T - MIN, T + MIN)])]]);
    const override = new Map([["omar", routine("omar", [inside(T - MIN, T + MIN)])]]);
    expect(insideNow(routines, T, officeOf, ["omar"], override).get(HQ)?.length).toBe(1);
  });

  it("isInside narrows to inside segments only", () => {
    expect(isInside(inside(0, 1))).toBe(true);
    expect(isInside(stay(0, 1))).toBe(false);
    expect(isInside(null)).toBe(false);
  });

  it("changes its signature only when who is inside, or what they are doing, changes", () => {
    const a = new Map([[HQ, [{ personaId: "priya", status: "Working" }]]]);
    const b = new Map([[HQ, [{ personaId: "priya", status: "Working" }]]]);
    expect(occupancySignature(a)).toBe(occupancySignature(b));
    expect(occupancySignature(a)).not.toBe(occupancySignature(new Map([[HQ, [{ personaId: "priya", status: "At desk" }]]])));
  });
});

describe("agents inside: which building", () => {
  const towers = [{ key: HQ, projectId: "ai-ops-atlas" }, { key: SOC, projectId: "soc-lab" }];
  const agency = { key: "service:benjaire-marketing", name: "Benjaire Marketing Agency" };
  it("is the project's headquarters, or the Marketing Agency for its declared workplace", () => {
    expect(officeBuildingOf({ kind: "headquarters", projectId: "soc-lab", building: "soc-lab" }, towers, agency)).toBe(SOC);
    expect(officeBuildingOf({ kind: "workplace", projectId: "x", building: "Benjaire Marketing Agency" }, towers, agency)).toBe(agency.key);
    expect(officeBuildingOf({ kind: "workplace", projectId: "x", building: "Some Suite" }, towers, agency)).toBeNull();
    expect(officeBuildingOf({ kind: "headquarters", projectId: "gone", building: "gone" }, towers, agency)).toBeNull();
  });
  it("opens the floor most of them sit on", () => {
    expect(busiestFloor([3, 2, 3, null])).toBe(3);
    expect(busiestFloor([4, 2])).toBe(2);
    expect(busiestFloor([undefined])).toBeUndefined();
  });
});

describe("agents inside: the marker", () => {
  const b = { key: HQ, name: "Atlas Command Center", x: 12, roof: 6.5, z: -4 };
  const faces = new Map<string, MarkerFace>(
    ["priya", "omar", "sam", "noor", "leila"].map((id, i) => [id, { name: `Agent ${i + 1}`, initials: `A${i + 1}`, accent: "#336655", portrait: null }]),
  );
  const agents = (n: number) => ["priya", "omar", "sam", "noor", "leila"].slice(0, n).map((personaId) => ({ personaId, status: "Working" }));
  const spec = (n: number, extra: Partial<Parameters<typeof occupancyMarker>[0]> = {}) =>
    occupancyMarker({ building: b, agents: agents(n), faces, plaqueH: PLAQUE.height, priority: 3, peeking: false, onEnter: () => {}, onPeek: () => {}, ...extra });

  it("sits on the building's own roof point, the same one as its nameplate, in world space", () => {
    const plate = buildingPlaque({ id: `hq:ai-ops-atlas`, select: HQ, name: b.name, x: b.x, roof: b.roof, z: b.z, priority: 3, mark: { kind: "passing", label: "Passing" }, title: b.name, selKey: null, hover: null, onSelect: () => {} });
    const m = spec(2);
    expect(m.pos).toBeInstanceOf(THREE.Vector3);
    expect(m.pos.toArray()).toEqual(plate.pos.toArray());
    expect(m.pos.toArray()).toEqual([12, 6.5 + PLAQUE.roofGap, -4]);
  });

  it("floats above the nameplate on screen, never over it, whatever the nameplate's height", () => {
    expect(markerAnchor(b).lift).toBe(PLAQUE.height + MARKER_GAP);
    // A selected building's tall card: the marker clears it too.
    const tall = spec(1, { plaqueH: 90 });
    expect(tall.lift).toBe(90 + MARKER_GAP);
    // The marker's bottom edge (lift above the anchor) is above the nameplate's top edge (its height above the anchor).
    expect(tall.lift! - 90).toBeGreaterThan(0);
  });

  it("is placed straight after its nameplate, so labels give way in the usual order", () => {
    expect(spec(1).priority).toBeCloseTo(3.01);
    expect(spec(1, { priority: 0 }).priority).toBeCloseTo(0.01);
  });

  it("stacks up to three portraits, then two and a +N", () => {
    expect(stackOf([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(stackOf([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2], more: 3 });
    // The pill grows with the faces it shows, not with the team.
    expect(markerWidth(2, 40)).toBeGreaterThan(markerWidth(1, 40));
    expect(markerWidth(5, 40)).toBe(markerWidth(3, 40));
  });

  it("says the building, the count and every name and status for screen readers", () => {
    const t = occupancyText("Atlas Command Center", [{ name: "Priya Raman", status: "Working" }, { name: "Omar Haddad", status: "At desk" }]);
    expect(t.count).toBe("2 agents inside");
    expect(t.lines).toEqual(["Priya Raman · Working", "Omar Haddad · At desk"]);
    expect(t.label).toBe("Atlas Command Center: 2 agents inside. Priya Raman · Working. Omar Haddad · At desk.");
    expect(occupancyText("SOC Lab", [{ name: "Leila", status: "Working" }]).count).toBe("1 agent inside");
    const m = spec(2);
    expect(m.ariaLabel).toContain("Atlas Command Center: 2 agents inside. Agent 1 · Working. Agent 2 · Working.");
    expect(m.id).toBe(`occ:${HQ}`);
    expect(m.key).toBe(HQ);
  });

  it("enters on a click or Enter, and on a touch screen shows who is inside first", () => {
    const onEnter = vi.fn(), onPeek = vi.fn();
    const m = spec(2, { onEnter, onPeek });
    m.onClick!(); // keyboard
    m.onClick!({ nativeEvent: { pointerType: "mouse" } } as never);
    expect(onEnter).toHaveBeenCalledTimes(2);
    m.onClick!({ nativeEvent: { pointerType: "touch" } } as never);
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledTimes(2);
    // Second tap, with the tooltip open, goes in.
    spec(2, { onEnter, onPeek, peeking: true }).onClick!({ nativeEvent: { pointerType: "touch" } } as never);
    expect(onEnter).toHaveBeenCalledTimes(3);
    expect(spec(2, { peeking: true }).className).toContain("open");
  });
});
