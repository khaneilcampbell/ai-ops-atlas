import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { atlasReport, ecoReport } from "../../visual/intel-fixtures";
import { AtlasContext } from "../state";
import { Assessment } from "../components/IntelPanel";
import { Review, VerifiedTable } from "../views/EngineeringReview";
import { scorecardRows } from "./ecosystem";
import { alertPageUrl, alertsListUrl, ecoRefTarget, evidenceLinks, openIssueUrl, recFixRequest, recRepos, repoRefTarget } from "./links";
import { fixIssueUrl } from "../lib/fixWithClaude";
import type { ReactNode } from "react";

const ATLAS = "khaneilcampbell/ai-ops-atlas";
const COMMERCE = "khaneilcampbell/multi-agent-commerce-pipeline";
const BENJAIRE = "khaneilcampbell/benjaire.com";

describe("reference link targets", () => {
  it("links a review's alert reference to GitHub's alert page", () => {
    expect(ecoRefTarget("alert:ai-ops-atlas:dependabot:17", ecoReport)).toEqual({ kind: "external", href: `https://github.com/${ATLAS}/security/dependabot/17`, label: "alert:ai-ops-atlas:dependabot:17" });
  });
  it("builds the alert page from the number when GitHub gave no link", () => {
    const facts = { ...atlasReport.facts, security: { ...atlasReport.facts.security, dependabot: { state: "assessed" as const, data: { open: 1, by_severity: {}, top: [{ number: 4, severity: "high", subject: "x", summary: "y", url: null }] } } } };
    expect(repoRefTarget("alert:dependabot:4", { facts })).toMatchObject({ href: `https://github.com/${ATLAS}/security/dependabot/4` });
    expect(alertPageUrl("https://github.com/o/r", "code_scanning", 2)).toBe("https://github.com/o/r/security/code-scanning/2");
    expect(alertsListUrl("https://github.com/o/r", "dependabot")).toBe("https://github.com/o/r/security/dependabot");
  });
  it("opens agents and repositories inside Atlas", () => {
    expect(ecoRefTarget("agent:commerce-loop", ecoReport)).toEqual({ kind: "agent", id: "commerce-loop", label: "Commerce Loop" });
    expect(ecoRefTarget(`repo:${COMMERCE}`, ecoReport)).toMatchObject({ kind: "repo", repo: COMMERCE, href: `https://github.com/${COMMERCE}` });
    expect(ecoRefTarget("project:commerce", ecoReport)).toMatchObject({ kind: "repo", repo: COMMERCE });
  });
  it("leaves references that match no fact as plain text", () => {
    for (const ref of ["made-up:ref", "agent:nobody", "alert:ai-ops-atlas:dependabot:99", "alert:nowhere:dependabot:17", "ci:benjaire.com", "plain"]) {
      expect(ecoRefTarget(ref, ecoReport)).toEqual({ kind: "text", label: ref });
    }
    expect(repoRefTarget("pr:999", atlasReport)).toEqual({ kind: "text", label: "pr:999" });
    expect(repoRefTarget("file:missing.txt", atlasReport)).toEqual({ kind: "text", label: "file:missing.txt" });
  });
  it("links repository-assessment citations to the GitHub pages they name", () => {
    expect(repoRefTarget("file:package.json", atlasReport)).toMatchObject({ href: `https://github.com/${ATLAS}/blob/main/package.json` });
    expect(repoRefTarget("file:docs", atlasReport)).toMatchObject({ href: `https://github.com/${ATLAS}/tree/main/docs` });
    expect(repoRefTarget("run:9001", atlasReport)).toMatchObject({ href: `https://github.com/${ATLAS}/actions/runs/9001` });
    expect(repoRefTarget("commit:65d9a0c", atlasReport)).toMatchObject({ href: `https://github.com/${ATLAS}/commit/65d9a0c1` });
    expect(repoRefTarget("readme", atlasReport)).toMatchObject({ href: `https://github.com/${ATLAS}#readme` });
  });
});

