import { describe, expect, it } from "vitest";
import { fetchEngineering, summariseEngineering } from "./client";
import type { EngineeringOverview, ExecutionView } from "./types";

const exec = (over: Partial<ExecutionView>): ExecutionView => ({
  id: "e1", goalId: "g1", taskId: "t1", taskRecordId: null, incidentId: "i1", repo: "khaneilcampbell/ai-ops-atlas", attempt: 1, repairIteration: 0, phase: "CODE_MODIFIED", runner: "github-actions", runnerRunId: null, runnerUrl: null,
  baseSha: "a".repeat(40), headSha: null, branch: null, model: "sonnet", inputTokens: null, outputTokens: null, costUsd: 0, turns: null, filesChanged: [], claimedValidation: [], qaOutcome: null, qaReport: null, prUrl: null, prNumber: null, failureCategory: null, error: null, createdAt: "2026-11-23T12:00:00Z", updatedAt: "2026-11-23T12:00:00Z",
  ...over,
});
const overview = (over: Partial<EngineeringOverview> = {}): EngineeringOverview => ({
  configured: { database: true, n8n: true, github: true, runnerCallback: true, enabled: true },
  agents: [{ id: "atlas-engineer", name: "Atlas Engineering", status: "active", activity: "CODING", currentTaskId: "t1" }, { id: "atlas-qa", name: "Atlas Quality Assurance", status: "active", activity: "IDLE", currentTaskId: null }],
  repos: [],
  incidents: [],
  executions: [],
  spend: { last30Usd: 0, runs30: 0, inputTokens30: 0, outputTokens30: 0 },
  ...over,
});

describe("Engineering Operations summary", () => {
  it("counts from stored records only", () => {
    const s = summariseEngineering(overview({ executions: [exec({}), exec({ id: "e2", phase: "PR_READY", qaOutcome: "PASS", prUrl: "https://github.com/x/y/pull/1" }), exec({ id: "e3", phase: "FAILED", qaOutcome: "FAIL" })] }));
    expect(s).toMatchObject({ prsOpen: 1, qaPassed: 1, qaFailed: 1, failures: 1 });
    expect(s.running.map((e) => e.id)).toEqual(["e1"]);
    expect(s.line).toMatch(/^Engineering coding/);
    expect(s.setup).toEqual([]);
  });
  it("says plainly what's missing before it runs for real", () => {
    const s = summariseEngineering(overview({ configured: { database: true, n8n: false, github: true, runnerCallback: false, enabled: false } }));
    expect(s.setup).toHaveLength(3);
  });
  it("sends the Mac app to the web page and reports a missing migration", async () => {
    expect((await fetchEngineering(fetch, false, true)).state).toBe("off");
    const f = (async () => new Response(JSON.stringify({ message: "apply 0004" }), { status: 503 })) as unknown as typeof fetch;
    expect(await fetchEngineering(f, true, false)).toEqual({ state: "not-configured", message: "apply 0004" });
  });
});
