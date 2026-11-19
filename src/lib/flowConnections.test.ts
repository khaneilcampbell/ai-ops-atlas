import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../catalog/parse";
import { flowConnections, WORKFLOW_HUB, type LiveRuntime } from "./connections";

const dir = join(__dirname, "../../catalog");
const { catalog } = buildCatalog(Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => [f, readFileSync(join(dir, f), "utf8")])));
const at = "2026-11-17T09:00:00Z";
const states = (state: string) => new Map<string, LiveRuntime>(catalog.agents.map((a) => [a.id, { state, basis: { at } }]));

describe("flow lines", () => {
  it("draws feed reports into the Command Center and n8n workflows into the Workflow Automation Hub", () => {
    const lines = flowConnections(catalog, new Map());
    const site = catalog.agents.find((a) => a.id === "benjaire-flow-missed-runs")!.projectId;
    const feed = lines.find((c) => c.id === `feed:${site}`)!;
    expect(feed.target).toEqual({ kind: "project", id: "ai-ops-atlas" });
    expect(feed.agents).toContain("Benjaire Ops · Missed Run Check");
    const n8n = lines.find((c) => c.id === `n8n:${site}`)!;
    expect(n8n.target).toMatchObject({ kind: "landmark", id: WORKFLOW_HUB });
    expect(n8n.workflows.length).toBeGreaterThan(0);
    // Atlas never reports to itself.
    expect(lines.some((c) => c.id === "feed:ai-ops-atlas")).toBe(false);
  });

  it("takes its colour from the agents' live states, never from the link existing", () => {
    expect(flowConnections(catalog, new Map()).every((c) => c.status === "unknown")).toBe(true);
    expect(flowConnections(catalog, states("idle")).every((c) => c.status === "active" && c.lastVerified === at)).toBe(true);
    expect(flowConnections(catalog, states("stale")).every((c) => c.status === "inactive")).toBe(true);
    const one = states("idle");
    one.set("benjaire-flow-missed-runs", { state: "failed", basis: { at } });
    const site = catalog.agents.find((a) => a.id === "benjaire-flow-missed-runs")!.projectId;
    const line = flowConnections(catalog, one).find((c) => c.id === `feed:${site}`)!;
    expect(line.status).toBe("unhealthy");
    expect(line.statusNote).toMatch(/1 failed/);
  });
});
