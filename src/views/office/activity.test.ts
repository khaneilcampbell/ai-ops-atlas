import { describe, expect, it } from "vitest";
import type { Runtime, RuntimeState } from "./model";
import type { RepoSnapshot } from "../../github/types";
import { buildingStates, isFresh, justCompleted } from "./activity";

const rt = (state: RuntimeState, result?: "success" | "failure"): Runtime => ({ state, reason: "", source: "GitHub Actions", basis: result ? { at: "2026-10-28T06:00:00Z", result, label: "CI", source: "github" } : null });
const agents = [
  { id: "ci", repository: "me/atlas", projectId: "atlas" },
  { id: "intel", repository: "me/atlas", projectId: "atlas" },
  { id: "site", repository: "me/site", projectId: "site" },
];

describe("building illumination", () => {
  it("lights only buildings whose agents are observed running or failing", () => {
    const s = buildingStates(agents, new Map([["ci", rt("working")], ["intel", rt("idle")], ["site", rt("unknown")]]));
    expect(Object.fromEntries(s)).toEqual({ "agent:ci": "running", "project:atlas": "running" });
    // Registered, awaiting approval, offline or unknown is not work.
    expect(buildingStates(agents, new Map([["ci", rt("awaiting")], ["intel", rt("offline")]])).size).toBe(0);
  });

  it("gives a headquarters its most pressing state", () => {
    const s = buildingStates(agents, new Map([["ci", rt("failed")], ["intel", rt("working")]]));
    expect(s.get("agent:ci")).toBe("error");
    expect(s.get("project:atlas")).toBe("running");
  });

  it("confirms completion only for an observed running-to-success transition", () => {
    const prev = new Map([["ci", rt("working")], ["intel", rt("working")], ["site", rt("idle", "success")]]);
    const next = new Map([["ci", rt("idle", "success")], ["intel", rt("failed", "failure")], ["site", rt("idle", "success")]]);
    expect(justCompleted(prev, next)).toEqual(["ci"]);
    expect(buildingStates(agents, next, new Set(["ci"])).get("agent:ci")).toBe("completed");
  });

  it("uses only GitHub data synced within the refresh interval", () => {
    const data = {} as RepoSnapshot;
    expect(isFresh({ kind: "ok", data, stale: false })).toBe(true);
    expect(isFresh({ kind: "ok", data, stale: true })).toBe(false);
    expect(isFresh({ kind: "error", message: "rate limited", data })).toBe(false);
    expect(isFresh(undefined)).toBe(false);
  });
});
