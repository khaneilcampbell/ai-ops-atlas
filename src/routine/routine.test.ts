import { describe, expect, it } from "vitest";
import type { Agent } from "../catalog/types";
import type { N8nSnapshot, N8nWorkflowRuns } from "../n8n/types";
import type { StoredTask } from "../tasks/types";
import { fromZoned, nextCron, parseCron, previousCron, zoned } from "./cron";
import { HISTORY_MS, observe, type Ledger } from "./ledger";
import { agentOps, ownedEntries, sightingsOf, type AgentOps, type OpsInput } from "./operations";
import { FREE_TIME_KEEP_MS, freeTimeAvailability, freshRequests } from "./freeTime";
import { planRoutine, segmentAt, type Anchor, type LeisureKind, type LeisureOption, type RoutineEnv, type Segment } from "./routine";

const NY = "America/New_York";
const MIN = 60_000;

describe("cron schedules in a time zone", () => {
  it("finds the next daily 11am New York run across a daylight saving change", () => {
    const c = parseCron("0 11 * * *")!;
    // 2026-11-01 is the autumn change in New York: 11am EST is 16:00 UTC, the day before 15:00 UTC.
    expect(new Date(nextCron(c, NY, Date.parse("2026-10-31T16:00:00Z"))!).toISOString()).toBe("2026-11-01T16:00:00.000Z");
    expect(new Date(nextCron(c, NY, Date.parse("2026-10-30T12:00:00Z"))!).toISOString()).toBe("2026-10-30T15:00:00.000Z");
  });
  it("reads weekday lists, steps and every-n-hours", () => {
    const monThu = parseCron("0 10 * * 1,4")!;
    // Wednesday 18 Nov 2026 -> Thursday 19 Nov 10am EST.
    expect(new Date(nextCron(monThu, NY, Date.parse("2026-11-18T20:00:00Z"))!).toISOString()).toBe("2026-11-19T15:00:00.000Z");
    const every4 = parseCron("0 */4 * * *")!;
    expect(new Date(nextCron(every4, NY, Date.parse("2026-11-18T20:22:00Z"))!).toISOString()).toBe("2026-11-18T21:00:00.000Z"); // 4pm EST
    expect(parseCron("61 * * * *")).toBeNull();
    expect(parseCron("0 9 * *")).toBeNull();
  });
  it("finds the previous time within a window", () => {
    const c = parseCron("0 11 * * *")!;
    expect(previousCron(c, NY, Date.parse("2026-11-18T16:05:00Z"), 10 * MIN)).toBe(Date.parse("2026-11-18T16:00:00Z"));
    expect(previousCron(c, NY, Date.parse("2026-11-18T16:30:00Z"), 10 * MIN)).toBeNull();
  });
  it("converts wall clock times and back", () => {
    const t = fromZoned(2026, 11, 18, 13, 0, NY);
    expect(new Date(t).toISOString()).toBe("2026-11-18T18:00:00.000Z");
    expect(zoned(t, NY)).toMatchObject({ h: 13, mi: 0, dow: 3 });
  });
});

// ------------------------------------------------------------------------- a small catalog

const base = { purpose: "", framework: "n8n", lastRun: null, history: [], projectId: "benjaire-site", repository: "khaneilcampbell/benjaire.com" };
const AGENTS: Agent[] = [
  { ...base, id: "benjaire-shop-manager", name: "Shop manager", status: "active", links: [], registry: { identity: { displayName: "Claire Dubois" } } as Agent["registry"] },
  { ...base, id: "benjaire-shop-follow-ups", name: "Shop follow ups", status: "active", ownedBy: "benjaire-shop-manager", trigger: "Every 4 hours", links: [{ label: "n8n workflow", url: "https://khancam15.app.n8n.cloud/workflow/1QdoYrF1XVxT4Xyu" }] },
  { ...base, id: "benjaire-shop-delivery", name: "Shop delivery", status: "active", ownedBy: "benjaire-shop-manager", trigger: "Stripe webhook", links: [{ label: "n8n workflow", url: "https://khancam15.app.n8n.cloud/workflow/pjj7ORgRjeGGTIFL" }], registry: { governance: { approval: "None: buyer already paid" } } as Agent["registry"] },
  { ...base, id: "old-helper", name: "Old helper", status: "retired", ownedBy: "benjaire-shop-manager", links: [{ label: "n8n workflow", url: "https://khancam15.app.n8n.cloud/workflow/OLDOLDOLD123" }] },
  { ...base, id: "gone-persona", name: "Gone", status: "retired", links: [], registry: { identity: { displayName: "Retired Person" } } as Agent["registry"] },
];

