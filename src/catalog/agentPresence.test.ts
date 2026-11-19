import { describe, expect, it, vi } from "vitest";

// A tiny localStorage so saved assignments persist as they do in the app.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const presence = await import("./agentPresence");
const { presenceAt, validateAssignment, setAssignment, getAssignments } = presence;
type A = import("./agentPresence").PresenceAssignment;
const { catalog } = await import(".");
const { agentJobs } = await import("./agentJobs");
const { runtimeFor } = await import("../views/office/model");

const day: A = { home: "circa", work: "x", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timeZone: "America/New_York" };
// 2026-11-16 is a Monday; New York is UTC-5 in November.
const ny = (hhmm: string, date = "2026-11-16") => new Date(`${date}T${hhmm}:00-05:00`);

describe("presence schedule", () => {
  it("walks to work, works, walks home, spends an hour outdoors, then stays home", () => {
    expect(presenceAt(day, ny("08:30"))).toEqual({ place: "home", progress: 0 });
    expect(presenceAt(day, ny("08:50"))).toMatchObject({ place: "to-work", progress: 0.5 });
    expect(presenceAt(day, ny("09:00")).place).toBe("work");
    expect(presenceAt(day, ny("16:59")).place).toBe("work");
    expect(presenceAt(day, ny("17:05"))).toMatchObject({ place: "to-home", progress: 0.25 });
    expect(presenceAt(day, ny("17:30")).place).toBe("outdoors");
    expect(presenceAt(day, ny("18:30")).place).toBe("home");
  });

  it("reads the wall clock in the schedule's own time zone", () => {
    const tokyo = { ...day, timeZone: "Asia/Tokyo" };
    // 10:00 Tuesday in Tokyo is 20:00 Monday in New York.
    expect(presenceAt(tokyo, ny("20:00")).place).toBe("work");
    expect(presenceAt(day, ny("20:00")).place).toBe("home");
  });

  it("keeps an overnight shift across midnight and into the next day", () => {
    const night = { ...day, days: [5], start: "22:00", end: "06:00" }; // Friday night
    expect(presenceAt(night, ny("21:50", "2026-11-20")).place).toBe("to-work");
    expect(presenceAt(night, ny("23:30", "2026-11-20")).place).toBe("work");
    expect(presenceAt(night, ny("05:59", "2026-11-21")).place).toBe("work");
    expect(presenceAt(night, ny("06:10", "2026-11-21")).place).toBe("to-home");
  });

  it("keeps a 09:00 start at 09:00 local across the daylight-saving change", () => {
    // 2026-11-01 New York left daylight time; Monday 2 Nov 09:00 EST and Monday 26 Oct 09:00 EDT.
    expect(presenceAt(day, new Date("2026-10-26T13:00:00Z")).place).toBe("work");
    expect(presenceAt(day, new Date("2026-10-26T12:59:00Z")).place).toBe("to-work");
    expect(presenceAt(day, new Date("2026-11-02T14:00:00Z")).place).toBe("work");
    expect(presenceAt(day, new Date("2026-11-02T13:30:00Z")).place).toBe("home");
  });

  it("is outdoors at midday on a day off, home otherwise", () => {
    expect(presenceAt(day, ny("12:30", "2026-11-22")).place).toBe("outdoors");
    expect(presenceAt(day, ny("15:00", "2026-11-22")).place).toBe("home");
  });

  it("depends only on the clock, so a restart lands on the current place without replaying walks", () => {
    const at = ny("13:00");
    expect(presenceAt(day, at)).toEqual(presenceAt(JSON.parse(JSON.stringify(day)), new Date(at.getTime())));
  });
});

describe("assignments", () => {
  const agent = catalog.agents.find((a) => agentJobs(catalog).some((j) => j.agentId === a.id))!;
  const project = catalog.projects[0];

  it("validates in plain words", () => {
    expect(validateAssignment({ ...day, work: project.id }, ["circa"], [project.id])).toEqual([]);
    expect(validateAssignment({ ...day, home: "gone", work: "gone", days: [], start: "9am", timeZone: "Mars/Base" }, ["circa"], [project.id])).toHaveLength(5);
    expect(validateAssignment({ ...day, end: "09:00", work: project.id }, ["circa"], [project.id])).toEqual(["Start and end times must differ."]);
  });

  it("saves by stable agent id, survives a reload, and clears", async () => {
    setAssignment(agent.id, { ...day, work: project.id });
    expect(JSON.parse(mem.get("atlas:agent-presence")!)[agent.id].work).toBe(project.id);
    vi.resetModules();
    const reloaded = await import("./agentPresence");
    expect(reloaded.getAssignments()[agent.id]).toMatchObject({ start: "09:00", work: project.id });
    setAssignment(agent.id, null);
    expect(getAssignments()[agent.id]).toBeUndefined();
  });

  it("applies a saved home and workplace to the job, and ignores one whose workplace is gone", () => {
    const job = agentJobs(catalog, { [agent.id]: { ...day, home: "residence", work: project.id } }).find((j) => j.agentId === agent.id)!;
    expect(job).toMatchObject({ presence: { home: "residence" }, home: { building: "residence" }, work: { projectId: project.id } });
    const gone = agentJobs(catalog, { [agent.id]: { ...day, work: "deleted-project" } }).find((j) => j.agentId === agent.id)!;
    expect(gone.presence).toBeUndefined();
    expect(gone).toEqual(agentJobs(catalog).find((j) => j.agentId === agent.id));
  });

  it("never changes what telemetry says the agent is doing", () => {
    const t = { source: "github" as const, loaded: true, executions: [{ at: "2026-11-16T14:00:00Z", result: "failure" as const }], lastVerifiedRun: null, lastAnyRun: null, successRate: null, failures: 1, avgDurationMs: null, monthSpendUsd: null, monthBudgetUsd: null } as unknown as Parameters<typeof runtimeFor>[1];
    // Walking to work on the schedule while the latest run failed: two separate answers.
    expect(presenceAt(day, ny("08:50")).place).toBe("to-work");
    expect(runtimeFor({ id: agent.id, status: "active" }, t).state).toBe("failed");
  });
});

describe("agentPlacement", async () => {
  const { agentPlacement } = await import("./agentJobs");
  const agent = catalog.agents.find((a) => agentJobs(catalog).some((j) => j.agentId === a.id))!;
  const project = catalog.projects[0];
  it("gives a default workplace from the agent's own project when no schedule is saved", () => {
    const p = agentPlacement(catalog, agent.id, {})!;
    expect(p).toMatchObject({ work: { building: agent.projectId, source: "default" }, place: null });
    expect(p.home.label).toBeTruthy();
  });
  it("follows a saved schedule, with the current place", () => {
    expect(agentPlacement(catalog, agent.id, { [agent.id]: { ...day, work: project.id } }, ny("08:50"))).toMatchObject({ work: { building: project.id, source: "schedule" }, place: "to-work" });
  });
  it("is undefined for automations and unknown ids", () => {
    expect(agentPlacement(catalog, "no-such-agent", {})).toBeUndefined();
  });
});
