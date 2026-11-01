import { describe, expect, it } from "vitest";
import type { Agent, Status } from "../catalog/types";
import type { RepoSnapshot, WorkflowRun } from "../github/types";
import { runtimeFor, type Runtime } from "../views/office/model";
import { activeRows, activeSummary, costOf, docUrl, scheduleOf } from "./active";
import { buildRegistry } from "./registry";

const NOW = Date.parse("2026-10-28T09:00:00Z");
const run = (status: string, conclusion: string | null, createdAt: string): WorkflowRun => ({
  name: "CI",
  status,
  conclusion,
  branch: "main",
  event: "push",
  createdAt,
  url: `https://x/${createdAt}`,
});
const agent = (id: string, status: Status, wf?: string) =>
  ({
    id,
    name: id.toUpperCase(),
    purpose: "p",
    framework: "GitHub Actions",
    status,
    lastRun: null,
    history: [],
    links: [],
    projectId: "demo",
    repository: "me/demo",
    ...(wf ? { observe: { githubWorkflow: wf } } : {}),
  }) as Agent;

const agents = [
  agent("on-idle", "active", "ok.yml"),
  agent("on-running", "active", "busy.yml"),
  agent("off-running", "idle", "busy.yml"),
  agent("off", "idle", "ok.yml"),
  agent("on-blind", "attention"),
  agent("paused", "paused", "ok.yml"),
];
const snap = {
  defaultBranch: "main",
  workflowRuns: {
    "ok.yml": [run("completed", "success", "2026-10-27T10:00:00Z")],
    "busy.yml": [run("in_progress", null, "2026-10-28T08:50:00Z")],
  },
  runs: [],
  fetchedAt: "2026-10-28T08:55:00Z",
} as unknown as RepoSnapshot;
const catalog = {
  projects: [
    {
      id: "demo",
      name: "Demo",
      summary: "",
      status: "active" as const,
      repository: "me/demo",
      tags: [],
      links: [],
      agentIds: agents.map((a) => a.id),
    },
  ],
  agents,
};
const entries = buildRegistry(catalog, { "me/demo": { kind: "ok", data: snap } as never }, null);
const runtimes = new Map<string, Runtime>(entries.map((e) => [e.profile.id, runtimeFor(agents.find((a) => a.id === e.profile.id)!, e.telemetry, undefined, 0, NOW)]));

describe("active agents", () => {
  it("keeps switched-on agents plus anything observed running, running first", () => {
    const rows = activeRows(entries, runtimes, "on");
    expect(rows.map((r) => r.entry.profile.id)).toEqual(["on-running", "off-running", "on-idle", "on-blind"]);
    expect(rows.find((r) => r.entry.profile.id === "off-running")!.switchedOn).toBe(false);
  });

  it("shows every agent in the all scope, paused ones last", () => {
    const rows = activeRows(entries, runtimes, "all");
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)!.entry.profile.id).toBe("paused");
  });

  it("counts running from observed runs only and flags switched-on agents with no source", () => {
    expect(activeSummary(activeRows(entries, runtimes, "on"))).toEqual({
      switchedOn: 3,
      running: 2,
      awaiting: 0,
      failed: 0,
      unobserved: 1,
    });
  });

  it("reports cost only from a source", () => {
    const e = entries[0];
    expect(costOf(e)).toBeNull();
    expect(
      costOf({
        ...e,
        profile: { ...e.profile, cost: { budget: "Free tier", notes: null } },
      }),
    ).toEqual({ value: "Free tier", basis: "documented" });
    expect(
      costOf({
        ...e,
        telemetry: { ...e.telemetry, monthSpendUsd: 1.234, monthBudgetUsd: 5 },
      }),
    ).toEqual({ value: "$1.23 this month of $5 budget", basis: "observed" });
  });

  it("uses the documented schedule, falling back to the trigger", () => {
    const e = entries[0];
    expect(
      scheduleOf({
        ...e,
        profile: {
          ...e.profile,
          execution: {
            ...e.profile.execution,
            schedule: "Hourly",
            trigger: "Cron",
          },
        },
      }),
    ).toBe("Hourly");
    expect(
      scheduleOf({
        ...e,
        profile: {
          ...e.profile,
          execution: {
            ...e.profile.execution,
            schedule: null,
            trigger: "Push to main",
          },
        },
      }),
    ).toBe("Push to main");
  });

  it("links repository doc paths on the default branch and leaves full URLs alone", () => {
    expect(docUrl("docs/runbooks/x.md", "me/demo", "main")).toBe("https://github.com/me/demo/blob/main/docs/runbooks/x.md");
    expect(docUrl("https://example.com/r", "me/demo", "main")).toBe("https://example.com/r");
  });
});
