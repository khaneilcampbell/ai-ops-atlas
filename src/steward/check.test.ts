import { describe, expect, it } from "vitest";
import { GithubError } from "../github/transport";
import { checkSteward, STEWARD_REPO } from "./check";

const sha = "a".repeat(40);
const workflow = (id: number, conclusion: string | null, created_at: string, extra = {}) => ({ id, workflow_id: 1, head_branch: "main", status: "completed", conclusion, created_at, ...extra });
function source(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const answers: Record<string, unknown> = {
    "": { full_name: STEWARD_REPO, default_branch: "main" },
    "/commits/main": { sha },
    "/actions/runs?per_page=30&branch=main": { workflow_runs: [workflow(2, "success", "2026-10-28"), workflow(1, "failure", "2026-10-27")] },
    "/dependabot/alerts?state=open&per_page=20": [],
    "/code-scanning/alerts?state=open&per_page=20": [],
    "/readme": { type: "file" },
    "/contents/.github/dependabot.yml": { type: "file" },
    ...overrides,
  };
  const get = async (path: string) => {
    calls.push(path);
    const value = answers[path.replace(`/repos/${STEWARD_REPO}`, "")];
    if (value instanceof Error) throw value;
    return value;
  };
  return { get, calls };
}

describe("GitHub Steward observation", () => {
  it("uses fixed-scope bounded reads and recognizes recovery instead of flagging historical failures", async () => {
    const s = source();
    const r = await checkSteward(s);
    expect(r.status).toBe("completed");
    expect(r.commit).toBe(sha);
    expect(r.requests).toBe(7);
    expect(s.calls.every((p) => p.startsWith(`/repos/${STEWARD_REPO}`))).toBe(true);
    // Must match the Rust allowlist in src-tauri/src/steward/policy.rs, or the desktop app refuses the read.
    expect(s.calls.map((p) => p.slice(`/repos/${STEWARD_REPO}`.length))).toEqual([
      "", "/commits/main", "/actions/runs?per_page=30&branch=main", "/dependabot/alerts?state=open&per_page=20",
      "/code-scanning/alerts?state=open&per_page=20", "/readme", "/contents/.github/dependabot.yml",
    ]);
    expect(r.checks.find((c) => c.id === "ci")?.state).toBe("clear");
  });
  it("reports denied alerts and malformed data as unknown, never zero alerts", async () => {
    const r = await checkSteward(source({
      "/dependabot/alerts?state=open&per_page=20": new GithubError("Forbidden", 403),
      "/code-scanning/alerts?state=open&per_page=20": { message: "not available" },
    }));
    expect(r.status).toBe("partial");
    expect(r.checks.filter((c) => c.state === "unknown").map((c) => c.id)).toEqual(["dependabot", "code-scanning"]);
  });
  it("flags current failures but treats cancelled and absent CI as inconclusive", async () => {
    for (const [runs, state] of [
      [[workflow(1, "failure", "2026-10-28")], "attention"],
      [[workflow(1, "cancelled", "2026-10-28")], "unknown"],
      [[], "unknown"],
    ] as const) {
      const r = await checkSteward(source({ "/actions/runs?per_page=30&branch=main": { workflow_runs: runs } }));
      expect(r.checks.find((c) => c.id === "ci")?.state).toBe(state);
    }
  });
  it("honors pause before any request and after an in-flight request without issuing another", async () => {
    const s = source();
    expect((await checkSteward({ ...s, stopped: () => true })).requests).toBe(0);
    expect(s.calls).toHaveLength(0);
    let stop = false;
    const r = await checkSteward({ stopped: () => stop, get: async (path) => { const v = await s.get(path); stop = true; return v; } });
    expect(r.status).toBe("paused");
    expect(s.calls).toHaveLength(1);
    expect(r.checks).toEqual([]);
  });
  it("bounds time and does not guess a branch if metadata is unavailable", async () => {
    const s = source({ "": new GithubError("Unavailable", 404) });
    const r = await checkSteward(s);
    expect(r.status).toBe("partial");
    expect(s.calls.some((p) => p.includes("/commits/") || p.includes("/actions/runs"))).toBe(false);
    let clock = 0;
    const timed = source();
    const ended = await checkSteward({ now: () => clock, get: async (p) => { const v = await timed.get(p); clock = 180_001; return v; } });
    expect(ended.status).toBe("paused");
    expect(timed.calls).toHaveLength(1);
  });
  it("uses bounded counts without copying vulnerability content into storage", async () => {
    const r = await checkSteward(source({ "/dependabot/alerts?state=open&per_page=20": Array.from({ length: 20 }, () => ({ secret: "private advisory detail" })) }));
    const finding = r.checks.find((c) => c.id === "dependabot");
    expect(finding?.state).toBe("attention");
    expect(finding?.detail).toContain("20+");
    expect(JSON.stringify(r)).not.toContain("private advisory detail");
  });
});
