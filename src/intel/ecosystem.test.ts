import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { telemetryFor } from "../registry/telemetry";
import { recordsFromRuns } from "../usage/model";
import { REVIEW_AGENT_ID, REVIEW_AGENT_NAME, ecosystemContext, isReviewRun } from "./ecosystem";
import type { Run } from "./types";

const run = (p: Partial<Run>): Run => ({
  id: "r1",
  repo: "khaneilcampbell/ai-ops-atlas",
  trigger: "manual",
  depth: "standard",
  model: "claude-sonnet-5-5",
  force: false,
  status: "succeeded",
  queued_at: "2026-10-28T08:00:00Z",
  started_at: "2026-10-28T08:00:00Z",
  finished_at: "2026-10-28T08:01:00Z",
  duration_ms: 60_000,
  error: null,
  attempts: 1,
  github_requests: 10,
  usage: { input_tokens: 20_000, output_tokens: 4_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, served_by: null, fallback: false },
  estimate: null,
  cost_usd: 0.08,
  trace: [],
  ...p,
});

describe("engineering review context", () => {
  const ctx = ecosystemContext(catalog);

  it("carries every catalog project and agent with its governance", () => {
    expect(ctx.projects).toHaveLength(catalog.projects.length);
    expect(ctx.agents).toHaveLength(catalog.agents.length);
    const me = ctx.agents.find((a) => a.id === REVIEW_AGENT_ID)!;
    expect(me.autonomy).toBe(1);
    expect(me.kind).toBe("A");
    expect(me.telemetry).toBe(true);
    expect(me.project).toBe("Atlas HQ");
  });

  it("keeps review runs and repository runs apart", () => {
    const runs = [run({ id: "a" }), run({ id: "b", kind: "ecosystem", repo: "ecosystem" })];
    expect(runs.filter(isReviewRun).map((r) => r.id)).toEqual(["b"]);
    const reviewer = catalog.agents.find((a) => a.id === REVIEW_AGENT_ID)!;
    const repoIntel = catalog.agents.find((a) => a.id === "repo-intelligence")!;
    expect(telemetryFor(reviewer, undefined, runs).executions).toHaveLength(1);
    expect(telemetryFor(repoIntel, undefined, runs).executions).toHaveLength(1);
    const [, rec] = recordsFromRuns(runs, "Repository Intelligence Agent");
    expect(rec.agent).toBe(REVIEW_AGENT_NAME);
    expect(rec.project).toBe("All catalog repositories");
  });
});
