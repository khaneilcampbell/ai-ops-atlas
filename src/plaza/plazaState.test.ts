import { describe, expect, it } from "vitest";
import type { N8nState } from "../n8n/runs";
import type { StoredTask } from "../tasks/types";
import type { WorkflowRun } from "../workflows/types";
import { N8N_FRESH_MS, abandonedTest, plazaEvents, plazaSnapshot, plazaSummary, previewSnapshot, signText, type PlazaInputs, type RuntimeLike } from "./plazaState";

const NOW = Date.parse("2026-11-18T18:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

const agents = [
  { id: "release", name: "Release Manager", projectId: "ai-ops-atlas", links: [] },
  { id: "health", name: "Health Monitor", projectId: "ai-ops-atlas", links: [] },
  { id: "scout", name: "Opportunity Scout", projectId: "commerce-pipeline", links: [{ label: "n8n workflow", url: "https://x.app.n8n.cloud/workflow/WF1" }] },
];
const projectNames = new Map([
  ["ai-ops-atlas", "Atlas Command Center"],
  ["commerce-pipeline", "Commerce Operations Center"],
]);

function task(id: string, status: StoredTask["status"], extra: Partial<StoredTask> = {}): StoredTask {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    status,
    priority: "medium",
    source: "manual",
    dependencyIds: [],
    requiresApproval: false,
    createdAt: iso(30),
    updatedAt: iso(1),
    rev: 1,
    createdBy: { kind: "person", id: "khaneil", name: "Khaneil" },
    categories: [],
    maxAttempts: 3,
    attempts: [],
    approvals: [],
    artifacts: [],
    usage: [],
    events: [],
    eventsTrimmed: 0,
    ...extra,
  };
}

const idle = (at = iso(60)): RuntimeLike => ({ state: "idle", reason: "Last run passed.", source: "github", basis: { at, result: "success", label: "CI", url: "https://github.com/x/y/actions/runs/1" } });
const off: N8nState = { state: "off", message: "n8n runs are read by the hosted site and the Mac app.", value: null };

function inputs(p: Partial<PlazaInputs> = {}): PlazaInputs {
  return { agents, projectNames, runtimes: new Map(), tasks: [], runs: [], n8n: off, now: NOW, ...p };
}