const wf = (id: string, name: string, extra: Partial<N8nWorkflowRuns> = {}): N8nWorkflowRuns => ({ id, name, active: true, runs: [], failures24h: 0, schedules: [], timezone: NY, savesSuccess: true, ...extra });
const snap = (workflows: N8nWorkflowRuns[]): N8nSnapshot => ({ state: "ok", instance: "https://khancam15.app.n8n.cloud", fetchedAt: "2026-11-18T20:00:00Z", window: 250, workflows });

function input(now: number, workflows: N8nWorkflowRuns[], ledger: Ledger = new Map(), tasks: StoredTask[] = []): OpsInput {
  return { agents: AGENTS, n8n: snap(workflows), repos: {}, tasks, seen: ledger, personaOf: (id) => AGENTS.find((a) => a.id === id)?.ownedBy ?? id, now };
}

describe("agent operations from real runs", () => {
  const now = Date.parse("2026-11-18T20:30:00Z");
  it("maps owned workflows to the agent, leaving out retired automations and archived agents", () => {
    expect(ownedEntries(AGENTS, "benjaire-shop-manager").map((a) => a.id)).toEqual(["benjaire-shop-manager", "benjaire-shop-follow-ups", "benjaire-shop-delivery"]);
    expect(ownedEntries(AGENTS, "gone-persona")).toEqual([]);
    const ops = agentOps("benjaire-shop-manager", input(now, [wf("1QdoYrF1XVxT4Xyu", "Shop · Flow follow ups", { schedules: [{ label: "Every 4 hours", cron: "48 */4 * * *" }], runs: [{ id: "785", status: "success", mode: "trigger", startedAt: "2026-11-18T17:00:48Z", stoppedAt: "2026-11-18T17:00:49Z" }] }), wf("pjj7ORgRjeGGTIFL", "Shop · Flow Starter delivery")]));
    expect(ops.workflows.map((w) => [w.name, w.connection])).toEqual([
      ["Shop · Flow follow ups", "verified"],
      ["Shop · Flow Starter delivery", "connected"],
    ]);
    expect(ops.workflows[1].approval).toBe("None: buyer already paid");
    // 4:48pm EST is 21:48 UTC.
    expect(new Date(ops.next!.at).toISOString()).toBe("2026-11-18T21:48:00.000Z");
    expect(ops.state).toBe("succeeded");
    expect(ops.runs[0]).toMatchObject({ agentId: "benjaire-shop-follow-ups", status: "succeeded", url: "https://khancam15.app.n8n.cloud/workflow/1QdoYrF1XVxT4Xyu/executions/785" });
  });
  it("labels drafts, missing workflows and workflows that don't keep successful runs", () => {
    const ops = agentOps("benjaire-shop-manager", input(now, [wf("1QdoYrF1XVxT4Xyu", "Follow ups", { active: false }), ]));
    expect(ops.workflows.map((w) => w.connection)).toEqual(["draft", "configured"]);
    const silent = agentOps("benjaire-shop-manager", input(now, [wf("1QdoYrF1XVxT4Xyu", "Follow ups", { savesSuccess: false }), wf("pjj7ORgRjeGGTIFL", "Delivery")]));
    expect(silent.missing.join(" ")).toContain("doesn't keep successful runs");
    const offline = agentOps("benjaire-shop-manager", { ...input(now, []), n8n: null });
    expect(offline.live).toBe(false);
    expect(offline.workflows.every((w) => w.connection === "configured")).toBe(true);
  });
  it("shows approval waits, retries, failures, cancellations and lost runs as they are", () => {
    const runs = [
      { id: "10", status: "waiting" as const, mode: "webhook", startedAt: "2026-11-18T20:20:00Z", stoppedAt: null },
      { id: "9", status: "error" as const, mode: "retry", startedAt: "2026-11-18T20:10:00Z", stoppedAt: "2026-11-18T20:10:05Z" },
      { id: "8", status: "canceled" as const, mode: "manual", startedAt: "2026-11-18T20:00:00Z", stoppedAt: "2026-11-18T20:01:00Z" },
      { id: "7", status: "running" as const, mode: "trigger", startedAt: "2026-11-18T10:00:00Z", stoppedAt: null },
    ];
    const ops = agentOps("benjaire-shop-manager", input(now, [wf("pjj7ORgRjeGGTIFL", "Delivery", { runs })]));
    expect(ops.runs.map((r) => r.status)).toEqual(["waiting", "failed", "cancelled", "failed"]);
    expect(ops.runs[1].retry).toBe(true);
    expect(ops.runs[3].detail).toContain("lost");
    expect(ops.state).toBe("running");
    const task = { id: "t1", title: "Approve refund", status: "awaiting_approval", agentId: "benjaire-shop-delivery", attempts: [], createdAt: "2026-11-18T20:25:00Z", updatedAt: "2026-11-18T20:25:00Z", source: "manual" } as unknown as StoredTask;
    const withTask = agentOps("benjaire-shop-manager", input(now, [wf("pjj7ORgRjeGGTIFL", "Delivery")], new Map(), [task]));
    expect(withTask.state).toBe("waiting_approval");
  });
});

