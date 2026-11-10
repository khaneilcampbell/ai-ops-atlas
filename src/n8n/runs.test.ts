import { describe, expect, it } from "vitest";
import { n8nHealth, n8nWorkflowId } from "./runs";
import type { N8nWorkflowRuns } from "./types";

const wf = (over: Partial<N8nWorkflowRuns>): N8nWorkflowRuns => ({ id: "a", name: "A", active: true, runs: [], failures24h: 0, ...over });
const run = (status: N8nWorkflowRuns["runs"][number]["status"]) => ({ id: status, status, mode: "trigger", startedAt: "2026-11-10T10:00:00.000Z", stoppedAt: null });

describe("n8n runs in the page", () => {
  it("finds the workflow id an agent links to on its n8n instance", () => {
    expect(n8nWorkflowId({ links: [{ label: "n8n workflow", url: "https://khancam15.app.n8n.cloud/workflow/iQdSJGMQi6TBHlar" }] })).toBe("iQdSJGMQi6TBHlar");
    expect(n8nWorkflowId({ links: [{ label: "Live site", url: "https://benjaire.com/workflow/abc" }] })).toBeNull();
    expect(n8nWorkflowId({ links: [] })).toBeNull();
  });

  it("calls a workflow healthy only when its newest finished run succeeded", () => {
    expect(n8nHealth(wf({ runs: [run("running"), run("success")] }))).toBe("ok");
    expect(n8nHealth(wf({ runs: [run("crashed"), run("success")] }))).toBe("failing");
    expect(n8nHealth(wf({ runs: [] }))).toBe("idle");
    expect(n8nHealth(wf({ runs: [run("canceled")] }))).toBe("idle");
    expect(n8nHealth(wf({ active: false, runs: [run("error")] }))).toBe("off");
  });
});
