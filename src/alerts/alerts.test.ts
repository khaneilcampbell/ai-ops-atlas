import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Agent, AlertRules } from "../catalog/types";
import type { RegistryEntry } from "../registry/registry";
import type { ExecutionRecord, Telemetry } from "../registry/types";
import { openAlerts, span, watchAgents, watchOf } from "./alerts";
import { buildCatalog, parseDuration } from "../catalog/parse";

const dir = join(__dirname, "../../catalog");
const loadCatalogFiles = () => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => [f, readFileSync(join(dir, f), "utf8")]));

const NOW = Date.parse("2026-10-29T12:00:00Z");
const H = 3_600_000;

const agent = (alerts: Partial<AlertRules> = {}, id = "order-delivery"): Agent =>
  ({ id, name: id, alerts: { failures: true, reportWithinMs: null, notRunning: null, ...alerts } }) as Agent;

const run = (hoursAgo: number, result: ExecutionRecord["result"] = "success", label = "Delivery · ok"): ExecutionRecord => ({
  at: new Date(NOW - hoursAgo * H).toISOString(),
  result,
  label,
  source: "agent-feed",
});

const entry = (id: string, executions: ExecutionRecord[] | null, source: Telemetry["source"] = "agent-feed"): RegistryEntry =>
  ({ profile: { id }, telemetry: { source, loaded: executions !== null, executions: executions ?? [] } }) as unknown as RegistryEntry;

describe("agent alerts", () => {
  it("raises a failure from the latest completed report, keyed to that run", () => {
    const w = watchOf(agent(), entry("order-delivery", [run(0.5, "other"), run(1, "failure", "Delivery · failed · SMTP refused"), run(2)]), NOW, true);
    expect(w.state).toBe("failing");
    expect(w.detail).toBe("Delivery · failed · SMTP refused");
    expect(w.key).toBe(`order-delivery:failed:${run(1).at}`);
    // A later success clears it.
    expect(watchOf(agent(), entry("order-delivery", [run(0.2), run(1, "failure")]), NOW, true).state).toBe("ok");
  });

  it("calls an agent silent only past its window, and only while the feed is flowing", () => {
    const rules = { reportWithinMs: 2 * H };
    expect(watchOf(agent(rules), entry("order-delivery", [run(1)]), NOW, true).state).toBe("ok");
    const silent = watchOf(agent(rules), entry("order-delivery", [run(5)]), NOW, true);
    expect(silent).toMatchObject({ state: "silent", since: new Date(NOW - 3 * H).toISOString() });
    expect(silent.detail).toContain("No report for 5 h");
    // Feed not flowing on this device: unknown, not silent.
    expect(watchOf(agent(rules), entry("order-delivery", [run(5)]), NOW, false).state).toBe("no-source");
    // But a kept failure still shows.
    expect(watchOf(agent(rules), entry("order-delivery", [run(5, "failure")]), NOW, false).state).toBe("failing");
    // No window (event-driven): a quiet week is fine.
    expect(watchOf(agent(), entry("order-delivery", [run(24 * 7)]), NOW, true).state).toBe("ok");
  });

  it("says unknown instead of healthy when there is nothing to go on", () => {
    expect(watchOf(agent(), entry("order-delivery", null), NOW, true).state).toBe("no-source");
    expect(watchOf(agent(), entry("order-delivery", [], null), NOW, true).state).toBe("no-source");
    const none = watchOf(agent({ reportWithinMs: H }), entry("order-delivery", []), NOW, true);
    expect(none.state).toBe("no-reports");
    expect(none.key).toBeNull();
  });

  it("never alerts on an agent that is off on purpose", () => {
    const w = watchOf(agent({ notRunning: "VPS removed", reportWithinMs: H }), entry("order-delivery", [run(48, "failure")]), NOW, true);
    expect(w).toMatchObject({ state: "not-running", key: null, detail: "VPS removed" });
  });

  it("can watch for silence without alerting on failures", () => {
    expect(watchOf(agent({ failures: false }), entry("order-delivery", [run(1, "failure")]), NOW, true).state).toBe("ok");
  });

  it("lists alerts first and drops dismissed ones from the open list", () => {
    const agents = [agent({}, "a-ok"), agent({}, "b-fail"), { id: "unwatched", name: "u" } as Agent];
    const ws = watchAgents(agents, [entry("a-ok", [run(1)]), entry("b-fail", [run(1, "failure")]), entry("unwatched", [run(1, "failure")])], NOW, true);
    expect(ws.map((w) => w.agent.id)).toEqual(["b-fail", "a-ok"]);
    expect(openAlerts(ws, new Set())).toHaveLength(1);
    expect(openAlerts(ws, new Set([ws[0].key!]))).toHaveLength(0);
  });

  it("formats spans", () => {
    expect(span(45 * 60_000)).toBe("45 min");
    expect(span(5 * H)).toBe("5 h");
    expect(span(8 * 24 * H)).toBe("8 d");
  });
});

describe("alerts in manifests", () => {
  it("parses durations", () => {
    expect(parseDuration("90m")).toBe(90 * 60_000);
    expect(parseDuration("2h")).toBe(2 * H);
    expect(parseDuration("8d")).toBe(8 * 24 * H);
    expect(parseDuration("0h")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });

  it("reads the block and reports mistakes", () => {
    const doc = (alerts: string) => ({
      "x.yaml": `
schema: atlas/v2
project: { id: demo, name: Demo, summary: s, status: active, repository: me/demo }
agents:
  - { id: a1, name: A, purpose: p, framework: f, status: active, alerts: ${alerts} }
`,
    });
    const ok = buildCatalog(doc("{ report_within: 3h, not_running: Off }"));
    expect(ok.issues).toEqual([]);
    expect(ok.catalog.agents[0].alerts).toEqual({ failures: true, reportWithinMs: 3 * H, notRunning: "Off" });
    const bad = buildCatalog(doc("{ report_within: often, page: me }"));
    expect(bad.issues.map((i) => i.message)).toEqual([expect.stringContaining("report_within"), expect.stringContaining("alerts.page")]);
  });

  it("watches the customer-facing agents, and keeps the commerce pipeline quiet until it is rehosted", () => {
    const { catalog, issues } = buildCatalog(loadCatalogFiles());
    expect(issues).toEqual([]);
    const watched = catalog.agents.filter((a) => a.alerts);
    expect(watched.map((a) => a.id).sort()).toEqual(["benjaire-contact-worker", "benjaire-flow-intake", "canva-mockups", "commerce-loop", "order-delivery", "seo-maintainer"]);
    for (const a of watched) {
      expect(a.observe?.agentFeed).toBe(true);
      expect(!!a.alerts!.notRunning).toBe(a.projectId === "commerce-pipeline");
    }
  });
});
