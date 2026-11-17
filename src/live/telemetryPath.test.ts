import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { watchOf } from "../alerts/alerts";
import { buildCatalog } from "../catalog/parse";
import { STALE_MS, type ProductionEvent } from "../production/model";
import { buildRegistry } from "../registry/registry";
import { telemetryFor } from "../registry/telemetry";
import { buildingStates } from "../views/office/activity";
import { runtimeFor } from "../views/office/model";
import { mergeAgentRuns, toAgentRun, type AgentRun, type LiveEvent } from "./apply";

// One real source end to end: the Observability Center's signal-watch agent posts run results to
// /api/hooks/agents, the feed turns them into agent runs, and the desk, module and map building
// read the same state from them. Local evidence only; production is checked against the live D1.
const dir = join(__dirname, "../../catalog");
const { catalog } = buildCatalog(Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => [f, readFileSync(join(dir, f), "utf8")])));
const agent = catalog.agents.find((a) => a.id === "signal-watch")!;
const T0 = Date.parse("2026-11-17T09:00:00Z");
const MIN = 60_000;

const event = (id: number, at: number, status: string): LiveEvent => ({
  id, at: new Date(at).toISOString(), source: "agent", kind: "agent_run", repo: "khaneilcampbell/ai-ops-atlas",
  body: { project: "ai-ops-atlas", agents: ["signal-watch"], phase: "signal-watch", status, detail: "" },
});
const feed = (runs: AgentRun[] | null, events: LiveEvent[]) => mergeAgentRuns(runs ?? [], events.map(toAgentRun).filter((r): r is AgentRun => !!r));

function at(runs: AgentRun[] | null, now: number) {
  const entry = buildRegistry(catalog, {}, { runs: [], agentRuns: runs, production: [], observedAt: new Date(now).toISOString() } as never).find((e) => e.profile.id === agent.id)!;
  const runtime = runtimeFor(agent, entry.telemetry, undefined, 0, now);
  const watch = watchOf(agent, entry, now, runs !== null);
  return { runtime, watch, building: buildingStates([agent], new Map([[agent.id, runtime]])).get(`agent:${agent.id}`) ?? "idle" };
}

describe("live telemetry path (signal-watch)", () => {
  it("is declared on the live feed with a report window", () => {
    expect(agent.observe?.agentFeed).toBe(true);
    expect(agent.alerts?.reportWithinMs).toBe(90 * MIN);
  });

  it("shows Not connected with a next step before the feed answers", () => {
    const s = at(null, T0);
    expect(s.runtime.state).toBe("unknown");
    expect(s.runtime.reason).toMatch(/Next step/);
    expect(s.watch.state).toBe("no-source");
    expect(s.building).toBe("idle");
  });

  it("goes Idle after a success, Failed after a failure, and recovers on the next success", () => {
    let runs = feed(null, [event(1, T0, "ok")]);
    expect(at(runs, T0 + MIN).runtime.state).toBe("idle");
    expect(at(runs, T0 + MIN).watch.state).toBe("ok");
    runs = feed(runs, [event(2, T0 + 30 * MIN, "failed")]);
    const failed = at(runs, T0 + 31 * MIN);
    expect([failed.runtime.state, failed.watch.state, failed.building]).toEqual(["failed", "failing", "error"]);
    runs = feed(runs, [event(3, T0 + 60 * MIN, "ok")]);
    expect(at(runs, T0 + 61 * MIN).runtime.state).toBe("idle");
  });

  it("expires old evidence: a success past the report window is Stale everywhere and unlit", () => {
    const runs = feed(null, [event(1, T0, "ok")]);
    const s = at(runs, T0 + 91 * MIN);
    expect([s.runtime.state, s.watch.state, s.building]).toEqual(["stale", "silent", "idle"]);
  });

  it("ignores duplicate deliveries and keeps state after a reconnect", () => {
    const once = feed(null, [event(1, T0, "ok")]);
    const twice = feed(once, [event(1, T0, "ok")]);
    expect(twice).toBe(once);
    // Reconnecting replays the backfill window; nothing is counted twice.
    expect(feed(twice, [event(1, T0, "ok"), event(2, T0 + 30 * MIN, "ok")])).toHaveLength(2);
  });
});

describe("production heartbeat", () => {
  it("proves liveness only, never a successful run", () => {
    const prod = { ...agent, id: "prod", observe: {}, registry: { ...agent.registry, governance: { ...agent.registry?.governance, autonomy: 3 } } } as typeof agent;
    const hb: ProductionEvent = { id: 1, at: new Date(T0).toISOString(), body: { agentId: "prod", eventId: "h1", kind: "heartbeat" } };
    const t = telemetryFor(prod, undefined, null, null, null, [hb], T0 + MIN);
    expect(t.lastVerifiedRun).toBeNull();
    expect(runtimeFor(prod, t, undefined, 0, T0 + MIN).reason).toMatch(/No run result/);
    expect(runtimeFor(prod, telemetryFor(prod, undefined, null, null, null, [hb], T0 + STALE_MS + MIN), undefined, 0, T0 + STALE_MS + MIN).state).toBe("stale");
  });
});
