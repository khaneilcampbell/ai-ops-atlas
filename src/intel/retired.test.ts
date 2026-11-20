import { describe, expect, it } from "vitest";
import { isRetiredRepo, withoutRetired, withoutRetiredReports, withoutRetiredRuns } from "./retired";
import type { AgentStatus, Report, Run } from "./types";

const run = (repo: string, kind?: "repository" | "ecosystem") => ({ id: repo + (kind ?? ""), repo, kind, status: "failed" }) as unknown as Run;

describe("retired repositories", () => {
  it("knows both deleted repositories, in any case", () => {
    expect(isRetiredRepo("khaneilcampbell/benjaire-dashboard")).toBe(true);
    expect(isRetiredRepo("KhaneilCampbell/Job-Applications-Workflow")).toBe(true);
    expect(isRetiredRepo("khaneilcampbell/benjaire.com")).toBe(false);
  });

  it("drops their repository runs but keeps engineering reviews", () => {
    const runs = [run("khaneilcampbell/benjaire-dashboard"), run("khaneilcampbell/ai-ops-atlas"), run("__ecosystem__", "ecosystem"), run("khaneilcampbell/job-applications-workflow", "repository")];
    expect(withoutRetiredRuns(runs).map((r) => r.repo)).toEqual(["khaneilcampbell/ai-ops-atlas", "__ecosystem__"]);
  });

  it("takes them off the assigned list and the run log, and leaves a clean status alone", () => {
    const status = {
      config: { assigned: ["khaneilcampbell/job-applications-workflow", "khaneilcampbell/benjaire.com", "khaneilcampbell/benjaire-dashboard"] },
      runs: [run("khaneilcampbell/benjaire-dashboard"), run("khaneilcampbell/benjaire.com")],
    } as unknown as AgentStatus;
    const clean = withoutRetired(status);
    expect(clean.config.assigned).toEqual(["khaneilcampbell/benjaire.com"]);
    expect(clean.runs.map((r) => r.repo)).toEqual(["khaneilcampbell/benjaire.com"]);
    expect(withoutRetired(clean)).toBe(clean);
  });

  it("drops their saved reports", () => {
    const reports = [{ repo: "khaneilcampbell/benjaire-dashboard" }, { repo: "khaneilcampbell/ai-ops-atlas" }] as Report[];
    expect(withoutRetiredReports(reports).map((r) => r.repo)).toEqual(["khaneilcampbell/ai-ops-atlas"]);
  });
});
