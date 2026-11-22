import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { ownership } from "../catalog/ownership";
import { isAiAgent } from "../catalog/roles";
import type { N8nSnapshot } from "../n8n/types";
import { n8nWorkflowIds } from "../n8n/links";
import { plazaSnapshot } from "../plaza/plazaState";
import { agentProfiles } from "../tasks/registry";
import { runtimeFor } from "../views/office/model";
import { agentTelemetry, buildRegistry, telemetryById } from "./registry";
import { n8nExecutions, withOwnedRuns } from "./telemetry";
import type { Telemetry } from "./types";

// Owning agents (catalog owned_by) run through their automations. Their n8n workflows are linked on
// those automations, so the agent's live state has to come from them, not "Not connected".

const NOW = Date.parse("2026-11-19T00:30:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const INSTANCE = "https://khancam15.app.n8n.cloud";
const REGISTRY_SYNC = "JCjTTvb7qZLpVXhs";
const FACTORY = "FTCanpGAYPIr3OGe";

const snapshot = (workflows: Extract<N8nSnapshot, { state: "ok" }>["workflows"]): N8nSnapshot => ({ state: "ok", instance: INSTANCE, fetchedAt: iso(1), window: 50, workflows });
const ok = snapshot([
  { id: REGISTRY_SYNC, name: "Atlas · Agent Registry", active: true, failures24h: 0, runs: [{ id: "901", status: "success", mode: "trigger", startedAt: iso(40), stoppedAt: iso(39) }] },
  { id: FACTORY, name: "Atlas · Agent Factory", active: true, failures24h: 0, runs: [] },
]);
const intel = (n8n: N8nSnapshot | null) => ({ runs: [], agentRuns: [], production: [], observedAt: new Date(NOW).toISOString(), n8n });
const agent = (id: string) => catalog.agents.find((a) => a.id === id)!;

describe("n8n runs as a live source", () => {
  it("reads only the runs of the workflows the agent links to, with a link to each execution", () => {
    const runs = n8nExecutions(agent("agent-registry-sync"), ok);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ result: "success", source: "n8n", url: `${INSTANCE}/workflow/${REGISTRY_SYNC}/executions/901`, durationMs: 60_000 });
    expect(n8nExecutions(agent("atlas-agent-factory"), ok)).toEqual([]);
    expect(n8nExecutions(agent("agent-registry-sync"), { state: "not-configured", need: "A key" })).toEqual([]);
  });

  it("makes an n8n automation's state come from its runs, and says when n8n hasn't loaded", () => {
    const byId = telemetryById(catalog, {}, intel(ok));
    const sync = byId.get("agent-registry-sync")!;
    expect(sync).toMatchObject({ source: "n8n", loaded: true });
    expect(runtimeFor(agent("agent-registry-sync"), sync, undefined, 0, NOW)).toMatchObject({ state: "idle", source: "n8n runs" });
    const notYet = telemetryById(catalog, {}, intel(null)).get("agent-registry-sync")!;
    expect(runtimeFor(agent("agent-registry-sync"), notYet, undefined, 0, NOW).state).toBe("unknown");
  });
});

