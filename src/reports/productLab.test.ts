import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_REPORT_BYTES, REPORT_AGENTS, reportLine, validOpportunityReport, validReport } from "./model";
import { scoreTotal, validProductLabReport } from "./productLab";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mutable = any;
// The example brief in docs/product-lab.md; KC's n8n agent sends this shape.
const fixture = () => JSON.parse(readFileSync(new URL("../../ops/product-lab/fixtures/report.json", import.meta.url), "utf8"));

describe("Product Lab report check", () => {
  it("accepts the documented example and stores it under the Product Lab agent", () => {
    expect(validProductLabReport(fixture())).toBe(true);
    expect(validReport(fixture())).toBe(true);
    expect(REPORT_AGENTS).toContain("benjaire-product-lab");
    expect(reportLine(fixture())).toBe("2026-12: Flow for dental clinics (score 4.55, hypothesis).");
  });

  it("recomputes the weighted total itself", () => {
    expect(scoreTotal({ demand: 4, gap: 4, fit: 5, margin: 5, validate: 5, synergy: 5 })).toBe(4.55);
    expect(scoreTotal({ demand: 5, gap: 5, fit: 5, margin: 5, validate: 5, synergy: 5 })).toBe(5);
  });

  it("is not confused with an Opportunity Scout report", () => {
    expect(validOpportunityReport({ ...fixture() })).toBe(false);
    const asScout = JSON.parse(readFileSync(new URL("../../ops/opportunity-scout/fixtures/report.json", import.meta.url), "utf8"));
    expect(validProductLabReport({ ...asScout, agent: "benjaire-product-lab" })).toBe(false);
    expect(validOpportunityReport({ ...asScout, agent: "benjaire-product-lab" })).toBe(false);
  });

  it("fits under the report size cap", () => {
    expect(JSON.stringify(fixture()).length).toBeLessThan(MAX_REPORT_BYTES);
  });

  it.each([
    ["an extra key", (r: Mutable) => (r.secret = "x")],
    ["a missing key", (r: Mutable) => delete r.notion_url],
    ["an extra key in a scorecard row", (r: Mutable) => (r.scorecard[0].bonus = 1)],
    ["a total that doesn't add up", (r: Mutable) => (r.scorecard[0].total = 4.9)],
    ["a score above 5", (r: Mutable) => (r.scorecard[1].demand = 6)],
    ["a fractional score", (r: Mutable) => (r.scorecard[1].gap = 2.5)],
    ["a top pick that isn't the best score", (r: Mutable) => ([r.top, r.runners_up[0]] = [r.runners_up[0], r.top])],
    ["a runner-up missing from the scorecard", (r: Mutable) => (r.runners_up[1].title = "Something else")],
    ["one runner-up", (r: Mutable) => r.runners_up.pop()],
    ["a plain http source", (r: Mutable) => (r.sources[0].url = "http://example.com")],
    ["a javascript source", (r: Mutable) => (r.sources[0].url = "javascript:alert(1)")],
    ["no sources", (r: Mutable) => (r.sources = [])],
    ["a non-https Notion link", (r: Mutable) => (r.notion_url = "http://notion.so/x")],
    ["validated without evidence", (r: Mutable) => (r.status = "validated")],
    ["an unknown status", (r: Mutable) => (r.status = "launched")],
    ["a three-week plan", (r: Mutable) => r.plan.pop()],
    ["no metrics", (r: Mutable) => (r.metrics = [])],
    ["a bad month", (r: Mutable) => (r.month = "2026-13")],
    ["an unknown pillar", (r: Mutable) => (r.top.pillar = "food")],
    ["an oversized topic", (r: Mutable) => (r.topic = "x".repeat(161))],
    ["another agent's name", (r: Mutable) => (r.agent = "github-opportunity-scout")],
  ])("refuses %s", (_name, change) => {
    const r = fixture();
    change(r);
    expect(validProductLabReport(r)).toBe(false);
    expect(validReport(r)).toBe(false);
  });

  it("accepts a validated pick once evidence is listed", () => {
    expect(validProductLabReport({ ...fixture(), status: "validated", evidence: ["12 preorders in week 3"] })).toBe(true);
  });
});
