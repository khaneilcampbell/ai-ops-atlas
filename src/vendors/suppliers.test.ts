import { describe, expect, it } from "vitest";
import type { Agent, Project } from "../catalog/types";
import type { RegistryEntry } from "../registry/registry";
import type { ExecutionRecord } from "../registry/types";
import { SUPPLIER_SOURCES, supplierRows, worstState } from "./suppliers";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const H = 3_600_000;

const agent = (id: string, tools: string[], projectId = "shop", status?: string): Agent =>
  ({ id, name: id, projectId, status, registry: { responsibilities: { tools } } }) as unknown as Agent;
const run = (hoursAgo: number, result: ExecutionRecord["result"] = "success"): ExecutionRecord =>
  ({ at: new Date(NOW - hoursAgo * H).toISOString(), result, label: `run ${result}`, source: "github", url: `https://example.test/${hoursAgo}` });
const entry = (id: string, executions: ExecutionRecord[]): RegistryEntry =>
  ({ profile: { id }, telemetry: { source: "github", loaded: true, executions } }) as unknown as RegistryEntry;
const project = (id: string, status = "active"): Project => ({ id, name: `${id} project`, status }) as unknown as Project;

describe("vendor and supplier catalog", () => {
  it("lists only vendors a live manifest names, failing first, with last run", () => {
    const agents = [agent("pay", ["Stripe API"]), agent("store", ["Shopify Admin", "Stripe"]), agent("design", ["Canva"]), agent("gone", ["Splunk"], "old"), agent("off", ["Serper"], "shop", "retired")];
    const entries = [entry("pay", [run(1)]), entry("store", [run(3, "failure")]), entry("design", [])];
    const rows = supplierRows([project("shop"), project("old", "retired")], agents, entries, NOW, true);
    expect(rows.map((r) => [r.vendor, r.state, r.workers])).toEqual([["Shopify", "failing", 1], ["Stripe", "failing", 2], ["Canva", "unknown", 1]]);
    const stripe = rows.find((r) => r.id === "stripe")!;
    expect(stripe).toMatchObject({ role: "Payments Office", projects: ["shop project"], lastRunAt: new Date(NOW - H).toISOString(), lastRunUrl: "https://example.test/1" });
    expect(rows.find((r) => r.id === "canva")).toMatchObject({ lastRunAt: null, lastRunUrl: null });
  });

  it("never reads an unseen worker as healthy", () => {
    expect(worstState(["ok", "unknown"])).toBe("unknown");
    expect(worstState(["ok", "not-running"])).toBe("ok");
    expect(worstState(["not-running"])).toBe("not-running");
    expect(worstState([])).toBe("unknown");
  });

  it("marks sources without a connection as not connected, with a reason", () => {
    for (const s of SUPPLIER_SOURCES) expect(s.detail.length).toBeGreaterThan(10);
    expect(SUPPLIER_SOURCES.filter((s) => s.state === "not-connected").map((s) => s.id)).toEqual(["billing", "contracts"]);
  });
});
