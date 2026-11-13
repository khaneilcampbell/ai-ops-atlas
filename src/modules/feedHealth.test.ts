import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import type { Watch, WatchState } from "../alerts/alerts";
import { buildingAssets } from "./operations";
import { landmarkInstances } from "./instances";
import { feedHealth } from "./feedHealth";

const agent = (id: string) => catalog.agents.find((a) => a.id === id)!;
const watch = (id: string, state: WatchState, at: string | null = "2026-11-12T07:00:00Z"): Watch => ({
  agent: agent(id), state, detail: `${state} detail`, key: null, since: null,
  last: at ? { at, result: state === "failing" ? "failure" : "success", label: "Product publishing check · ok", source: "agent-feed" } : null,
});

describe("building feed health", () => {
  it("is green only when every operating agent reported on time", () => {
    expect(feedHealth(["marketplace-steward"], [watch("marketplace-steward", "ok")])).toMatchObject({ health: "good", summary: "Live · Marketplace Steward reporting on time" });
  });

  it("is red when the latest report failed", () => {
    expect(feedHealth(["marketplace-steward"], [watch("marketplace-steward", "failing")])).toMatchObject({ health: "bad", summary: "Failing · Marketplace Steward: failing detail" });
  });

  it("is not verified, with the reason, when stale, empty or unread", () => {
    expect(feedHealth(["marketplace-steward"], [watch("marketplace-steward", "silent")])).toMatchObject({ health: "unknown", state: "stale", summary: "Not verified · Marketplace Steward: silent detail" });
    expect(feedHealth(["marketplace-steward"], [watch("marketplace-steward", "no-reports", null)])).toMatchObject({ health: "unknown", state: "none" });
    expect(feedHealth(["marketplace-steward"], [watch("marketplace-steward", "no-source", null)])).toMatchObject({ health: "unknown", state: "unavailable" });
  });

  it("ignores other agents and returns null when none of the building's agents is watched", () => {
    expect(feedHealth(["marketplace-steward"], [watch("dataset-census", "ok")])).toBeNull();
    expect(feedHealth([], [])).toBeNull();
  });

  it("gives each of the two buildings its operating agent, watched with a report window", () => {
    const want: Record<string, string> = { "atlas-marketplace": "marketplace-steward", "financial:residence": "dataset-census" };
    for (const [id, agentId] of Object.entries(want)) {
      const l = landmarkInstances().find((x) => x.id === id)!;
      const assets = buildingAssets(l, catalog);
      // The Data Intelligence Center also houses Atlas Data Inventory, which reports to the sheet, not the feed.
      const extra: Record<string, string[]> = { "financial:residence": ["atlas-data-inventory"] };
      expect([...assets.agents, ...assets.automations].map((a) => a.id).sort(), id).toEqual([agentId, ...(extra[id] ?? [])].sort());
      const a = agent(agentId);
      expect(a.observe?.agentFeed, agentId).toBe(true);
      expect(a.alerts?.failures, agentId).toBe(true);
      expect(a.alerts?.reportWithinMs, agentId).toBeGreaterThan(0);
    }
  });
});