describe("the run ledger", () => {
  it("dates history by its own times and keeps new sightings at now, so reloads don't replay", () => {
    const l: Ledger = new Map();
    const now = Date.parse("2026-11-18T20:30:00Z");
    observe(l, [{ key: "n8n:a:1", status: "succeeded", finished: true, startedAt: now - 3 * 3_600_000, stoppedAt: now - 3 * 3_600_000 + 2000 }], now);
    expect(l.get("n8n:a:1:succeeded")).toBe(now - 3 * 3_600_000 + 2000);
    observe(l, [{ key: "n8n:a:2", status: "succeeded", finished: true, startedAt: now - 60_000, stoppedAt: now - 58_000 }], now);
    expect(l.get("n8n:a:2:succeeded")).toBe(now);
    // Seen again later: unchanged.
    expect(observe(l, [{ key: "n8n:a:2", status: "succeeded", finished: true, startedAt: now - 60_000, stoppedAt: now - 58_000 }], now + HISTORY_MS * 2)).toBe(false);
    expect(l.get("n8n:a:2:succeeded")).toBe(now);
  });
});

// ------------------------------------------------------------------------- the city day

const OPTIONS: LeisureOption[] = [
  { id: "park", kind: "park", label: "Relaxing in the park", spot: "park", exit: "park", stay: [300, 600] },
  { id: "wheel", kind: "wheel", label: "Riding the Ferris wheel", spot: "wheel", exit: "wheel", stay: [0, 0] },
];
/** Distances in walking seconds between named spots; anchors along a walk count as their target. */
const DIST: Record<string, number> = { "home>office": 120, "office>home": 120, "home>park": 60, "park>home": 60, "park>office": 90, "office>park": 90, "home>wheel": 100, "wheel>home": 100, "wheel>office": 80, "office>wheel": 80, "park>wheel": 40, "wheel>park": 40 };
const spotOf = (a: Anchor): string => ("spot" in a ? a.spot : a.f < 0.5 ? spotOf(a.from) : a.to);
const env = (wheelBoardDelay = 20): RoutineEnv => ({
  travel: (from, to) => (spotOf(from) === to ? 0 : (DIST[`${spotOf(from)}>${to}`] ?? 200)),
  ride: (_o, arrive) => ({ board: arrive + wheelBoardDelay * 1000, alight: arrive + (wheelBoardDelay + 140) * 1000, seat: "cabin 3" }),
  rideExit: (_o, times, at) => Math.min(times.alight, at + 30_000),
  home: "home",
  office: "office",
  leisure: OPTIONS,
});

