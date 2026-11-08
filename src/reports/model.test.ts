import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validOpportunityReport } from "./model";

// A parsed fixture, changed in place by each case below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mutable = any;

// The same fixture ops/opportunity-scout/test_scout.py checks the agent's output against.
const fixture = () => JSON.parse(readFileSync(new URL("../../ops/opportunity-scout/fixtures/report.json", import.meta.url), "utf8"));

describe("opportunity report check", () => {
  it("accepts what Opportunity Scout sends", () => {
    expect(validOpportunityReport(fixture())).toBe(true);
  });

  it("accepts a run with no ideas and no spec", () => {
    expect(validOpportunityReport({ ...fixture(), ideas: [], spec: null, notes: [], run_url: null })).toBe(true);
  });

  it.each([
    ["an unknown agent", (r: Mutable) => (r.agent = "commerce-loop")],
    ["an extra field", (r: Mutable) => (r.secret = "x")],
    ["a fourth idea", (r: Mutable) => r.ideas.push(r.ideas[0], r.ideas[0], r.ideas[0])],
    ["a score out of range", (r: Mutable) => (r.ideas[0].scores.revenue = 6)],
    ["a fractional score", (r: Mutable) => (r.ideas[0].scores.risk = 2.5)],
    ["an unknown mechanism", (r: Mutable) => (r.ideas[0].mechanism = "crypto")],
    ["a reuse that isn't an id", (r: Mutable) => (r.ideas[0].reuses = ["<script>"])],
    ["a spec cap above $5", (r: Mutable) => (r.spec.monthly_cap_usd = 50)],
    ["a building that isn't an id", (r: Mutable) => (r.spec.building = "GitHub Profile")],
    ["a run link off GitHub", (r: Mutable) => (r.run_url = "https://evil.example/actions/runs/1")],
    ["an overlong title", (r: Mutable) => (r.ideas[0].title = "x".repeat(161))],
    ["a bad date", (r: Mutable) => (r.at = "yesterday")],
  ])("refuses %s", (_, change) => {
    const r = fixture();
    change(r);
    expect(validOpportunityReport(r)).toBe(false);
  });
});
