import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { directoryItems } from "../catalog/roles";
import { buildRegistry, type RegistryEntry } from "../registry/registry";
import type { ExecutionRecord } from "../registry/types";
import { hourOfDay, lastError, liveCounts, liveState, sortLive, statusLabel, todayRuns } from "./live";

const autoIds = new Set(directoryItems(catalog.agents, "automations").map((a) => a.id));
const entries = buildRegistry(catalog, {}, null).filter((e) => autoIds.has(e.profile.id));
const byId = (id: string) => entries.find((e) => e.profile.id === id)!;
const rec = (at: string, result: ExecutionRecord["result"], label = "run"): ExecutionRecord => ({ at, result, label, source: "n8n" });
const withRuns = (e: RegistryEntry, executions: ExecutionRecord[], operational = e.operational): RegistryEntry => ({ ...e, operational, telemetry: { ...e.telemetry, source: "n8n", loaded: true, executions, lastAnyRun: executions[0] ?? null } });
const NY = "America/New_York";
const now = Date.parse("2026-11-24T20:00:00Z"); // 3 pm in New York

describe("Automations live", () => {
  it("reads the hour of the day in Khaneil's time zone", () => {
    expect(hourOfDay("2026-11-24T14:30:00Z", NY)).toBe(9.5);
    expect(hourOfDay("2026-11-24T14:30:00Z", "UTC")).toBe(14.5);
  });

  it("draws only today's runs, earliest automation first", () => {
    const list = entries.map((e) =>
      e.profile.id === "agent-registry-sync" ? withRuns(e, [rec("2026-11-24T18:00:00Z", "success"), rec("2026-11-23T18:00:00Z", "success")])
      : e.profile.id === "dataset-census" ? withRuns(e, [rec("2026-11-24T06:00:00Z", "failure")]) // 1 am New York
      : e,
    );
    const rows = todayRuns(list, NY, now);
    expect(rows.map((r) => r.entry.profile.id)).toEqual(["dataset-census", "agent-registry-sync"]);
    expect(rows[1].runs).toHaveLength(1);
    expect(rows[1].runs[0].hour).toBe(13);
    expect(todayRuns(entries, NY, now)).toEqual([]);
  });

  it("gives every automation one state, so the ring adds up", () => {
    const c = liveCounts(entries);
    expect(c.failing + c.draft + c.verified + c.unverified).toBe(entries.length);
    expect(liveState(byId("atlas-task-writer"))).toBe("draft");
    expect(statusLabel(byId("atlas-merge-pr"))).toBe("Manual");
  });

  it("sorts failures, then drafts, to the top", () => {
    const failing = { ...byId("dataset-census"), operational: "failing" as const };
    const sorted = sortLive([byId("agent-registry-sync"), byId("atlas-task-writer"), failing], "attention");
    expect(sorted.map((e) => e.profile.id)).toEqual(["dataset-census", "atlas-task-writer", "agent-registry-sync"]);
    expect(sortLive(sorted, "name")[0].profile.title <= sortLive(sorted, "name")[1].profile.title).toBe(true);
  });

  it("shows the error only when the latest run failed", () => {
    const e = byId("agent-registry-sync");
    expect(lastError(withRuns(e, [rec("2026-11-24T18:00:00Z", "failure", "Gmail node timed out"), rec("2026-11-24T14:00:00Z", "success")]))).toBe("Gmail node timed out");
    expect(lastError(withRuns(e, [rec("2026-11-24T18:00:00Z", "success"), rec("2026-11-24T14:00:00Z", "failure", "old")]))).toBeNull();
  });
});
