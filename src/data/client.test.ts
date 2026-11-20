import { describe, expect, it } from "vitest";
import { fetchOverviewForApp } from "./client";

// The Mac app reads the database overview through its Rust shell (live_data_overview); these check
// how each answer becomes a card state. The web page's path is covered by the visual check.
describe("fetchOverviewForApp", () => {
  const overview = { status: { state: "ok", schemaVersion: 1, agentKeys: 1 }, counts: { runs24h: 0, runsFailed24h: 0, approvalsPending: 0, tasksOpen: 0 }, runs: [], approvals: [], records: [] };

  it("shows the overview the site sent", async () => {
    const asked: string[] = [];
    const r = await fetchOverviewForApp(async (c) => (asked.push(c), overview));
    expect(asked).toEqual(["live_data_overview"]);
    expect(r).toEqual({ state: "ready", value: overview });
  });

  it("points to website sync when it is off", async () => {
    const r = await fetchOverviewForApp(async () => null);
    expect(r.state).toBe("off");
    expect(r.state === "off" && r.message).toContain("Settings → Website sync");
  });

  it("tells a missing database binding apart from other errors", async () => {
    const missing = await fetchOverviewForApp(async () => {
      throw "The site refused live updates (503): The Atlas database isn't set up on the site yet (ATLAS_DB Hyperdrive binding missing).";
    });
    expect(missing.state).toBe("not-configured");
    const down = await fetchOverviewForApp(async () => {
      throw "The site refused live updates (401): The sync key doesn't match the site's USAGE_SYNC_TOKEN.";
    });
    expect(down).toEqual({ state: "error", message: expect.stringContaining("USAGE_SYNC_TOKEN") });
  });
});