const opsWith = (now: number, runs: N8nWorkflowRuns["runs"], ledger: Ledger = new Map(), schedules = [{ label: "Daily 3pm", cron: "0 15 * * *" }]): AgentOps =>
  agentOps("benjaire-shop-manager", input(now, [wf("1QdoYrF1XVxT4Xyu", "Follow ups", { schedules, runs }), wf("pjj7ORgRjeGGTIFL", "Delivery")], ledger));

const phases = (segs: Segment[], from: number, to: number) => segs.filter((s) => s.t1 > from && s.t0 < to).map((s) => s.phase ?? s.activity);

describe("one scheduled task, end to end", () => {
  // Daily 3pm New York run = 20:00 UTC on 18 Nov.
  const run = Date.parse("2026-11-18T20:00:00Z");
  it("commutes ahead, is seated before the run, works only while it runs, then goes back to free time", () => {
    const before = run - 30 * MIN;
    const r = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(before, []), env: env(), now: before });
    const desk = r.segments.find((s) => s.phase === "to_desk")!;
    const head = r.segments.find((s) => s.phase === "heading")!;
    expect(head.t0).toBeLessThan(run);
    expect(desk.t1).toBeLessThanOrEqual(run);
    // The run is seen (started 15:00:00, done 15:00:02, reported a minute later): working, completed, leaving, free.
    const l: Ledger = new Map();
    const after = run + 3 * MIN;
    const runs = [{ id: "900", status: "success" as const, mode: "trigger", startedAt: "2026-11-18T20:00:00Z", stoppedAt: "2026-11-18T20:00:02Z" }];
    observe(l, sightingsOf(opsWith(run + MIN, runs).runs), run + MIN);
    const done = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(after, runs, l), env: env(), now: after });
    expect(phases(done.segments, run - 20 * MIN, run + 10 * MIN)).toEqual(expect.arrayContaining(["heading", "entering", "to_desk", "working", "completed", "leaving"]));
    const working = done.segments.filter((s) => s.phase === "working").pop()!;
    expect(working.t1).toBe(run + MIN); // until Atlas saw the result, never longer
    expect(done.segments.find((s) => s.phase === "completed")!.note).toContain("succeeded");
    const free = segmentAt(done, run + MIN + 40_000)!;
    expect(free.phase).toBeNull();
    // The same inputs give the same day: a reload draws the same picture.
    const again = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(after, runs, l), env: env(), now: after });
    expect(again.segments).toEqual(done.segments);
  });

  it("waits at the desk while n8n reports a due run, without claiming a result", () => {
    const now = run + 4 * MIN;
    const r = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(now, []), env: env(), now });
    const seg = segmentAt(r, now)!;
    expect(seg.phase).toBe("working");
    expect(seg.note).toContain("waiting for n8n to report");
    const later = run + 20 * MIN;
    const r2 = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(later, []), env: env(), now: later });
    expect(r2.segments.find((s) => s.phase === "completed")!.note).toContain("no run reported");
  });
});