describe("owning agents run through their automations", () => {
  it("connects Agent Operations Lead to Atlas Executive, Registry Sync, Agent Factory, Step Runner and Task Writer", () => {
    const t = agentTelemetry(catalog, agent("agent-operations-lead"), {}, intel(ok));
    expect(t.source).toBe("automations");
    expect(t.loaded).toBe(true);
    expect(t.via).toEqual(["atlas-executive", "agent-registry-sync", "atlas-agent-factory", "atlas-step-runner", "atlas-task-writer"].map((id) => agent(id).name));
    expect(t.executions[0].label.startsWith(agent("agent-registry-sync").name)).toBe(true);
    const r = runtimeFor(agent("agent-operations-lead"), t, undefined, 0, NOW);
    expect(r.state).toBe("idle");
    expect(r.reason).not.toMatch(/No live telemetry source/);
    expect(r.source).toMatch(/^Its automations/);
  });

  it("takes on a failing workflow, so the agent shows Failed", () => {
    const failing = snapshot([{ id: FACTORY, name: "Atlas · Agent Factory", active: true, failures24h: 1, runs: [{ id: "77", status: "error", mode: "trigger", startedAt: iso(5), stoppedAt: iso(4) }] }]);
    const t = agentTelemetry(catalog, agent("agent-operations-lead"), {}, intel(failing));
    expect(runtimeFor(agent("agent-operations-lead"), t, undefined, 0, NOW).state).toBe("failed");
  });

  it("gives every owning agent whose automations report a live source of its own (none left Not connected)", () => {
    const byId = telemetryById(catalog, {}, intel(ok));
    const { owned } = ownership(catalog);
    const leftOut = [...owned.entries()].filter(([, autos]) => autos.some((a) => byId.get(a.id)!.source)).filter(([id]) => !byId.get(id)!.source).map(([id]) => id);
    expect(leftOut).toEqual([]);
    // The ten owning agents from 2026-11-13 all own automations with a live source.
    for (const id of ["agent-operations-lead", "atlas-release-manager", "atlas-health-monitor", "benjaire-inquiry-manager", "benjaire-shop-manager", "benjaire-ops-monitor", "development-hub-lead", "commerce-operations-manager", "documentation-lead", "soc-detection-lead"]) {
      expect(byId.get(id)?.source, id).toBeTruthy();
    }
  });

  it("matches buildRegistry, which the map, office desks and cards use", () => {
    const entry = buildRegistry(catalog, {}, intel(ok)).find((e) => e.profile.id === "agent-operations-lead")!;
    expect(entry.telemetry.source).toBe("automations");
    expect(entry.operational).toBe("verified");
  });

  it("never borrows evidence when the agent has a source of its own, or owns nothing with one", () => {
    const own: Telemetry = { source: "github", loaded: true, executions: [], lastVerifiedRun: null, lastAnyRun: null, successRate: null, failures: 0, avgDurationMs: null, monthSpendUsd: null, monthBudgetUsd: null };
    const other: Telemetry = { ...own, source: "n8n", executions: [{ at: iso(1), result: "failure", label: "x", source: "n8n" }] };
    expect(withOwnedRuns(own, [{ name: "A", telemetry: other }])).toBe(own);
    const none: Telemetry = { ...own, source: null };
    expect(withOwnedRuns(none, [{ name: "A", telemetry: none }])).toBe(none);
  });

  it("lets a Task Center task for an owning agent point at its automations' n8n workflows", () => {
    const p = agentProfiles(catalog).find((x) => x.id === "agent-operations-lead")!;
    expect(p.workflows.filter((w) => w.kind === "n8n").map((w) => w.id)).toEqual(expect.arrayContaining([REGISTRY_SYNC, FACTORY, "tGYMec2rp0twZFxv"]));
  });
});

describe("plaza names the agent each workflow works for", () => {
  it("shows a running Registry Sync run as Agent Operations Lead's work, once", () => {
    const running = snapshot([{ id: REGISTRY_SYNC, name: "Atlas · Agent Registry", active: true, failures24h: 0, runs: [{ id: "950", status: "running", mode: "trigger", startedAt: iso(1), stoppedAt: null }] }]);
    const t = telemetryById(catalog, {}, intel(running));
    const runtimes = new Map(catalog.agents.map((a) => [a.id, runtimeFor(a, t.get(a.id)!, undefined, 0, NOW)]));
    const s = plazaSnapshot({ agents: catalog.agents, projectNames: new Map(catalog.projects.map((p) => [p.id, p.name])), runtimes, tasks: [], runs: [], n8n: { state: "ready", message: null, value: running }, now: NOW });
    expect(s.running).toHaveLength(1);
    expect(s.running[0]).toMatchObject({ id: "n8n:950", agentId: "agent-operations-lead", agentName: agent("agent-operations-lead").name, title: "Atlas · Agent Registry" });
  });

  it("every n8n workflow an automation links to names that automation's owning AI agent", () => {
    const ai = new Set(catalog.agents.filter(isAiAgent).map((a) => a.id));
    const missing = catalog.agents.filter((a) => a.status !== "retired" && !isAiAgent(a) && n8nWorkflowIds(a).length && !(a.ownedBy && ai.has(a.ownedBy))).map((a) => a.id);
    expect(missing).toEqual([]);
  });
});
