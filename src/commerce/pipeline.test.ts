import { describe, expect, it } from "vitest";
import type { Agent, AlertRules, Project } from "../catalog/types";
import type { RegistryEntry } from "../registry/registry";
import type { ExecutionRecord, Telemetry } from "../registry/types";
import { commerceProjects, pipelineCounts, pipelineStage, pipelineStages } from "./pipeline";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const H = 3_600_000;

const agent = (id: string, alerts?: Partial<AlertRules>, projectId = "commerce"): Agent =>
  ({ id, name: id, projectId, alerts: alerts ? { failures: true, reportWithinMs: null, notRunning: null, ...alerts } : undefined }) as Agent;
const run = (hoursAgo: number, result: ExecutionRecord["result"] = "success", extra: Partial<ExecutionRecord> = {}): ExecutionRecord => ({
  at: new Date(NOW - hoursAgo * H).toISOString(), result, label: `run ${result}`, source: "github", ...extra,
});
const entry = (id: string, executions: ExecutionRecord[], source: Telemetry["source"] = "github"): RegistryEntry =>
  ({ profile: { id }, telemetry: { source, loaded: true, executions } }) as unknown as RegistryEntry;
const project = (id: string, module?: string, status = "active"): Project => ({ id, module, status }) as unknown as Project;

describe("commerce publishing pipeline", () => {
  it("keeps only live commerce-module projects", () => {
    const ps = [project("commerce", "commerce-product-marketplace"), project("old", "commerce-product-marketplace", "retired"), project("site")];
    expect(commerceProjects(ps).map((p) => p.id)).toEqual(["commerce"]);
  });

  it("shows a stage switched off on purpose as not running, never failing", () => {
    const s = pipelineStage(agent("order-delivery", { notRunning: "The commerce VPS was removed." }), entry("order-delivery", [run(1, "failure")], "agent-feed"), NOW, true);
    expect(s).toMatchObject({ state: "not-running", detail: "The commerce VPS was removed." });
  });

  it("uses the newest finished mainline run for unwatched stages", () => {
    expect(pipelineStage(agent("seo"), entry("seo", [run(0.5, "running"), run(1, "failure"), run(2)]), NOW, true).state).toBe("failing");
    expect(pipelineStage(agent("seo"), entry("seo", [run(1, "failure", { offMainline: true }), run(2)]), NOW, true).state).toBe("ok");
  });

  it("says unknown when nothing was seen", () => {
    expect(pipelineStage(agent("a"), entry("a", []), NOW, true)).toMatchObject({ state: "unknown", detail: "No finished run seen yet" });
    expect(pipelineStage(agent("a"), entry("a", [], null), NOW, true)).toMatchObject({ state: "unknown", detail: "No live source declared" });
    expect(pipelineStage(agent("a"), undefined, NOW, true).state).toBe("unknown");
    // A watched agent whose feed isn't flowing here is unknown, not healthy.
    expect(pipelineStage(agent("w", {}), entry("w", [run(1)], "agent-feed"), NOW, false).state).toBe("unknown");
  });

  it("lists problems first and counts each state", () => {
    const agents = [agent("b-ok"), agent("a-off", { notRunning: "off" }), agent("c-bad"), agent("elsewhere", undefined, "site")];
    const entries = [entry("b-ok", [run(1)]), entry("a-off", [], "agent-feed"), entry("c-bad", [run(1, "failure")]), entry("elsewhere", [run(1, "failure")])];
    const stages = pipelineStages([project("commerce", "commerce-product-marketplace"), project("site")], agents, entries, NOW, true);
    expect(stages.map((s) => s.agent.id)).toEqual(["c-bad", "b-ok", "a-off"]);
    expect(pipelineCounts(stages)).toEqual({ failing: 1, silent: 0, ok: 1, "not-running": 1, unknown: 0 });
  });

  it("leaves retired agents out of the pipeline", () => {
    const old = { ...agent("old-vps"), status: "retired" } as Agent;
    const stages = pipelineStages([project("commerce", "commerce-product-marketplace")], [agent("b-ok"), old], [entry("b-ok", [run(1)])], NOW, true);
    expect(stages.map((s) => s.agent.id)).toEqual(["b-ok"]);
  });
});
