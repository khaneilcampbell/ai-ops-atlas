import { describe, expect, it } from "vitest";
import { recommendationMarkdown, reviewMarkdown } from "./reviewMarkdown";
import type { EcoReport, EcoReview } from "./types";

const review: EcoReview = {
  summary: "Tidy overall; the commerce VPS is the main risk.",
  scorecard: [{ area: "security", rating: "poor", rationale: "No required checks.", evidence: [], grounded: true }],
  top_risks: [
    { title: "VPS runs as root", severity: "high", why: "A compromise could spend money.", repos: ["khaneilcampbell/multi-agent-commerce-pipeline"], evidence: ["agent:commerce-loop"], grounded: true },
  ],
  recommendations: [
    {
      priority: "now",
      category: "security",
      title: "Harden the VPS",
      rationale: "One root process holds every credential.",
      first_step: "Create an unprivileged user.",
      effort: "a_day",
      repos: [],
      evidence: [],
      grounded: false,
    },
  ],
  tools: [],
  autonomy_notes: [{ agent: "commerce-loop", current_level: 3, suggested_level: 2, reason: "No telemetry.", evidence: [], grounded: true }],
  quick_wins: ["Add timeouts"],
  data_gaps: [],
};

const report = {
  repos: [],
  context: { projects: [], agents: [{ id: "commerce-loop", name: "Commerce Loop" }] },
  review,
  analyzed_at: "2026-10-28T20:00:00Z",
  model: "claude-sonnet-5-5",
} as unknown as EcoReport;

describe("review markdown", () => {
  it("renders every non-empty section in page order", () => {
    const md = reviewMarkdown(report, review);
    expect(md).toContain("# Engineering review");
    expect(md).toContain("_AI-generated, not verified · Reviewed 2026-10-28 · claude-sonnet-5-5_");
    expect(md).toContain("- **Security** (poor): No required checks.");
    expect(md).toContain("- **VPS runs as root** [high] (multi-agent-commerce-pipeline): A compromise could spend money. Evidence: `agent:commerce-loop`");
    expect(md).toContain("1. **Harden the VPS** [Do now · Security · About a day]");
    expect(md).toContain("   **First step:** Create an unprivileged user. _No supporting reference._");
    expect(md).toContain("- **Commerce Loop** L3 → L2: No telemetry.");
    expect(md).not.toContain("Suggested tools");
    expect(md).not.toContain("Couldn't assess");
    expect(md).not.toMatch(/\n{3}/);
    const order = ["Scorecard", "Top risks", "Recommendations", "Autonomy", "Quick wins"].map((h) => md.indexOf(`## ${h}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("copies one recommendation without a number", () => {
    expect(recommendationMarkdown(review.recommendations[0]).split("\n")[0]).toBe("**Harden the VPS** [Do now · Security · About a day]");
  });
});
