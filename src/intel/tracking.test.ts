import { describe, expect, it } from "vitest";
import { fixIssueUrl } from "../lib/fixWithClaude";
import { openIssueUrl, recFixRequest, recKey } from "./links";
import { findIssue, linkedPr, loadTracking, trackedLabel, type GhIssue } from "./tracking";

const COMMERCE = "khaneilcampbell/multi-agent-commerce-pipeline";
const rec = { title: "Reduce blast radius", rationale: "Too broad.", firstStep: "Split the key.", evidence: [] };
const req = recFixRequest(rec, COMMERCE, "Engineering review", []);
const issue = (over: Partial<GhIssue>): GhIssue => ({ number: 1, title: "x", body: "", state: "open", state_reason: null, html_url: "https://github.com/o/r/issues/1", created_at: "2026-11-01T00:00:00Z", ...over });

describe("recommendation ids", () => {
  it("are stable across reviews and differ per repository", () => {
    expect(recKey("Reduce  blast radius ", COMMERCE)).toBe(recKey("reduce blast radius", COMMERCE.toUpperCase()));
    expect(recKey("Reduce blast radius", COMMERCE)).not.toBe(recKey("Reduce blast radius", "khaneilcampbell/ai-ops-atlas"));
    expect(req.marker).toMatch(/^[a-f0-9]{8}$/);
  });
  it("ride in both issue bodies as a hidden line", () => {
    const line = `<!-- atlas-rec:${req.marker} -->`;
    expect(new URL(fixIssueUrl(req)!).searchParams.get("body")).toContain(line);
    expect(new URL(openIssueUrl(req)!).searchParams.get("body")).toContain(line);
  });
});

describe("finding the issue again", () => {
  it("matches by marker or exact title, newest first, and ignores pull requests", () => {
    const list = [
      issue({ number: 2, body: `hi <!-- atlas-rec:${req.marker} -->`, created_at: "2026-11-02T00:00:00Z" }),
      issue({ number: 3, title: "Reduce blast radius", created_at: "2026-11-03T00:00:00Z", pull_request: {} }),
      issue({ number: 4, title: "reduce blast radius", created_at: "2026-11-01T00:00:00Z" }),
      issue({ number: 5, title: "Something else" }),
    ];
    expect(findIssue(list, req.marker!, "Reduce blast radius")?.number).toBe(2);
    expect(findIssue([issue({ title: "Other" })], req.marker!, "Reduce blast radius")).toBeNull();
  });
  it("prefers a merged pull request over an open one", () => {
    const ev = (n: number, state: string, merged: string | null) => ({ event: "cross-referenced", source: { issue: { number: n, html_url: `https://github.com/${COMMERCE}/pull/${n}`, state, pull_request: { merged_at: merged }, repository: { full_name: COMMERCE } } } });
    expect(linkedPr([ev(7, "open", null), ev(8, "closed", "2026-11-03T00:00:00Z"), { event: "labeled" }])).toMatchObject({ number: 8, state: "merged" });
    expect(linkedPr([{ event: "cross-referenced", source: { issue: { number: 9, html_url: "https://github.com/o/r/issues/9", state: "open" } } }])).toBeNull();
  });
  it("labels each state in plain words", () => {
    const base = { via: "fix" as const, repo: "khaneilcampbell/ai-ops-atlas", number: 12, url: "u", state: "open" as const, stateReason: null, pr: null };
    expect(trackedLabel(base, COMMERCE)).toEqual({ text: "Fix request ai-ops-atlas#12 open", url: "u", done: false });
    expect(trackedLabel({ ...base, via: "issue", repo: COMMERCE }, COMMERCE).text).toBe("Issue #12 open");
    expect(trackedLabel({ ...base, state: "closed", stateReason: "not_planned" }, COMMERCE)).toMatchObject({ text: "Fix request ai-ops-atlas#12 closed as not planned", done: true });
    expect(trackedLabel({ ...base, pr: { number: 30, repo: COMMERCE, url: "p", state: "merged" } }, COMMERCE)).toEqual({ text: "Fixed in PR #30", url: "p", done: true });
    expect(trackedLabel({ ...base, pr: { number: 30, repo: COMMERCE, url: "p", state: "open" } }, COMMERCE).text).toBe("PR #30 open");
  });
});

describe("loadTracking", () => {
  it("reads each list once with GET paths only and links the fix PR", async () => {
    const paths: string[] = [];
    const get = async (p: string): Promise<unknown> => {
      paths.push(p);
      if (p.startsWith("/repos/khaneilcampbell/ai-ops-atlas/issues?labels=claude-fix")) return [issue({ number: 12, html_url: "https://github.com/khaneilcampbell/ai-ops-atlas/issues/12", body: `<!-- atlas-rec:${req.marker} -->` })];
      if (p.startsWith(`/repos/${COMMERCE}/issues?`)) return [];
      if (p.includes("/issues/12/timeline")) return [{ event: "cross-referenced", source: { issue: { number: 30, html_url: `https://github.com/${COMMERCE}/pull/30`, state: "closed", pull_request: { merged_at: "2026-11-03T00:00:00Z" } } } }];
      throw new Error(`unexpected ${p}`);
    };
    const other = recFixRequest({ ...rec, title: "Second" }, COMMERCE, "Engineering review", []);
    const r = await loadTracking([req, other], get);
    expect(r.error).toBeNull();
    expect(r.byKey[req.marker!]).toEqual([expect.objectContaining({ via: "fix", number: 12, pr: expect.objectContaining({ number: 30, repo: COMMERCE, state: "merged" }) })]);
    expect(r.byKey[other.marker!]).toEqual([]);
    expect(paths.filter((p) => p.includes("labels=claude-fix"))).toHaveLength(1);
    expect(paths.every((p) => p.startsWith("/repos/"))).toBe(true);
  });
  it("reports a read failure as unknown instead of empty", async () => {
    const r = await loadTracking([req], async () => {
      throw new Error("Private or not found");
    });
    expect(r.error).toBe("Private or not found");
  });
});

describe("screenshot fixtures", () => {
  it("compute the same id as the app", async () => {
    const f = await import("../../visual/intel-fixtures");
    expect(f.recKey("Upgrade minimatch", "khaneilcampbell/ai-ops-atlas")).toBe(recKey("Upgrade minimatch", "khaneilcampbell/ai-ops-atlas"));
  });
});