describe("unexpected work, short work and rides", () => {
  const now0 = Date.parse("2026-11-18T19:00:00Z"); // 2pm New York
  it("an unexpected run interrupts leisure and says execution already started", () => {
    const l: Ledger = new Map();
    const runs = [{ id: "50", status: "running" as const, mode: "webhook", startedAt: "2026-11-18T18:59:00Z", stoppedAt: null }];
    observe(l, sightingsOf(opsWith(now0, runs, l, []).runs), now0);
    const r = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(now0 + 30_000, runs, l, []), env: env(), now: now0 + 30_000 });
    const seg = segmentAt(r, now0 + 30_000)!;
    expect(seg.phase).toBe("heading");
    expect(seg.note).toContain("already started");
    // Open-ended: it works until the run list changes.
    expect(r.segments[r.segments.length - 1].phase).toBe("working");
  });

  it("a short run that finishes before arrival ends the walk without a fake work session", () => {
    const l: Ledger = new Map();
    const start = now0;
    const running = [{ id: "60", status: "running" as const, mode: "webhook", startedAt: new Date(start).toISOString(), stoppedAt: null }];
    observe(l, sightingsOf(opsWith(start, running, l, []).runs), start);
    const done = [{ id: "60", status: "success" as const, mode: "webhook", startedAt: new Date(start).toISOString(), stoppedAt: new Date(start + 2000).toISOString() }];
    observe(l, sightingsOf(opsWith(start + 40_000, done, l, []).runs), start + 40_000);
    const r = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(start + 60_000, done, l, []), env: env(), now: start + 60_000 });
    const around = r.segments.filter((s) => s.t1 > start && s.t0 < start + 120_000);
    expect(around.some((s) => s.phase === "working")).toBe(false);
    expect(around.find((s) => s.phase === "completed")!.note).toContain("finished before arrival");
  });

  it("concurrent and queued runs share one character and one desk", () => {
    const l: Ledger = new Map();
    const runs = [
      { id: "71", status: "running" as const, mode: "webhook", startedAt: "2026-11-18T18:50:00Z", stoppedAt: null },
      { id: "70", status: "running" as const, mode: "manual", startedAt: "2026-11-18T18:49:00Z", stoppedAt: null },
    ];
    observe(l, sightingsOf(opsWith(now0 - 10 * MIN, runs, l, []).runs), now0 - 10 * MIN);
    const r = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(now0, runs, l, []), env: env(), now: now0 });
    expect(r.episodes.filter((e) => e.runs.length).length).toBe(1);
    expect(segmentAt(r, now0)!.note).toContain("2 runs at once");
  });

  it("a failure shows on the completed step; an approval wait releases the agent but keeps the wait", () => {
    const l: Ledger = new Map();
    const failed = [{ id: "80", status: "error" as const, mode: "webhook", startedAt: "2026-11-18T18:40:00Z", stoppedAt: "2026-11-18T18:45:00Z" }];
    observe(l, sightingsOf(opsWith(now0 - 25 * MIN, [{ ...failed[0], status: "running", stoppedAt: null }], l, []).runs), now0 - 25 * MIN);
    observe(l, sightingsOf(opsWith(now0 - 14 * MIN, failed, l, []).runs), now0 - 14 * MIN);
    const r = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(now0, failed, l, []), env: env(), now: now0 });
    expect(r.segments.find((s) => s.phase === "completed")!.note).toContain("failed");
    const w = [{ id: "90", status: "waiting" as const, mode: "webhook", startedAt: "2026-11-18T18:30:00Z", stoppedAt: null }];
    const l2: Ledger = new Map();
    observe(l2, sightingsOf(opsWith(now0 - 30 * MIN, w, l2, []).runs), now0 - 30 * MIN);
    const r2 = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(now0, w, l2, []), env: env(), now: now0 });
    expect(segmentAt(r2, now0)!.phase).toBeNull();
  });

  it("boards and leaves a ride, and gets off safely when work calls", () => {
    // Find a day where the agent rides the wheel, then call it in mid-ride.
    let found: { r: ReturnType<typeof planRoutine>; ride: Segment } | null = null;
    for (let h = 0; h < 48 && !found; h++) {
      const now = now0 - 6 * 3_600_000 + h * 15 * MIN;
      const r = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(now, [], new Map(), []), env: env(), now });
      const ride = r.segments.find((s) => s.kind === "ride" && s.t0 < now && s.t1 > now);
      if (ride) found = { r, ride };
    }
    expect(found).not.toBeNull();
    const { ride } = found!;
    const queue = found!.r.segments[found!.r.segments.indexOf(ride) - 1];
    expect(queue.note).toContain("queue");
    const callAt = ride.t0 + 10_000;
    const l: Ledger = new Map();
    const runs = [{ id: "99", status: "running" as const, mode: "webhook", startedAt: new Date(callAt).toISOString(), stoppedAt: null }];
    observe(l, sightingsOf(opsWith(callAt, runs, l, []).runs), callAt);
    const r = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(callAt + 1000, runs, l, []), env: env(), now: callAt + 1000 });
    const cut = r.segments.find((s) => s.kind === "ride" && s.t0 === ride.t0)!;
    expect(cut.t1).toBe(callAt + 30_000); // the next safe exit, not instantly off a moving ride
    expect(cut.note).toContain("getting off");
    expect(segmentAt(r, callAt + 31_000)!.phase).toBe("heading");
  });

  it("agents with different ids keep different routines", () => {
    const now = Date.parse("2026-11-18T17:00:00Z");
    const a = planRoutine({ personaId: "a", ops: opsWith(now, [], new Map(), []), env: env(), now });
    const b = planRoutine({ personaId: "b", ops: opsWith(now, [], new Map(), []), env: env(), now });
    expect(a.segments.map((s) => s.note)).not.toEqual(b.segments.map((s) => s.note));
  });

  it("a paused routine keeps the character home and says the work is unaffected", () => {
    const r = planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(now0, [], new Map(), []), env: env(), now: now0, held: true });
    expect(segmentAt(r, now0)).toMatchObject({ activity: "at_home" });
    expect(segmentAt(r, now0)!.note).toContain("unaffected");
  });
});