describe("recommendation hand-off", () => {
  const [vps, killSwitch, minimatch] = ecoReport.review!.recommendations;
  it("finds the repositories a recommendation is about, including through the agents it cites", () => {
    expect(recRepos(vps, ecoReport)).toEqual([COMMERCE]);
    expect(recRepos(killSwitch, ecoReport)).toEqual([BENJAIRE, COMMERCE]);
    expect(recRepos(minimatch, ecoReport)).toEqual([ATLAS]);
    expect(recRepos({ repos: ["someone/else"], evidence: ["made-up:ref"] }, ecoReport)).toEqual([]);
  });
  it("Fix with Claude goes to the labeled Atlas queue; Open issue goes to the repository with no label", () => {
    const links = evidenceLinks(minimatch.evidence, (r) => ecoRefTarget(r, ecoReport));
    expect(links).toEqual([{ label: "alert:ai-ops-atlas:dependabot:17", url: `https://github.com/${ATLAS}/security/dependabot/17` }]);
    const req = recFixRequest({ title: vps.title, rationale: vps.rationale, firstStep: vps.first_step, evidence: vps.evidence }, COMMERCE, "Engineering review", links);
    expect(req.kind).toContain("AI-generated, not verified");
    const fix = new URL(fixIssueUrl(req)!);
    expect(fix.pathname).toBe(`/${ATLAS}/issues/new`);
    expect(fix.searchParams.get("labels")).toBe("claude-fix");
    expect(fix.searchParams.get("body")).toContain(`**Repository:** ${COMMERCE}`);
    const issue = new URL(openIssueUrl(req)!);
    expect(issue.pathname).toBe(`/${COMMERCE}/issues/new`);
    expect(issue.searchParams.has("labels")).toBe(false);
    expect(issue.searchParams.get("body")).toContain("First step:");
    expect(openIssueUrl({ ...req, repo: "not a repo" })).toBeNull();
  });
});

const wrap = (node: ReactNode) => renderToStaticMarkup(<AtlasContext.Provider value={{ select: () => {} } as never}>{node}</AtlasContext.Provider>);

describe("unknown states", () => {
  it("lists all nine scorecard areas and marks the unrated ones unknown", () => {
    const rows = scorecardRows(ecoReport.review!);
    expect(rows).toHaveLength(9);
    expect(rows.find((r) => r.area === "testing")).toMatchObject({ rating: "unknown", rated: false, rationale: "Not rated in this review." });
    expect(rows.find((r) => r.area === "security")).toMatchObject({ rating: "fair", rated: true });
  });
  it("renders the review with linked references, owner unknown and hand-off buttons", () => {
    const html = wrap(<Review report={ecoReport} review={ecoReport.review!} />);
    expect(html).toContain("AI-generated, not verified");
    expect(html).toContain(`href="https://github.com/${ATLAS}/security/dependabot/17"`);
    expect(html).toMatch(/Owner: <button[^>]*>Commerce Loop<\/button>/);
    expect(html).toContain("Owner: Khaneil");
    expect(html).toContain("Owner unknown: the review didn&#x27;t name one");
    expect(html.match(/class="score unrated"/g)).toHaveLength(5);
    expect(html.match(/Fix with Claude/g)!.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('<span class="ref">made-up:ref</span>');
  });
  it("shows an unreadable repository's cells as unknown with GitHub's reason", () => {
    const html = wrap(<VerifiedTable report={ecoReport} />);
    expect(html).toContain('title="GitHub returned 403 for this repository"');
    expect(html).toContain("Code scanning unknown");
    expect(html).toContain(`href="https://github.com/${ATLAS}/security/dependabot"`);
    expect(html).not.toMatch(/>–</);
    expect(html).not.toMatch(/>\?</);
  });
  it("marks empty assessment fields unknown and keeps the AI label", () => {
    const html = wrap(<Assessment report={atlasReport} ai={atlasReport.ai!} />);
    expect(html).toContain("AI-generated, not verified");
    expect(html.match(/Unknown: Claude couldn&#x27;t tell from the data/g)).toHaveLength(2);
    expect(html).toContain(`https://github.com/${ATLAS}/blob/main/package.json`);
    expect(html).toContain("Fix with Claude");
  });
});
