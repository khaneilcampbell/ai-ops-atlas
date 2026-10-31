import { AREA_LABEL, EFFORT_LABEL, WHEN_LABEL, allFindings } from "./ecosystem";
import type { EcoReport, EcoReview } from "./types";

/**
 * Plain Markdown versions of the Engineering review, for the Copy buttons. Each section can be
 * copied on its own; `reviewMarkdown` joins them into the whole review with a header.
 */

type Rec = EcoReview["recommendations"][number];

const short = (repo: string) => repo.split("/").pop() ?? repo;
const repos = (list: string[]) => (list.length ? ` (${list.map(short).join(", ")})` : "");
const refs = (list: string[], grounded: boolean) => (!grounded ? " _No supporting reference._" : list.length ? ` Evidence: ${list.map((r) => `\`${r}\``).join(", ")}` : "");
const area = (a: string) => AREA_LABEL[a] ?? a;

export function scorecardMarkdown(review: EcoReview) {
  return ["## Scorecard", "", ...review.scorecard.map((s) => `- **${area(s.area)}** (${s.rating}): ${s.rationale}`)].join("\n");
}

export function risksMarkdown(review: EcoReview) {
  return ["## Top risks", "", ...review.top_risks.map((r) => `- **${r.title}** [${r.severity}]${repos(r.repos)}: ${r.why}${refs(r.evidence, r.grounded)}`)].join("\n");
}

export function recommendationMarkdown(r: Rec, n?: number) {
  const head = `${n != null ? `${n}. ` : ""}**${r.title}** [${WHEN_LABEL[r.priority]} · ${area(r.category)} · ${EFFORT_LABEL[r.effort]}]${repos(r.repos)}`;
  const pad = n != null ? "   " : "";
  return [head, `${pad}${r.rationale}`, `${pad}**First step:** ${r.first_step}${refs(r.evidence, r.grounded)}`].join("\n");
}

export function recommendationsMarkdown(review: EcoReview) {
  return ["## Recommendations", "", review.recommendations.map((r, i) => recommendationMarkdown(r, i + 1)).join("\n\n")].join("\n");
}

export function toolsMarkdown(review: EcoReview) {
  return ["## Suggested tools", "", ...review.tools.map((t) => `- **${t.name}** [${t.cost}]${repos(t.repos)}: ${t.purpose} ${t.why}`)].join("\n");
}

export function autonomyMarkdown(review: EcoReview, agentName: (id: string) => string) {
  return [
    "## Autonomy",
    "",
    ...review.autonomy_notes.map((a) => `- **${agentName(a.agent)}** L${a.current_level} → L${a.suggested_level}: ${a.reason}${refs(a.evidence, a.grounded)}`),
  ].join("\n");
}

const bullets = (title: string, items: string[]) => [`## ${title}`, "", ...items.map((q) => `- ${q}`)].join("\n");
export const quickWinsMarkdown = (review: EcoReview) => bullets("Quick wins (under an hour)", review.quick_wins);
export const dataGapsMarkdown = (review: EcoReview) => bullets("Couldn't assess", review.data_gaps);

export function verifiedMarkdown(report: EcoReport) {
  const findings = allFindings(report);
  if (!findings.length) return "";
  return ["## Verified findings from GitHub", "", ...findings.map((f) => `- [${f.severity}] **${short(f.repo)}**: ${f.title.replace(/[.!?]$/, "")}. ${f.detail}${f.url ? ` ${f.url}` : ""}`)].join("\n");
}

/** The whole review: header, summary, then every non-empty section in page order. */
export function reviewMarkdown(report: EcoReport, review: EcoReview) {
  const names = new Map(report.context.agents.map((a) => [a.id, a.name]));
  const meta = [report.analyzed_at && `Reviewed ${report.analyzed_at.slice(0, 10)}`, report.model].filter(Boolean).join(" · ");
  return [
    "# Engineering review",
    "",
    `_${["AI-generated, not verified", meta].filter(Boolean).join(" · ")}_`,
    "",
    review.summary,
    review.scorecard.length && scorecardMarkdown(review),
    review.top_risks.length && risksMarkdown(review),
    review.recommendations.length && recommendationsMarkdown(review),
    review.tools.length && toolsMarkdown(review),
    review.autonomy_notes.length && autonomyMarkdown(review, (id) => names.get(id) ?? id),
    review.quick_wins.length && quickWinsMarkdown(review),
    review.data_gaps.length && dataGapsMarkdown(review),
    verifiedMarkdown(report),
  ]
    .filter((s) => typeof s === "string" && s !== "")
    .join("\n\n")
    .replace(/\n\n\n+/g, "\n\n")
    .concat("\n");
}
