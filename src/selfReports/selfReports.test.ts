import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ManifestIssue } from "../catalog/types";
import { catalog } from "../catalog";
import { BUILDING_NAMES } from "../modules/names";
import { SELF_REPORTS, SELF_REPORT_ISSUES, parseSelfReports, reportTimeOn, reportsLive, slotList } from "./selfReports";

describe("agent self-report schedule", () => {
  it("parses the workspace file with no problems: one named agent per half-hour slot", () => {
    expect(SELF_REPORT_ISSUES).toEqual([]);
    expect(SELF_REPORTS.building).toBe("service:financial:residence");
    expect(BUILDING_NAMES[SELF_REPORTS.building]?.displayName).toBe("Briarcliff Tower");
    expect(SELF_REPORTS.workflowId).toBe("SBtrX3tY3OKT8qzn");
    const times = Object.values(SELF_REPORTS.slots);
    expect(new Set(times).size).toBe(times.length);
    for (const t of times) {
      const [h, m] = t.split(":").map(Number);
      expect(h * 60 + m).toBeGreaterThanOrEqual(7 * 60);
      expect(h * 60 + m).toBeLessThanOrEqual(21 * 60 + 30);
      expect(m % 30).toBe(0);
    }
    expect(slotList(SELF_REPORTS)[0][1] <= slotList(SELF_REPORTS).at(-1)![1]).toBe(true);
  });

  it("gives every named agent in the catalog a report time, and only named agents", () => {
    const named = catalog.agents.filter((a) => a.registry?.identity?.displayName && a.status !== "retired").map((a) => a.id).sort();
    expect(Object.keys(SELF_REPORTS.slots).sort()).toEqual(named);
  });

  it("keeps the n8n workflow's slot pattern readable (the workflow reads this file with a regex)", () => {
    const text = readFileSync(resolve(__dirname, "../../catalog/workspace/self-reports.yaml"), "utf8");
    const found = [...text.matchAll(/^\s{4}([\w-]+):\s*["']?(\d{2}:\d{2})["']?\s*$/gm)].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(found)).toEqual(SELF_REPORTS.slots);
  });

  it("reports problems instead of throwing", () => {
    const issues: ManifestIssue[] = [];
    const p = parseSelfReports("x", "schema: nope\nbuilding: home\nreport:\n  slots:\n    a: '25:00'\n    b: '09:00'\n    c: '09:00'\n", issues);
    expect(p.slots).toEqual({ b: "09:00", c: "09:00" });
    expect(issues.map((i) => i.message.split(":")[0])).toEqual(["schema", "building", "n8n_workflow", "report.slots.a", "report.slots.c"]);
    expect(parseSelfReports("x", "a: [", []).slots).toEqual({});
  });

  it("finds today's report time in New York across a daylight saving change", () => {
    const plan = { ...SELF_REPORTS, slots: { a: "11:00" } };
    expect(new Date(reportTimeOn(plan, "a", Date.parse("2026-10-31T20:00:00Z"))!).toISOString()).toBe("2026-10-31T15:00:00.000Z");
    expect(new Date(reportTimeOn(plan, "a", Date.parse("2026-11-02T20:00:00Z"))!).toISOString()).toBe("2026-11-02T16:00:00.000Z");
    expect(reportTimeOn(plan, "nobody", Date.now())).toBeNull();
  });

  it("walks only while the workflow is published in live n8n", () => {
    expect(reportsLive(SELF_REPORTS, null)).toBe(false);
    expect(reportsLive(SELF_REPORTS, [{ id: "SBtrX3tY3OKT8qzn", active: false }])).toBe(false);
    expect(reportsLive(SELF_REPORTS, [{ id: "other", active: true }])).toBe(false);
    expect(reportsLive(SELF_REPORTS, [{ id: "SBtrX3tY3OKT8qzn", active: true }])).toBe(true);
  });
});
