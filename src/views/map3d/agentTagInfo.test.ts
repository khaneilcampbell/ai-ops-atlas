import { describe, expect, it } from "vitest";
import { buildAgentTag } from "./agentTagInfo";
import type { OfficeRow } from "../office/officeRows";

const row = (state: OfficeRow["runtime"]["state"]) => ({ entry: { profile: { title: "Release Coordinator" } }, runtime: { state, reason: "", basis: null, source: null }, history: [] }) as unknown as OfficeRow;
const places = { home: { label: "Ellipse Residences West, apartment 13A", source: "assigned" as const }, work: { label: "Atlas Command Center", source: "declared" as const } };

describe("agent tag", () => {
  it("names the agent and its places, with the state from telemetry only", () => {
    const t = buildAgentTag("release", row("unknown"), places, "Specialized Agent")!;
    expect(t).toMatchObject({ name: "Release Coordinator", role: "Specialized Agent", home: places.home, work: places.work });
    // Walking outside is placement: an agent with no source still reads as not connected, never running.
    expect(t.stateLabel).not.toMatch(/running|working/i);
  });

  it("shows nothing for an agent Atlas has no row or places for", () => {
    expect(buildAgentTag("x", undefined, places, null)).toBeNull();
    expect(buildAgentTag("x", row("idle"), undefined, null)).toBeNull();
  });
});