describe("plaza snapshot", () => {
  it("reads Status unavailable when no execution source has current data", () => {
    const s = plazaSnapshot(inputs({ tasks: [task("a", "running", { agentId: "release" })] }));
    expect(s.connection).toBe("unavailable");
    expect(signText(s)).toMatchObject({ status: "Status unavailable", tone: "unavailable" });
    expect(plazaSummary(s)).toContain("status unavailable");
    expect(s.sources.find((x) => x.id === "agents")?.state).toBe("off");
  });

  it("treats stale agent reports and an old n8n summary as not live", () => {
    const old: N8nState = { state: "ready", message: null, value: { state: "ok", instance: "https://x.app.n8n.cloud", fetchedAt: new Date(NOW - N8N_FRESH_MS - 1).toISOString(), window: 50, workflows: [{ id: "WF1", name: "Scout", active: true, failures24h: 0, runs: [{ id: "9", status: "running", mode: "trigger", startedAt: iso(2), stoppedAt: null }] }] } };
    const s = plazaSnapshot(inputs({ runtimes: new Map([["release", { state: "stale", reason: "", source: "agent-feed", basis: null }]]), n8n: old }));
    expect(s.connection).toBe("unavailable");
    expect(s.running).toHaveLength(0);
    expect(s.sources.find((x) => x.id === "n8n")?.state).toBe("stale");
  });

  it("is live and idle with real counts of zero, never the reference image's sample", () => {
    const s = plazaSnapshot(inputs({ runtimes: new Map([["release", idle()]]) }));
    expect(s.connection).toBe("live");
    expect(signText(s)).toEqual({ status: "0 running · 0 queued", note: null, tone: "live" });
    expect(plazaSummary(s)).toContain("Idle");
  });

  it("leaves out an n8n editor test that has waited more than a day, but keeps real waiting runs", () => {
    const day = 24 * 60;
    const n8n: N8nState = {
      state: "ready",
      message: null,
      value: {
        state: "ok",
        instance: "https://x.app.n8n.cloud",
        fetchedAt: new Date(NOW - 60_000).toISOString(),
        window: 50,
        workflows: [
          {
            id: "WF1",
            name: "Scout daily",
            active: true,
            failures24h: 0,
            runs: [
              { id: "1", status: "waiting", mode: "manual", startedAt: iso(124 * 60), stoppedAt: null },
              { id: "2", status: "waiting", mode: "manual", startedAt: iso(30), stoppedAt: null },
            ],
          },
          { id: "WF9", name: "Approve", active: true, failures24h: 0, runs: [{ id: "3", status: "waiting", mode: "webhook", startedAt: iso(175 * 60), stoppedAt: null }] },
        ],
      },
    };
    const s = plazaSnapshot(inputs({ n8n }));
    expect(s.running.map((r) => r.id)).toEqual(["n8n:3", "n8n:2"]);
    expect(abandonedTest({ mode: "manual", status: "waiting", startedAt: iso(day + 1) }, NOW)).toBe(true);
    expect(abandonedTest({ mode: "manual", status: "running", startedAt: iso(day + 1) }, NOW)).toBe(false);
    expect(abandonedTest({ mode: "manual", status: "waiting", startedAt: null }, NOW)).toBe(false);
  });

  it("counts running and queued work from tasks, runtimes and n8n, once per piece of work", () => {
    const fresh: N8nState = {
      state: "ready",
      message: null,
      value: {
        state: "ok",
        instance: "https://x.app.n8n.cloud",
        fetchedAt: new Date(NOW - 60_000).toISOString(),
        window: 50,
        workflows: [
          {
            id: "WF1",
            name: "Scout daily",
            active: true,
            failures24h: 0,
            runs: [
              { id: "77", status: "running", mode: "trigger", startedAt: iso(3), stoppedAt: null },
              { id: "78", status: "new", mode: "trigger", startedAt: null, stoppedAt: null },
            ],
          },
          { id: "WF9", name: "Unlisted", active: true, failures24h: 0, runs: [{ id: "90", status: "running", mode: "webhook", startedAt: iso(1), stoppedAt: null }] },
        ],
      },
    };
    const run: WorkflowRun = {
      id: "r1",
      goalId: "g",
      definitionId: "d",
      definitionVersion: 1,
      snapshot: { id: "d", version: 1, name: "Weekly launch", updatedAt: iso(100), nodes: [{ id: "n1", kind: "agent", stage: 1, title: "Draft notes", summary: "", inputs: [], outputs: [], execution: { kind: "manual", note: "" }, agentId: "release" }], edges: [] },
      mode: "live",
      createdAt: iso(20),
      createdBy: "khaneil",
      nodeTasks: { n1: "t1" },
      errors: {},
    };
    const s = plazaSnapshot(
      inputs({
        // The release manager's task and its verified GitHub run are the same work: one entry, both links.
        tasks: [task("t1", "running", { agentId: "release", startedAt: iso(5) }), task("t2", "queued", { agentId: "health" }), task("t3", "blocked", { agentId: "health" })],
        runtimes: new Map<string, RuntimeLike>([
          ["release", { state: "working", reason: "A run is in progress.", source: "github", basis: { at: iso(4), result: "running", label: "Release", url: "https://github.com/x/y/actions/runs/2" } }],
          ["health", idle()],
        ]),
        runs: [run],
        n8n: fresh,
      }),
    );
    expect(s.running.map((r) => r.id)).toEqual(["task:t1", "n8n:77", "n8n:90"]);
    const t1 = s.running[0];
    expect(t1).toMatchObject({ title: "Weekly launch", step: "Draft notes", agentName: "Release Manager", buildingKey: "project:ai-ops-atlas", buildingName: "Atlas Command Center", startedAt: iso(5) });
    expect(t1.links.map((l) => l.label)).toEqual(["Open in Task Center", "GitHub run"]);
    expect(s.running[1]).toMatchObject({ agentName: "Opportunity Scout", buildingKey: "project:commerce-pipeline" });
    expect(s.running[1].links[0].url).toBe("https://x.app.n8n.cloud/workflow/WF1/executions/77");
    // A workflow no agent links to has no building: nothing is guessed.
    expect(s.running[2].buildingKey).toBeUndefined();
    // Queued: the Task Center's queue, n8n's own queue, and a task waiting on its dependencies.
    expect(s.queued.map((q) => q.id).sort()).toEqual(["n8n:78", "task:t2", "task:t3"]);
    expect(signText(s).status).toBe("3 running · 3 queued");
  });

  it("lists what needs attention with the real reason", () => {
    const s = plazaSnapshot(
      inputs({
        tasks: [task("f", "failed", { agentId: "health", error: "Timed out" }), task("w", "awaiting_approval", { agentId: "release" })],
        runtimes: new Map<string, RuntimeLike>([
          ["health", { state: "failed", reason: "Latest run failed.", source: "github", basis: { at: iso(9), result: "failure", label: "CI", url: "https://github.com/x/y/actions/runs/3" } }],
          ["scout", idle()],
        ]),
      }),
    );
    // The failed task and the failed run of the same agent show once, from the task.
    expect(s.attention.map((a) => [a.id, a.status, a.detail])).toEqual([
      ["task:f", "failed", "Failed: Timed out"],
      ["task:w", "awaiting_approval", "Waiting for Khaneil's approval before it can run."],
    ]);
    expect(signText(s)).toMatchObject({ tone: "attention", note: "2 need attention: Task f failed" });
  });
});