describe("free time sent from Atlas", () => {
  const now0 = Date.parse("2026-11-18T19:00:00Z"); // 2pm New York, no schedule
  const plan = (now: number, outing: { kind: LeisureKind | "any"; at: number } | null, schedules: { label: string; cron: string }[] = []) =>
    planRoutine({ personaId: "benjaire-shop-manager", ops: opsWith(now, [], new Map(), schedules), env: env(), now, outing });

  it("sends a free agent to the chosen outing from that moment, leaving the day before it unchanged", () => {
    const at = now0;
    const without = plan(at + 5 * MIN, null);
    const r = plan(at + 5 * MIN, { kind: "wheel", at });
    // Before the request the day is exactly as it was.
    expect(r.segments.filter((s) => s.t1 < at)).toEqual(without.segments.filter((s) => s.t1 < at));
    const walk = r.segments.find((s): s is Extract<Segment, { kind: "walk" }> => s.t0 >= at && s.kind === "walk")!;
    expect(walk.t0).toBe(at);
    expect(walk.note).toContain("free time from Atlas");
    expect(walk.option?.kind).toBe("wheel");
    expect(r.segments.some((s) => s.kind === "ride" && s.t0 > at)).toBe(true);
    // Reload-safe: the same inputs give the same day.
    expect(plan(at + 5 * MIN, { kind: "wheel", at }).segments).toEqual(r.segments);
  });

  it("gets off a ride safely before going", () => {
    let found: Segment | null = null;
    for (let h = 0; h < 48 && !found; h++) {
      const now = now0 - 6 * 3_600_000 + h * 15 * MIN;
      found = plan(now, null).segments.find((s) => s.kind === "ride" && s.t0 < now && s.t1 > now) ?? null;
    }
    expect(found).not.toBeNull();
    const at = found!.t0 + 10_000;
    const r = plan(at + 1000, { kind: "park", at });
    const cut = r.segments.find((s) => s.kind === "ride" && s.t0 === found!.t0)!;
    expect(cut.t1).toBe(at + 30_000);
    expect(r.segments.find((s): s is Extract<Segment, { kind: "walk" }> => s.t0 >= cut.t1 && s.kind === "walk")!.option?.kind).toBe("park");
  });

  it("never touches work: a scheduled run still calls the agent in, and a too-close run means a short break", () => {
    // Daily 3pm New York = 20:00 UTC; asked at 2:57pm, there is no time for an outing.
    const run = Date.parse("2026-11-18T20:00:00Z");
    const at = run - 3 * MIN;
    const r = plan(at + 1000, { kind: "wheel", at }, [{ label: "Daily 3pm", cron: "0 15 * * *" }]);
    expect(r.segments.some((s) => s.kind === "ride" && s.t0 >= at && s.t0 < run)).toBe(false);
    expect(r.segments.find((s) => s.t0 >= at && s.phase === null)!.note).toContain("too close");
    expect(r.segments.find((s) => s.phase === "heading")!.t0).toBeLessThan(run);
    expect(r.segments.find((s) => s.phase === "to_desk")!.t1).toBeLessThanOrEqual(run);
  });

  it("is followed at night too, then the agent walks home for the night", () => {
    const night = Date.parse("2026-11-19T11:30:00Z"); // 6:30 AM New York, before the 7 AM morning
    const r = plan(night + MIN, { kind: "park", at: night });
    const walk = r.segments.find((s): s is Extract<Segment, { kind: "walk" }> => s.t0 >= night && s.kind === "walk")!;
    expect(walk.t0).toBe(night);
    expect(walk.option?.kind).toBe("park");
    expect(walk.note).toContain("free time from Atlas");
    const after = r.segments.filter((s) => s.t0 > walk.t1);
    expect(after.some((s) => s.kind === "stay" && s.option?.kind === "park")).toBe(true);
    // From home at midnight as well.
    const midnight = Date.parse("2026-11-19T05:00:00Z");
    const m = plan(midnight + MIN, { kind: "wheel", at: midnight });
    expect(segmentAt(m, midnight + 1000)).toMatchObject({ kind: "walk", activity: "walking" });
  });

  it("only offers free time to an agent in its free time", () => {
    const free = plan(now0, null);
    expect(freeTimeAvailability(segmentAt(free, now0), false)).toEqual({ ok: true });
    expect(freeTimeAvailability(segmentAt(free, now0), true).ok).toBe(false);
    expect(freeTimeAvailability(null, false).ok).toBe(false);
    const work = { kind: "inside", t0: 0, t1: 1, at: "office", activity: "at_desk", phase: "working", note: "", work: { label: "", runs: [], scheduledAt: null, alreadyStarted: false, outcome: null } } as Segment;
    expect(freeTimeAvailability(work, false)).toMatchObject({ ok: false, reason: expect.stringContaining("Busy") });
    const home = { kind: "stay", t0: 0, t1: 1, at: "home", activity: "at_home", phase: null, note: "At home for the night" } as Segment;
    expect(freeTimeAvailability(home, false)).toEqual({ ok: true });
  });

  it("keeps only today's valid requests", () => {
    const now = now0;
    const kept = freshRequests({ a: { kind: "wheel", at: now - MIN }, b: { kind: "wheel", at: now - FREE_TIME_KEEP_MS - 1 }, c: { kind: "rocket", at: now }, d: null }, now);
    expect([...kept.keys()]).toEqual(["a"]);
  });

  it("keeps how the agent travels, and older requests without it", () => {
    const now = now0;
    const kept = freshRequests({ a: { kind: "wheel", at: now, travel: "car" }, b: { kind: "park", at: now }, c: { kind: "park", at: now, travel: "rocket" } }, now);
    expect([...kept.keys()]).toEqual(["a", "b"]);
    expect(kept.get("a")?.travel).toBe("car");
  });
});