describe("plaza events", () => {
  const live = (p: Partial<PlazaInputs>) => plazaSnapshot(inputs({ runtimes: new Map([["scout", idle()]]), ...p }));

  it("treats the first reading as a baseline, then fires each transition once", () => {
    const seen = new Map<string, number>();
    const recent = new Map<string, { agentId?: string; at: number }>();
    const a = live({ tasks: [task("t1", "running", { agentId: "release", startedAt: iso(2) })] });
    expect(plazaEvents(null, a, seen, recent, NOW)).toEqual([]);
    const b = live({ tasks: [task("t1", "completed", { agentId: "release", startedAt: iso(2) }), task("t2", "running", { agentId: "health", startedAt: iso(0) })] });
    const events = plazaEvents(a, b, seen, recent, NOW + 1000);
    // The release manager finished and the health monitor started in the same building: a handoff.
    expect(events.map((e) => [e.kind, e.itemId, e.buildingKey])).toEqual([
      ["complete", "task:t1", "project:ai-ops-atlas"],
      ["handoff", "task:t2", "project:ai-ops-atlas"],
    ]);
    // The same change seen again (a repeated poll) fires nothing.
    expect(plazaEvents(a, b, seen, recent, NOW + 2000)).toEqual([]);
  });

  it("starts without a handoff when nothing finished nearby, and flags new attention", () => {
    const seen = new Map<string, number>();
    const recent = new Map<string, { agentId?: string; at: number }>();
    const a = live({});
    const b = live({ tasks: [task("t3", "running", { agentId: "scout" }), task("t4", "failed", { agentId: "health", error: "No key" })] });
    expect(plazaEvents(a, b, seen, recent, NOW).map((e) => e.kind)).toEqual(["start", "attention"]);
  });

  it("clears a run that left without a known result quietly, and fires nothing while unavailable", () => {
    const seen = new Map<string, number>();
    const recent = new Map<string, { agentId?: string; at: number }>();
    const a = live({ tasks: [task("t5", "running")] });
    expect(plazaEvents(a, live({}), seen, recent, NOW)).toEqual([]);
    const down = plazaSnapshot(inputs({ tasks: [task("t6", "running")] }));
    expect(plazaEvents(a, down, seen, recent, NOW)).toEqual([]);
  });

  it("never mixes the sample preview with live data", () => {
    const seen = new Map<string, number>();
    const recent = new Map<string, { agentId?: string; at: number }>();
    const p = previewSnapshot(agents, projectNames, NOW, 0);
    expect(p.preview).toBe(true);
    expect(signText(p)).toMatchObject({ tone: "preview", note: "Not live data" });
    expect(p.running.every((r) => r.title.startsWith("Sample"))).toBe(true);
    expect(plazaEvents(live({}), p, seen, recent, NOW)).toEqual([]);
    expect(plazaEvents(p, live({}), seen, recent, NOW)).toEqual([]);
  });
});
